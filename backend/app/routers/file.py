from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import uuid
import asyncio
import io
from datetime import datetime
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

    # 体验反馈截图不再调用腾讯云 IMS 图片审核,仅保留格式/大小校验后上传。

    # Upload to COS via multipart-capable helper (auto-chunks files >= 10MB so a
    # single stalled chunk does not kill the entire upload on slow links).
    # ServerSideEncryption='AES256' = SSE-COS（腾讯托管密钥），代码层显式声明，
    # 不依赖桶配置是否开启默认加密。
    try:
        client = get_cos_client()
        await asyncio.to_thread(
            client.upload_file_from_buffer,
            Bucket=bucket,
            Key=cos_key,
            Body=io.BytesIO(content),
            ServerSideEncryption='AES256',
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"上传到腾讯云对象存储失败: {str(e)}"
        )

    # File URL — DB 永远只存**非签名**的 cos 路径（消除"DB 泄漏 = 1h 签名 URL 即明文"风险）。
    # 签名 URL 仅在 upload 响应里下发一次（前端立即可播，1h 后失效），后续访问走 /api/file/presign。
    # Bucket 是私有的，外部没有 SecretKey 无法直接 fetch 非签名 URL，所以安全性有保证。
    cos_path_url = f"https://{bucket}.cos.{region}.myqcloud.com/{cos_key}"

    # 同事务里给前端下发的"新鲜签名 URL"，仅本次响应有效，1h 后过期。
    presigned_url: Optional[str] = None
    try:
        client = get_cos_client()
        presigned_url = await asyncio.to_thread(
            client.get_presigned_download_url,
            Bucket=bucket,
            Key=cos_key,
            Expired=3600,
        )
    except Exception as e:
        # 签名失败也不阻塞上传（DB 记录仍然有非签名 URL；前端可调 /api/file/presign 重试）
        import logging as _logging
        _logging.getLogger(__name__).warning(f"presigned URL 生成失败: {e}")

    # Save to database（只存非签名 cos 路径）
    # retention_days 锁定**上传时**的档位 → 后续用户升降级不影响本文件保留期。
    #
    # 语义：
    #   - 30 = 免费档上传（audio/resume）
    #   - 60 = 内测档上传（audio/resume）
    #   - 0  = 访客上传（audio/resume，cleanup 立即删）
    #   - None = 截图（cleanup 永远不删截图，retention_days 对其无意义，留 NULL）
    if file_type == "screenshot":
        # 截图不参与自动清理（cleanup.py WHERE 里 file_type != 'screenshot' 显式排除），
        # retention_days 字段对截图无意义，留 NULL 避免误导后续读这段代码的人。
        retention_days = None
    elif current_user is None:
        retention_days = 0   # 访客文件：cleanup 立即删
    elif current_user.membership == "test":
        retention_days = settings.FILE_RETENTION_DAYS_TEST
    else:
        retention_days = settings.FILE_RETENTION_DAYS_FREE

    db_file = models.UploadedFile(
        user_id=current_user.id if current_user else None,
        filename=filename,
        cos_key=cos_key,
        file_url=cos_path_url,  # DB 存非签名 URL，**不再是 1h-bomb**
        file_size=len(content),
        file_type=file_type,
        retention_days=retention_days,
    )
    db.add(db_file)
    await db.commit()
    await db.refresh(db_file)

    return {
        "file_id": db_file.id,
        "filename": db_file.filename,
        # 上传响应里**仍然返回签名 URL**（前端拿到即可播，1h 内有效）
        # 后续要长期访问请调 /api/file/presign?file_id=... 刷新鲜签名
        "file_url": presigned_url or cos_path_url,
        "file_size": db_file.file_size,
        "file_type": db_file.file_type,
        # 额外字段：DB 里的非签名 cos 路径，前端可存这个 + 调 /api/file/presign 续期
        "cos_path": cos_path_url,
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


@router.get("/presign")
async def presign_file(
    file_id: int,
    expired: int = 3600,  # 默认 1h，前端按需可调短
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """为已上传的文件签发一次性的下载 URL（pre-signed URL）。

    用途：
      - DB 里 file_url 现在存的是非签名 cos 路径（消除 1h-bomb 风险），
        前端要播放/下载时调这个端点拿一个临时签名 URL。
      - 鉴权：登录用户必须是文件 owner；未登录（访客）文件拒绝访问。

    参数：
      - file_id: 必填，UploadedFile.id
      - expired: 签名 URL 有效期（秒），默认 3600（1h），最长 4 小时（避免被滥用）

    返回：
      - file_url: 签名 URL（1h 内可用）
      - expires_at: ISO 时间戳，前端可缓存至该时刻再调本端点续期
    """
    if expired <= 0 or expired > 4 * 3600:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="expired 必须在 (0, 14400] 秒之间（最长 4 小时）"
        )

    # 查文件
    result = await db.execute(
        select(models.UploadedFile).where(models.UploadedFile.id == file_id)
    )
    db_file = result.scalars().first()
    if not db_file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文件未找到"
        )

    # 鉴权：登录用户必须是 owner；访客文件（user_id IS NULL）只允许原访客下载（无法验证 → 拒绝）
    if db_file.user_id is not None:
        if not current_user or current_user.id != db_file.user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="无权访问该文件"
            )
    else:
        # 访客文件无法跨请求验证身份 → 拒绝走 presign 端点
        # （访客的临时访问应该走 create_session 时把 cos_key 传进来，
        #  由 /api/audio/session 内部走鉴权后的 presign）
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="访客文件不支持刷新签名 URL，请使用原始上传响应里的 URL"
        )

    # cos_key 已被清空（清理任务跑过）→ 文件已不存在
    if not db_file.cos_key:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="文件已过期被清理，无法访问"
        )

    try:
        client = get_cos_client()
        presigned = await asyncio.to_thread(
            client.get_presigned_download_url,
            Bucket=bucket,
            Key=db_file.cos_key,
            Expired=expired,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"签名 URL 生成失败: {str(e)}"
        )

    from datetime import datetime, timedelta, timezone
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expired)

    return {
        "file_id": db_file.id,
        "file_url": presigned,
        "expires_at": expires_at.isoformat(),
        "expired_seconds": expired,
    }
