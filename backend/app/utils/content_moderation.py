"""
内容审核工具

主入口:
- `async moderate_text(text, user_id, scene, audit=True) -> ModerationResult` — 文本审核
- `async moderate_image_bytes(content, user_id, scene) -> ModerationResult` — 图片审核
- `is_rejected(result)` — Pass / Review / Block 决策点
- `record_audit(db, ...)` — 写 ModerationAuditLog

设计要点:
1. 优先走本地兜底词库(毫秒级),命中直接 Block,避免每次都打 TMS。
2. 秘钥缺失时(dev 模式)自动 fail-open,生产 fail-closed 由 CONTENT_MODERATION_FAIL_OPEN 控制。
3. TMS / IMS 调用包 asyncio.wait_for,超时降级到 fail-open / 503。
4. TextModerationRequest.Content 需调用方自行 Base64(SDK 不自动)。
5. ImageModerationRequest.FileContent 走 base64 图片字节(≤5MB)。
6. 审计日志不存明文:仅存 SHA-256 哈希 + content_length + label/score 元数据。
"""
import asyncio
import base64
import hashlib
import logging
import re
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from tencentcloud.common import credential
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.tms.v20201229 import models as tms_models
from tencentcloud.tms.v20201229.tms_client_async import TmsClient
from tencentcloud.ims.v20200713 import models as ims_models
from tencentcloud.ims.v20200713.ims_client_async import ImsClient

from app import models
from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class ModerationResult:
    """审核结果。suggestion 三态:Pass / Review / Block。"""
    suggestion: str
    label: str
    sub_label: str
    score: int
    keywords: list[str]
    is_fallback: bool = False  # True = 走了本地兜底词库,仅用于日志/审计标记


# ── 本地兜底词库 ───────────────────────────────────────
# 仅放最直白、误杀率为 0 的命中词(常见辱骂 / 色情关键词 / 直接威胁)。
# 不放变体(谐音/拆字/拼音),变体识别交给 TMS;不放政治敏感词,
# 政治类全部交给 TMS + 自定义 BizType(运营在控制台配置)。
#
# 命中策略:宁可漏过、不可错杀。命中直接 Block,不看上下文。
# 真实上线前由运营扩充;此处仅作 dev/demo 与网络故障兜底用。
_FALLBACK_WORDS: list[str] = [
    # 常见辱骂(目标产品为求职面试教练,这些是中性事实)
    "傻逼", "草泥马", "操你妈", "妈的智障", "滚蛋",
    # 色情关键词
    "色情", "裸聊", "约炮", "一夜情",
    # 直接暴力威胁
    "弄死你", "杀你全家",
    # 明显广告引流
    "加微信", "兼职日结",
]
# \b 在中文环境下不工作,直接用子串匹配(已足够,因为是高显式词)
_FALLBACK_RE = re.compile("|".join(re.escape(w) for w in _FALLBACK_WORDS))


# ── 主入口 ─────────────────────────────────────────────

async def moderate_text(
    text: str,
    user_id: Optional[int],
    scene: str,
    audit: bool = True,
) -> ModerationResult:
    """
    对单段文本做内容审核。

    :param text: 待审核文本(已被 Pydantic schema 限制长度,本函数不再二次截断)
    :param user_id: 当前用户 id;匿名场景传 None,scene 中会标记为 "guest"
    :param scene: 业务场景标识,会传给 TMS 用于后台分类,例如 "feedback_title" / "feedback_comment"
    :param audit: 是否落审计日志(Phase 2 启用;Phase 3 preview 接口传 False)
    :return: ModerationResult,调用方通过 is_rejected() 判断是否拒绝
    """
    # 空文本短路
    if not text or not text.strip():
        return ModerationResult(
            suggestion="Pass", label="Normal", sub_label="empty",
            score=0, keywords=[],
        )

    text = text.strip()

    # 1) 本地兜底词库(毫秒级,先跑)
    if settings.CONTENT_MODERATION_LOCAL_WORDS_ENABLED:
        fb_hit = _FALLBACK_RE.findall(text)
        if fb_hit:
            logger.info(
                "[moderation] 本地兜底命中 scene=%s user=%s hits=%s",
                scene, user_id, list(set(fb_hit)),
            )
            return ModerationResult(
                suggestion="Block", label="Abuse", sub_label="local_wordlist",
                score=100, keywords=list(set(fb_hit)), is_fallback=True,
            )

    # 2) 秘钥缺失 → fail-open(dev 模式)
    if not (settings.TENCENT_SECRET_ID and settings.TENCENT_SECRET_KEY):
        logger.warning("[moderation] TMS 未配置,自动放行 (dev-mode) scene=%s", scene)
        return ModerationResult(
            suggestion="Pass", label="Normal", sub_label="dev_noop",
            score=0, keywords=[],
        )

    # 3) 调腾讯云 TMS v20201229
    try:
        cred = credential.Credential(
            settings.TENCENT_SECRET_ID, settings.TENCENT_SECRET_KEY,
        )
        client = TmsClient(cred, settings.TMS_REGION)

        req = tms_models.TextModerationRequest()
        # ★ SDK 不会自动 Base64,必须调用方自己编码
        req.Content = base64.b64encode(text.encode("utf-8")).decode("ascii")
        req.BizType = settings.TENCENT_TMS_BIZ_TYPE  # 空 = 默认策略
        req.DataId = (
            f"{scene}:{user_id or 'guest'}:"
            f"{hashlib.sha256(text.encode('utf-8')).hexdigest()[:12]}"
        )
        req.SourceLanguage = "zh"
        if user_id is not None:
            u = tms_models.User()
            u.UserId = str(user_id)
            req.User = u

        resp = await asyncio.wait_for(
            client.TextModeration(req), timeout=settings.TMS_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        logger.exception("[moderation] TMS 调用超时 scene=%s timeout=%ss", scene, settings.TMS_TIMEOUT_S)
        return _on_tms_error(scene, "timeout")
    except TencentCloudSDKException as e:
        logger.exception("[moderation] TMS SDK 异常 scene=%s code=%s msg=%s", scene, e.get_code(), e.get_message())
        return _on_tms_error(scene, f"sdk:{e.get_code()}")
    except Exception as e:  # 网络层 / 其他
        logger.exception("[moderation] TMS 调用失败 scene=%s err=%r", scene, e)
        return _on_tms_error(scene, "unknown")

    # Phase 1 不写审计,Phase 2 在此派发 record_audit 任务
    return ModerationResult(
        suggestion=resp.Suggestion or "Pass",
        label=resp.Label or "Normal",
        sub_label=resp.SubLabel or "",
        score=int(resp.Score or 0),
        keywords=list(resp.Keywords or []),
    )


def _on_tms_error(scene: str, error_code: str) -> ModerationResult:
    """TMS 调用失败的统一处理:fail-open 放行 / fail-closed 抛 503。"""
    if settings.CONTENT_MODERATION_FAIL_OPEN:
        logger.warning(
            "[moderation] TMS 失败但 fail-open=true,自动放行 scene=%s code=%s",
            scene, error_code,
        )
        return ModerationResult(
            suggestion="Pass", label="Normal", sub_label=f"tms_error_open:{error_code}",
            score=0, keywords=[], is_fallback=True,
        )
    # fail-closed:直接 503,不让请求通过
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="服务暂时不可用,请稍后再试",
    )


def is_rejected(result: ModerationResult) -> bool:
    """
    Phase 1 保守策略:Pass 通过;Review / Block 拒绝。

    单一开关点:未来想 Review 也放行,只改这里。
    """
    return result.suggestion in ("Block", "Review")


# ════════════════════════════════════════════════════════════════════
# Phase 2: 图片审核 + 审计日志
# ════════════════════════════════════════════════════════════════════


async def moderate_image_bytes(
    content: bytes,
    user_id: Optional[int],
    scene: str,
) -> ModerationResult:
    """
    对图片二进制做 IMS 审核。

    :param content: 图片字节(≤5MB;由 file.py:95-96 的大小校验守住)
    :param user_id: 当前用户 id
    :param scene: 业务场景标识,例如 "screenshot"
    :return: ModerationResult,调用方通过 is_rejected() 判断

    IMS 5MB 限制与 file.py screenshot 上限对齐,不需要二次校验。
    """
    # 秘钥缺失 → fail-open(dev 态)
    if not (settings.TENCENT_SECRET_ID and settings.TENCENT_SECRET_KEY):
        logger.warning("[moderation] IMS 未配置,自动放行 (dev-mode) scene=%s", scene)
        return ModerationResult(
            suggestion="Pass", label="Normal", sub_label="dev_noop",
            score=0, keywords=[],
        )

    try:
        cred = credential.Credential(
            settings.TENCENT_SECRET_ID, settings.TENCENT_SECRET_KEY,
        )
        client = ImsClient(cred, settings.IMS_REGION)

        req = ims_models.ImageModerationRequest()
        # 图片走 FileContent (base64) 路径;≤5MB 限制已在 file.py 守住
        req.FileContent = base64.b64encode(content).decode("ascii")
        req.BizType = settings.TENCENT_IMS_BIZ_TYPE  # 空 = 默认策略
        req.DataId = (
            f"{scene}:{user_id or 'guest'}:"
            f"{hashlib.sha256(content).hexdigest()[:12]}"
        )
        if user_id is not None:
            u = ims_models.User()
            u.UserId = str(user_id)
            req.User = u

        resp = await asyncio.wait_for(
            client.ImageModeration(req), timeout=settings.TMS_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        logger.exception("[moderation] IMS 调用超时 scene=%s timeout=%ss", scene, settings.TMS_TIMEOUT_S)
        return _on_tms_error(scene, "ims_timeout")
    except TencentCloudSDKException as e:
        logger.exception("[moderation] IMS SDK 异常 scene=%s code=%s msg=%s", scene, e.get_code(), e.get_message())
        return _on_tms_error(scene, f"ims_sdk:{e.get_code()}")
    except Exception as e:
        logger.exception("[moderation] IMS 调用失败 scene=%s err=%r", scene, e)
        return _on_tms_error(scene, "ims_unknown")

    return ModerationResult(
        suggestion=resp.Suggestion or "Pass",
        label=resp.Label or "Normal",
        sub_label=resp.SubLabel or "",
        score=int(resp.Score or 0),
        keywords=[],  # IMS 不返回 Keywords 字段,留空
    )


def hash_keywords(keywords: list[str]) -> list[str]:
    """
    把命中关键词列表转成 SHA-256[:16] 数组,存 JSONB。

    不存明文:运营反查"这个 hash 对应什么词"靠离线对照表;即使审计表泄露,
    也不能还原用户原话。raw_text 也只存 hash,见 record_audit。
    """
    return [
        hashlib.sha256((k or "").encode("utf-8")).hexdigest()[:16]
        for k in keywords if k
    ]


async def record_audit(
    db: AsyncSession,
    user_id: Optional[int],
    scene: str,
    source_type: str,
    target_id: Optional[int],
    result: ModerationResult,
    raw_text: Optional[str] = None,
    error_code: Optional[str] = None,
) -> None:
    """
    落 ModerationAuditLog。

    设计:
    - raw_text 仅用于算 SHA-256 + length,**绝不写入 DB 明文**
    - 与主业务事务共用同一个 db session(便于审计与业务一致性),
      若审计写入失败,只吞异常打 error log,**不**回滚业务事务
    - 调用方决定何时写(默认策略:Review / Block 必写;Pass 可选,
      由 CONTENT_MODERATION_AUDIT_ALL 配置控制)
    """
    try:
        log = models.ModerationAuditLog(
            user_id=user_id,
            scene=scene,
            source_type=source_type,
            target_id=target_id,
            suggestion=result.suggestion,
            label=result.label,
            sub_label=result.sub_label,
            score=result.score,
            content_hash=hashlib.sha256((raw_text or "").encode("utf-8")).hexdigest(),
            content_length=len(raw_text or ""),
            keywords_hash=hash_keywords(result.keywords),
            is_fallback=result.is_fallback,
            error_code=error_code,
        )
        db.add(log)
        await db.commit()
    except Exception:
        logger.exception("[moderation] 写审计失败(非阻塞) scene=%s source=%s", scene, source_type)
        try:
            await db.rollback()
        except Exception:
            pass


def should_audit(result: ModerationResult) -> bool:
    """
    是否需要为这次审核写审计?
    - Review / Block:必写(运营必须看到拦截记录)
    - Pass:默认不写(量大,无审计价值);CONTENT_MODERATION_AUDIT_ALL=True 时全写
    """
    if result.suggestion in ("Block", "Review"):
        return True
    return bool(settings.CONTENT_MODERATION_AUDIT_ALL)


# ════════════════════════════════════════════════════════════════════
# Phase 2: 后台巡检(每 N 小时重扫最近的内容,TMS 模型升级后能发现旧内容)
# ════════════════════════════════════════════════════════════════════

async def run_periodic_rescan() -> None:
    """
    后台循环任务:每隔 CONTENT_MODERATION_RESCAN_HOURS 小时扫一次近 24h 的
    Feedback(title+description)和 FeedbackComment(content),重新调 TMS,把
    新的 Block/Review 写到审计表(同一条文本可能命中多条 audit,用于运营回溯)。

    行为:
    - 失败 / 异常一律 try/except 包住,不 crash loop
    - 内容表本身不改状态(没有 quarantined 列;Phase 2 只审计不删除)
    - 关闭开关 CONTENT_MODERATION_RESCAN_ENABLED=False 时直接退出
    """
    from app.database import async_session
    from sqlalchemy import select

    if not settings.CONTENT_MODERATION_RESCAN_ENABLED:
        logger.info("[moderation-rescan] 后台巡检已禁用")
        return

    interval_s = max(60, settings.CONTENT_MODERATION_RESCAN_HOURS * 3600)
    logger.info("[moderation-rescan] 启动,周期=%ss (%.1fh)", interval_s, interval_s / 3600)

    while True:
        try:
            await _rescan_once()
        except Exception:
            logger.exception("[moderation-rescan] 周期任务异常,将继续下一轮")
        await asyncio.sleep(interval_s)


async def _rescan_once() -> None:
    """单次巡检。"""
    from datetime import datetime, timedelta
    from app.database import async_session
    from sqlalchemy import select

    cutoff = datetime.utcnow() - timedelta(hours=24)
    scanned = 0
    flagged = 0

    async with async_session() as db:
        # 1) Feedback:title + description
        fb_q = select(models.Feedback).where(models.Feedback.created_at >= cutoff)
        fbs = (await db.execute(fb_q)).scalars().all()
        for fb in fbs:
            for field, text in (("feedback_title", fb.title), ("feedback_description", fb.description)):
                if not text:
                    continue
                result = await moderate_text(text, fb.user_id, scene=field)
                scanned += 1
                if should_audit(result):
                    await record_audit(db, fb.user_id, field, "text", fb.id, result, text)
                    flagged += 1

        # 2) FeedbackComment:content
        cm_q = select(models.FeedbackComment).where(models.FeedbackComment.created_at >= cutoff)
        cms = (await db.execute(cm_q)).scalars().all()
        for c in cms:
            if not c.content:
                continue
            result = await moderate_text(c.content, c.user_id, scene="feedback_comment")
            scanned += 1
            if should_audit(result):
                await record_audit(db, c.user_id, "feedback_comment", "text", c.id, result, c.content)
                flagged += 1

    logger.info(
        "[moderation-rescan] 本轮扫描 %d 条,新增审计 %d 条 (含 Review/Block)",
        scanned, flagged,
    )
