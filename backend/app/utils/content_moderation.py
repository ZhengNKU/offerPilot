"""
内容审核工具

主入口:
- `async moderate_text(text, user_id, scene, audit=True) -> ModerationResult` — 本地敏感词审核
- `async moderate_image_bytes(content, user_id, scene) -> ModerationResult` — 图片审核兼容入口(当前不做云审核)
- `is_rejected(result)` — Pass / Review / Block 决策点
- `record_audit(db, ...)` — 写 ModerationAuditLog

设计要点:
1. 文本只走本地内置词库(毫秒级),命中直接 Block。
2. 已下线腾讯云 TMS/IMS 调用,避免内容安全服务产生额外费用。
3. 体验反馈截图不再做云端图片审核,仍保留上传格式/大小校验。
4. 审计日志不存明文:仅存 SHA-256 哈希 + content_length + label/score 元数据。
"""
import asyncio
import hashlib
import logging
import re
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

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
    is_fallback: bool = False  # True = 走了本地内置词库/本地放行,仅用于日志/审计标记


# ── 本地内置词库 ───────────────────────────────────────
# 仅放最直白、误杀率为 0 的命中词(常见辱骂 / 色情关键词 / 直接威胁)。
#
# 命中策略:宁可漏过、不可错杀。命中直接 Block,不看上下文。
# 真实上线前由运营扩充;此处作为唯一的文本安全过滤来源。
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
    :param scene: 业务场景标识,例如 "feedback_title" / "feedback_comment"
    :param audit: 保留兼容参数;preview 接口传 False,当前不在函数内直接写审计
    :return: ModerationResult,调用方通过 is_rejected() 判断是否拒绝
    """
    # 空文本短路
    if not text or not text.strip():
        return ModerationResult(
            suggestion="Pass", label="Normal", sub_label="empty",
            score=0, keywords=[],
        )

    text = text.strip()

    # 本地内置词库(毫秒级)
    if settings.CONTENT_MODERATION_LOCAL_WORDS_ENABLED:
        fb_hit = _FALLBACK_RE.findall(text)
        if fb_hit:
            logger.info(
                "[moderation] 本地词库命中 scene=%s user=%s hits=%s",
                scene, user_id, list(set(fb_hit)),
            )
            return ModerationResult(
                suggestion="Block", label="Abuse", sub_label="local_wordlist",
                score=100, keywords=list(set(fb_hit)), is_fallback=True,
            )

    return ModerationResult(
        suggestion="Pass", label="Normal", sub_label="local_pass",
        score=0, keywords=[], is_fallback=True,
    )


def is_rejected(result: ModerationResult) -> bool:
    """
    Phase 1 保守策略:Pass 通过;Review / Block 拒绝。

    单一开关点:未来想 Review 也放行,只改这里。
    """
    return result.suggestion in ("Block", "Review")


# ════════════════════════════════════════════════════════════════════
# Phase 2: 图片审核兼容入口 + 审计日志
# ════════════════════════════════════════════════════════════════════


async def moderate_image_bytes(
    content: bytes,
    user_id: Optional[int],
    scene: str,
) -> ModerationResult:
    """
    图片审核兼容入口。

    腾讯云 IMS 已下线;体验反馈截图只保留文件格式/大小校验,不再调用云端图片审核。
    保留该函数是为了兼容旧调用点,返回 Pass 不写审计。
    """
    logger.info(
        "[moderation] 图片云审核已关闭,自动放行 scene=%s user=%s size=%s",
        scene, user_id, len(content or b""),
    )
    return ModerationResult(
        suggestion="Pass", label="Normal", sub_label="image_moderation_disabled",
        score=0, keywords=[], is_fallback=True,
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
# Phase 2: 后台巡检(每 N 小时用本地词库重扫最近内容)
# ════════════════════════════════════════════════════════════════════

async def run_periodic_rescan() -> None:
    """
    后台循环任务:每隔 CONTENT_MODERATION_RESCAN_HOURS 小时扫一次近 24h 的
    Feedback(title+description)和 FeedbackComment(content),用本地词库把
    新的 Block 写到审计表(同一条文本可能命中多条 audit,用于运营回溯)。

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
