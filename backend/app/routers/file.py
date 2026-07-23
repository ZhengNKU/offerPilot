from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import uuid
import asyncio
import io
from datetime import datetime
import logging
from typing import Optional
from qcloud_cos import CosConfig, CosS3Client
from pydantic import BaseModel

from app import models
from app.database import get_db
from app.config import settings
from app.routers.auth import get_current_user_optional

router = APIRouter(prefix="/api/file", tags=["File Management"])

# COS configuration
region = 'ap-nanjing'
scheme = 'https'
bucket = 'offer-pilot-1392177347'

_cos_client: Optional[CosS3Client] = None

def get_cos_client() -> CosS3Client:
    global _cos_client
    if _cos_client is None:
        if not settings.TENCENT_SECRET_ID or not settings.TENCENT_SECRET_KEY:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="腾讯云对象存储未配置：请在 backend/.env 中设置 TENCENT_SECRET_ID 与 TENCENT_SECRET_KEY"
            )
        config = CosConfig(
            Region=region,
            SecretId=settings.TENCENT_SECRET_ID,
            SecretKey=settings.TENCENT_SECRET_KEY,
            Token=None,
            Scheme=scheme,
            Timeout=90,  # raise from 30s default; slow links to ap-nanjing can stall write buffers
            AutoSwitchDomainOnRetry=True,  # fall back to tencentcos.cn on retry if myqcloud.com path is slow
        )
        _cos_client = CosS3Client(config)
    return _cos_client

class DeleteRequest(BaseModel):
    file_id: int

async def delete_file_from_storage(db: AsyncSession, db_file: models.UploadedFile):
    """从 COS 与数据库中彻底删除一条文件记录。无鉴权，供系统级清理任务复用。"""
    try:
        client = get_cos_client()
        await asyncio.to_thread(
            client.delete_object,
            Bucket=bucket,
            Key=db_file.cos_key,
        )
    except Exception:
        # 即使 COS 删除失败也继续清库，避免留下孤儿记录
        pass

    await db.delete(db_file)
    await db.commit()


async def delete_file_shared(file_id: int, db: AsyncSession, current_user: Optional[models.User]):
    result = await db.execute(select(models.UploadedFile).where(models.UploadedFile.id == file_id))
    db_file = result.scalars().first()
    if not db_file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文件未找到"
        )

    # Permission check: if user is logged in, ensure they own the file.
    # If it is a guest file, allow deleting it.
    if db_file.user_id is not None:
        if not current_user or current_user.id != db_file.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="无权删除该文件"
            )

    await delete_file_from_storage(db, db_file)
    return {"message": "文件删除成功"}

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    file_type: str = Form("audio"), # "audio" or "resume"
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    # Enforce size limits: 5MB for resume/screenshot, 50MB for audio
    if file_type in ("resume", "screenshot"):
        max_size_bytes = 5 * 1024 * 1024
    else:
        max_size_bytes = 50 * 1024 * 1024
    if file.size and file.size > max_size_bytes:
        limit_desc = "5MB" if file_type in ("resume", "screenshot") else "50MB"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"上传的文件大小不能超过 {limit_desc}"
        )

    # Validate formats based on file_type
    filename = file.filename or ""
    ext = filename.split('.')[-1].lower() if '.' in filename else ""
    if file_type == "audio":
        if ext not in ["wav", "mp3"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="录音仅支持 WAV 或 MP3 格式"
            )
    elif file_type == "resume":
        if ext not in ["pdf", "docx"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="简历仅支持 PDF 或 DOCX 格式"
            )
    elif file_type == "screenshot":
        if ext not in ["jpg", "png"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="图片仅支持 JPG 或 PNG 格式"
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不支持的文件类型"
        )

    # Generate unique COS Key
    unique_id = str(uuid.uuid4())
    cos_key = f"uploads/{unique_id}_{filename}"
    
    # Read file content
    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"文件读取失败: {str(e)}"
        )

    # ── 截图图片审核(同步阻塞,在 COS 上传之前) ──
    # 只对 screenshot 走 IMS;audio / resume 不走。
    # 审核通过后才进 COS,违规直接 raise 400,COS 完全不碰。
    img_result = None
    if file_type == "screenshot" and current_user is not None:
        from app.utils.content_moderation import moderate_image_bytes, is_rejected, record_audit, should_audit
        img_result = await moderate_image_bytes(content, current_user.id, scene="screenshot")
        if is_rejected(img_result):
            logging.info(
                "screenshot rejected user=%s label=%s sub_label=%s",
                current_user.id, img_result.label, img_result.sub_label,
            )
            # 违规也要写审计(用独立 session,避免和后续 upload 逻辑混在一起)
            if should_audit(img_result):
                try:
                    from app.database import async_session
                    async with async_session() as audit_db:
                        await record_audit(
                            audit_db,
                            user_id=current_user.id,
                            scene="screenshot",
                            source_type="image",
                            target_id=None,  # 违规没上传,没有 file_id
                            result=img_result,
                            raw_text=None,
                        )
                except Exception:
                    logging.exception("[moderation] 截图违规审计写入失败(非阻塞)")
            raise HTTPException(status_code=400, detail="图片内容违规,请重新上传")

    # Upload to COS via multipart-capable helper (auto-chunks files >= 10MB so a
    # single stalled chunk does not kill the entire upload on slow links).
    try:
        client = get_cos_client()
        await asyncio.to_thread(
            client.upload_file_from_buffer,
            Bucket=bucket,
            Key=cos_key,
            Body=io.BytesIO(content),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"上传到腾讯云对象存储失败: {str(e)}"
        )

    # File URL — must be a presigned URL so Volc ASR (and the frontend audio
    # player) can actually download from a private bucket. 1h expiry is
    # long enough for ASR submit + report viewing.
    try:
        client = get_cos_client()
        file_url = await asyncio.to_thread(
            client.get_presigned_download_url,
            Bucket=bucket,
            Key=cos_key,
            Expired=3600,
        )
    except Exception as e:
        # Fallback to plain URL so DB write doesn't fail; downstream will
        # surface 45000006 again if bucket is private.
        file_url = f"https://{bucket}.cos.{region}.myqcloud.com/{cos_key}"
        import logging as _logging
        _logging.getLogger(__name__).warning(f"presigned URL fallback: {e}")

    # Save to database
    db_file = models.UploadedFile(
        user_id=current_user.id if current_user else None,
        filename=filename,
        cos_key=cos_key,
        file_url=file_url,
        file_size=len(content),
        file_type=file_type
    )
    db.add(db_file)
    await db.commit()
    await db.refresh(db_file)

    # ── 截图审核审计(非阻塞) ──
    # 只在登录用户 + 走 IMS 审核 + 命中审计策略时写
    if img_result is not None and should_audit(img_result):
        try:
            await record_audit(
                db,
                user_id=current_user.id if current_user else None,
                scene="screenshot",
                source_type="image",
                target_id=db_file.id,
                result=img_result,
                raw_text=None,  # 图片无文本
            )
        except Exception:
            logging.exception("[moderation] 截图审计写入失败(非阻塞)")

    return {
        "file_id": db_file.id,
        "filename": db_file.filename,
        "file_url": db_file.file_url,
        "file_size": db_file.file_size,
        "file_type": db_file.file_type
    }

@router.delete("/delete")
async def delete_file(
    file_id: int, # query parameter
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    return await delete_file_shared(file_id, db, current_user)

@router.post("/delete")
async def delete_file_post(
    req: DeleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    return await delete_file_shared(req.file_id, db, current_user)
