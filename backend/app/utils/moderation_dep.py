"""
可复用的内容审核 Depends 工厂 + 同步 helper(Phase 3)。

提供两种用法,按场景选:

1) **Depends 工厂 `@moderated("scene", "field1", "field2")`** —— 给 JSON 请求体的端点用
   ```python
   @router.post("")
   async def create_feedback(
       req: schemas.FeedbackCreate,
       _moderation: None = Depends(moderated("feedback", "title", "description")),
       ...
   ):
   ```
   - 自动从 JSON body 取字段(支持 dot path `"account.username"`)
   - 任意字段命中 → raise 400 "发布内容包含违规信息,请修改后重新发布"
   - 自动拿当前用户 id(可拿不到就 None)

2) **同步 helper `await enforce_moderation(scene, fields, user_id)`** —— 给 multipart/form
   或需更细控制的端点用
   ```python
   await enforce_moderation(
       "jd:audio",
       {"job_description": req.job_description},
       current_user.id,
   )
   ```

实现注意:
- Depends 工厂走 `request.body()` 重读 JSON,**不能**用 `body: Any`(FastAPI 会当成 query 参数),
  所以选 Request + 手动 JSON parse。
- 这意味着 body 被解析两次(我们一次 + FastAPI 给 endpoint 一次)。feedback body <1KB,
  二次解析 <1ms,可忽略。
- 当前用户解析走 `_resolve_optional_user` 自己读 Authorization header,避免与
  `app.routers.auth` 循环 import。
- multipart/form-data 端点(音频上传、文件上传)不能用 Depends 工厂,改用 helper。
"""
import json
import logging
from typing import Any, Callable, Optional

from fastapi import HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import models
from app.utils.content_moderation import is_rejected, moderate_text, record_audit, should_audit

logger = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════════════
# 内部 helper: 从 Request 解析当前用户(避免循环 import auth)
# ════════════════════════════════════════════════════════════════════

async def _resolve_optional_user(request: Request) -> Optional[models.User]:
    """
    模仿 auth.get_current_user_optional 的逻辑,但不依赖 FastAPI Depends 链。
    读 Authorization header → 校验 JWT → 加载 User。

    Returns None 表示匿名 / token 无效(等价于可选依赖的 fallback)。
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:].strip()
    if not token:
        return None

    # JWT 校验(避免直接 import auth 触发循环)
    from app.utils.security import verify_access_token
    user_id = verify_access_token(token)
    if user_id is None:
        return None

    # 加载用户(独立 db session,避免和 endpoint 的 db 混)
    try:
        from app.database import async_session
        from sqlalchemy import select
        async with async_session() as db:
            result = await db.execute(select(models.User).where(models.User.id == user_id))
            return result.scalars().first()
    except Exception as e:
        logger.warning("[moderation] _resolve_optional_user 失败: %r", e)
        return None


# ════════════════════════════════════════════════════════════════════
# 方案 1: Depends 工厂(JSON 请求体用)
# ════════════════════════════════════════════════════════════════════

def moderated(scene: str, *fields: str) -> Callable:
    """
    FastAPI Depends 工厂:对 Pydantic 请求体的指定字段做内容审核。

    :param scene: 业务场景,审计会带上,如 "feedback"
    :param fields: 字段名列表,支持 dot path 访问嵌套字段,如 "title" / "account.username"
    :return: Depends 注入的可调用对象,挂在 endpoint 形参上

    用法:
        async def create_feedback(
            req: schemas.FeedbackCreate,
            _moderation: None = Depends(moderated("feedback", "title", "description")),
            current_user: models.User = Depends(get_current_user),
            db: AsyncSession = Depends(get_db),
        ): ...
    """
    async def _dep(request: Request) -> None:
        current_user = await _resolve_optional_user(request)

        # 重读 JSON body(已 buffer,二次读 <1ms)
        try:
            body_bytes = await request.body()
            if not body_bytes:
                return
            body = json.loads(body_bytes)
        except (json.JSONDecodeError, UnicodeDecodeError):
            # 不是 JSON(可能是 multipart);交给 endpoint 自己处理
            return

        uid = current_user.id if current_user else None
        for f in fields:
            value: Any = body
            # dot path 解析,支持 "account.username"
            for part in f.split("."):
                if isinstance(value, dict):
                    value = value.get(part)
                else:
                    value = None
                    break
            if not value:
                continue
            text = value if isinstance(value, str) else str(value)
            result = await moderate_text(text, uid, scene=f"{scene}:{f}")
            if is_rejected(result):
                logger.info(
                    "moderated reject scene=%s field=%s user=%s label=%s sub_label=%s",
                    scene, f, uid, result.label, result.sub_label,
                )
                # 违规也要写审计(@moderated raise 之前开独立 session 写,失败不阻塞)
                if should_audit(result):
                    try:
                        from app.database import async_session
                        async with async_session() as audit_db:
                            await record_audit(
                                audit_db,
                                user_id=uid,
                                scene=f"{scene}:{f}",
                                source_type="text",
                                target_id=None,  # 违规没落库,无业务 id
                                result=result,
                                raw_text=text,
                            )
                    except Exception:
                        logger.exception("[moderation] @moderated 审计写入失败(非阻塞)")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="发布内容包含违规信息,请修改后重新发布",
                )

    return _dep


# ════════════════════════════════════════════════════════════════════
# 方案 2: 同步 helper(multipart / 需更细控制的场景)
# ════════════════════════════════════════════════════════════════════

async def enforce_moderation(
    scene_prefix: str,
    fields: dict[str, Any],
    user_id: Optional[int],
) -> None:
    """
    同步阻塞审核一组字段,任一违规抛 400。

    适合 multipart/form-data 端点(audio.py / live.py)或需要手动控制字段来源的场景。

    :param scene_prefix: 业务场景前缀,审计会带上,如 "jd:audio"
    :param fields: 字段名 → 文本值的 dict,空值自动跳过
    :param user_id: 当前用户 id(匿名传 None)
    :raises HTTPException: 400 "发布内容包含违规信息,请修改后重新发布"

    用法:
        await enforce_moderation(
            "jd:audio",
            {"job_description": req.job_description},
            current_user.id,
        )
    """
    for fname, value in fields.items():
        if not value:
            continue
        text = value if isinstance(value, str) else str(value)
        result = await moderate_text(text, user_id, scene=f"{scene_prefix}:{fname}")
        if is_rejected(result):
            logger.info(
                "enforce reject scene=%s field=%s user=%s label=%s sub_label=%s",
                scene_prefix, fname, user_id, result.label, result.sub_label,
            )
            # 违规写审计(独立 session)
            if should_audit(result):
                try:
                    from app.database import async_session
                    async with async_session() as audit_db:
                        await record_audit(
                            audit_db,
                            user_id=user_id,
                            scene=f"{scene_prefix}:{fname}",
                            source_type="text",
                            target_id=None,
                            result=result,
                            raw_text=text,
                        )
                except Exception:
                    logger.exception("[moderation] enforce 审计写入失败(非阻塞)")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="发布内容包含违规信息,请修改后重新发布",
            )
