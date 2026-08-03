from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import uuid
import asyncio
import secrets
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

# ───────────── presigned PUT 直传（2026-08 引入）─────────────
# 流程:
#   1. 浏览器 POST /api/file/presign-upload → 拿到 {upload_url, cos_key, presign_token}
#   2. 浏览器 PUT upload_url(直传 COS,不经 FastAPI)
#   3. 浏览器 POST /api/file/finalize {cos_key, presign_token} → 落 DB,签 1h download URL
# 替换原 POST /api/file/upload,目标:50MB 文件上传 84s → 5-15s,后端内存 ≈0。

class PresignUploadRequest(BaseModel):
    file_type: str           # "audio"|"resume"|"screenshot"
    filename: str            # 原始文件名(只取 basename,sanitized by FastAPI)
    content_type: str        # MIME,如 "audio/wav" / "application/pdf"
    content_length: int      # 字节数,>0


@router.post("/presign-upload")
async def presign_upload(
    req: PresignUploadRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    """签名 15 分钟 presigned PUT URL,给前端直传 COS。"""
    # ── 1. content_length 校验(不读 body,纯 metadata 校验)──
    if req.content_length <= 0:
        raise HTTPException(400, "content_length 必须 > 0")
    if req.file_type in ("resume", "screenshot"):
        max_size = 5 * 1024 * 1024
    else:
        max_size = 50 * 1024 * 1024
    if req.content_length > max_size:
        raise HTTPException(
            400, f"文件不能超过 {max_size // 1024 // 1024}MB"
        )

    # ── 2. ext 校验(扩展名白名单,跟旧 upload 同款) ──
    ext = req.filename.rsplit(".", 1)[-1].lower() if "." in req.filename else ""
    allowed = {
        "audio": {"wav", "mp3", "ogg"},
        "resume": {"pdf", "docx"},
        "screenshot": {"jpg", "png"},
    }
    if ext not in allowed.get(req.file_type, set()):
        raise HTTPException(400, f"不支持的格式 .{ext}")

    # ── 3. 生成 cos_key + 一次性 presign_token ──
    #    cos_key 格式与原 upload 一致,方便最终清理脚本兼容
    cos_key = f"uploads/{uuid.uuid4()}_{req.filename}"
    presign_token = secrets.token_urlsafe(32)  # 一次性,用完即清

    # ── 4. 写 status='pending' 行(马上能被 track_pending 看到) ──
    #    retention_days 跟旧 upload 同款四档语义
    if req.file_type == "screenshot":
        retention_days = None  # 截图永不参与 cleanup
    elif current_user is None:
        retention_days = 0     # 访客:cleanup 立即删
    elif current_user.membership == "test":
        retention_days = settings.FILE_RETENTION_DAYS_TEST
    else:
        retention_days = settings.FILE_RETENTION_DAYS_FREE

    db_file = models.UploadedFile(
        user_id=current_user.id if current_user else None,
        filename=req.filename,
        cos_key=cos_key,
        file_url=f"https://{bucket}.cos.{region}.myqcloud.com/{cos_key}",
        file_size=req.content_length,  # 临时值,finalize 时被 head_object 真实长度覆盖
        file_type=req.file_type,
        retention_days=retention_days,
        status="pending",
        presign_token=presign_token,
    )
    db.add(db_file)
    await db.commit()
    await db.refresh(db_file)

    # ── 5. 签 PUT URL ──
    #    Headers 写进签名:浏览器 PUT 时必须发送同样的 Content-Type/Content-Length
    #    注:get_presigned_url SDK 不支持 ServerSideEncryption kwarg;
    #        SSE 由桶层"默认加密"配置或 X-COS-Server-Side-Encryption header 控制
    #    注:get_presigned_url 返回单字符串,不是 tuple
    client = get_cos_client()
    upload_url = await asyncio.to_thread(
        client.get_presigned_url,
        Bucket=bucket,
        Key=cos_key,
        Method="PUT",
        Expired=settings.FILE_PRESIGN_UPLOAD_EXPIRED,
        Headers={
            "Content-Type": req.content_type,
            "Content-Length": str(req.content_length),
        },
    )

    return {
        "upload_url": upload_url,
        "cos_key": cos_key,
        "presign_token": presign_token,
        "file_id": db_file.id,  # 给前端 track_pending 用
        "expires_in": settings.FILE_PRESIGN_UPLOAD_EXPIRED,
        "max_size": max_size,
    }


class FinalizeRequest(BaseModel):
    cos_key: str
    presign_token: str
    filename: str            # 占位(沿用 presign 时存的,防前端伪造)
    file_type: str           # 占位
    file_size: int           # 客户端报告值,被 head_object 真实长度覆盖


@router.post("/finalize")
async def finalize_upload(
    req: FinalizeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    """前端 PUT 到 COS 成功后调这里:
       - head_object 校验对象已落盘(拿真实 Content-Length)
       - 校验 presign_token(防 A 把 B 的 URL 据为己有)
       - status='pending' → 'finalized', 清 token
       - 签 1h download URL 返回

    幂等:已 finalized 的行直接返回现有(防止前端断网重试 create 重复行)。
    """
    # ── 1. cos_key 路径白名单(防通过 finalize 访问其他对象) ──
    if not req.cos_key.startswith("uploads/") or ".." in req.cos_key:
        raise HTTPException(400, "cos_key 路径非法")

    # ── 2. 查 status='pending' 行(行级锁防并发 finalize) ──
    stmt = (
        select(models.UploadedFile)
        .where(
            models.UploadedFile.cos_key == req.cos_key,
            models.UploadedFile.status == "pending",
            models.UploadedFile.user_id == (current_user.id if current_user else None),
        )
        .with_for_update()
    )
    result = await db.execute(stmt)
    db_file = result.scalars().first()

    # ── 2.5 找不到 pending 行:可能是已 finalized(幂等返回)或真不存在 ──
    if not db_file:
        # 已 finalized:不报错,直接返回现有 final 状态(允许前端断网重试)
        finalized_stmt = (
            select(models.UploadedFile)
            .where(
                models.UploadedFile.cos_key == req.cos_key,
                models.UploadedFile.status == "finalized",
                models.UploadedFile.user_id == (current_user.id if current_user else None),
            )
        )
        finalized_res = await db.execute(finalized_stmt)
        existing = finalized_res.scalars().first()
        if existing:
            # 重新签 1h URL,不重新写 DB 行
            client = get_cos_client()
            presigned = await asyncio.to_thread(
                client.get_presigned_download_url,
                Bucket=bucket,
                Key=existing.cos_key,
                Expired=3600,
            )
            return {
                "file_id": existing.id,
                "filename": existing.filename,
                "file_url": presigned,
                "cos_path": existing.file_url,
                "file_size": existing.file_size,
                "file_type": existing.file_type,
                "idempotent_replay": True,
            }
        # 真不存在(或 presign 已超时被 cleanup 删了)
        raise HTTPException(
            404, "找不到待 finalize 的上传任务,可能已超时被清理"
        )

    # ── 3. 校验 presign_token(防 A 把 B 的 URL 据为己有 + 防旧 token 重放) ──
    #    使用常量时间比较(secrets.compare_digest)避免 timing attack
    if not secrets.compare_digest(
        db_file.presign_token or "",
        req.presign_token,
    ):
        raise HTTPException(403, "presign_token 不匹配")

    # ── 4. head_object 校验 COS 真的落盘 ──
    #    拿真实 Content-Length 覆盖客户端报告值(防客户端造假)
    client = get_cos_client()
    try:
        meta = await asyncio.to_thread(
            client.head_object, Bucket=bucket, Key=req.cos_key
        )
        actual_size = int(meta.get("Content-Length", req.file_size))
    except Exception as e:
        # 4xx NotFound = PUT 没真正成功(CORS 失败 / 网络断),保留 pending 等 cleanup 兜底
        # 5xx = COS 临时错误,同上
        raise HTTPException(400, f"文件落盘校验失败: {e}")

    # ── 5. 标 finalized, 清 token ──
    db_file.status = "finalized"
    db_file.presign_token = None
    db_file.file_size = actual_size
    # filename/file_type 沿用 presign 时存的

    # ── 6. 签 1h download URL ──
    presigned = await asyncio.to_thread(
        client.get_presigned_download_url,
        Bucket=bucket,
        Key=req.cos_key,
        Expired=3600,
    )

    await db.commit()
    await db.refresh(db_file)

    return {
        "file_id": db_file.id,
        "filename": db_file.filename,
        "file_url": presigned,
        "cos_path": db_file.file_url,
        "file_size": actual_size,
        "file_type": db_file.file_type,
        "idempotent_replay": False,
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
