from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
import asyncio
import json
import logging
import re
import time
import uuid
from datetime import datetime
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from urllib.parse import quote

from app import models
from app.database import get_db, async_session, _get_redis_pool
from app.routers.auth import get_current_user_optional
from app.routers.file import get_cos_client, bucket, delete_file_from_storage
from app.utils.resume_parser import extract_resume_text, parse_resume_structure
from app.services.embedding_indexer import schedule_index
from app.utils.llm import analyze_resume_text
from app.utils.docx_resume_writer import rewrite_resume_docx, generate_structured_resume_docx, BulletMatchError
from app.utils.pdf_resume_writer import generate_pdf_from_analysis
from app.utils.pdf_to_docx import convert_pdf_to_docx
from app.services.quota import FEATURE_RESUME, check_and_consume
from app.utils.privacy import desensitize_text, desensitize_parsed_structure
from app.utils.error_messages import (
    FEATURE_RESUME as FEATURE_NAME_RESUME,
    format_failure,
    REASON_COS_DOWNLOAD_FAILED,
    REASON_FILE_PARSE_FAILED,
    REASON_FILE_EMPTY,
    REASON_LLM_EMPTY,
    REASON_LLM_JSON_PARSE,
    REASON_LLM_TIMEOUT,
    REASON_LLM_MISSING_FIELD,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/resume", tags=["Resume Analysis"])

# ============================================================================
# worker 进程。改为 BackgroundTasks 派发 + task_id + 轮询/SSE。
# 设计参考 audio.py 的 task_store + Channel 模式。
# ============================================================================
import collections

# task_store: task_id -> {file_id, status, progress, analysis_id, error_message}
# status: "pending" | "processing" | "completed" | "failed"
# 单进程内存够用:BackgroundTasks 跑的分析协程和 HTTP handler 协程
# 多 worker(uvicorn --workers 2)下,任务注册在发起 POST /analyze 的 worker 进程内。
# 为了让轮询在任意 worker 都能拿到真实状态,任务状态双写:
#   - 内存 _resume_tasks:分析协程所在 worker 的本地状态 + SSE channel 依赖它
#   - Redis resume:task:{task_id}:跨 worker 共享,status 轮询端点优先读它
# 内存 dict 也顺带保留原有 LRU 上限,防单 worker 内存暴涨。
_resume_tasks: dict = {}
_resume_task_order: "collections.deque[str]" = collections.deque(maxlen=2000)
# Channel 用于 SSE 推送进度;参考 audio.py 的实现。
# 这里用 string forward reference 避开 _ResumeTaskChannel 还没定义的顺序问题。
_resume_task_channels: "dict[str, _ResumeTaskChannel]" = {}

# 任务状态在 Redis 里的保留时间。分析最长约 10min,30min 足够前端轮询完,
# 之后 TTL 自动清理,不需要额外 GC。
RESUME_TASK_REDIS_TTL = 30 * 60


def _resume_redis_key(task_id: str) -> str:
    return f"resume:task:{task_id}"


async def _resume_persist(task_id: str, info: dict) -> None:
    """把任务状态写入 Redis(跨 worker 共享)。失败不阻断分析主流程。"""
    try:
        redis = _get_redis_pool()
        await redis.set(
            _resume_redis_key(task_id),
            json.dumps(info, ensure_ascii=False),
            ex=RESUME_TASK_REDIS_TTL,
        )
    except Exception:
        logger.warning(
            "[resume task=%s] 状态写 Redis 失败,轮询将退化为本 worker 读取",
            task_id,
        )


async def _resume_read(task_id: str) -> Optional[dict]:
    """读任务状态:优先 Redis(跨 worker 真实状态),再本地内存兜底。"""
    try:
        redis = _get_redis_pool()
        raw = await redis.get(_resume_redis_key(task_id))
        if raw:
            return json.loads(raw)
    except Exception:
        pass
    info = _resume_tasks.get(task_id)
    return dict(info) if info else None


class _ResumeTaskChannel:
    """简易 in-memory pub/sub,每个 task 一个 channel,支持多个 SSE 订阅者。

    队列设上限防内存爆炸(单个订阅者异常断开时不会清)。
    """

    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=128)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass

    def publish(self, event: dict) -> None:
        # 不阻塞:慢订阅者会被丢消息而不是卡住发布者
        for q in list(self._subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # 满了就丢;前端会靠 snapshot/heartbeat 救回
                pass


def _resume_get_channel(task_id: str) -> _ResumeTaskChannel:
    ch = _resume_task_channels.get(task_id)
    if ch is None:
        ch = _ResumeTaskChannel()
        _resume_task_channels[task_id] = ch
    return ch


async def _resume_set_progress(task_id: str, pct: int, status_str: str = "processing") -> None:
    """更新任务进度(内存 + Redis),同时 publish 给 SSE 订阅者。"""
    info = _resume_tasks.get(task_id)
    if info is None:
        return
    info["progress"] = pct
    info["status"] = status_str
    await _resume_persist(task_id, info)
    ch = _resume_task_channels.get(task_id)
    if ch is not None:
        # create_task 异步派发,publish 内部已不阻塞
        asyncio.create_task(_safe_publish(ch, {
            "progress": pct,
            "status": status_str,
            "ts": time.time(),
        }))


async def _resume_mark_failed(task_id: str, error_message: str) -> None:
    """把任务标记为 failed(内存 + Redis),并 publish 给 SSE 订阅者。"""
    info = _resume_tasks.get(task_id)
    if info is None:
        return
    info["status"] = "failed"
    info["error_message"] = error_message
    await _resume_persist(task_id, info)
    ch = _resume_task_channels.get(task_id)
    if ch is not None:
        asyncio.create_task(_safe_publish(ch, {
            "progress": info["progress"],
            "status": "failed",
            "ts": time.time(),
        }))


async def _safe_publish(ch: _ResumeTaskChannel, event: dict) -> None:
    """协程化的 publish,便于失败时吞掉异常不污染任务流。"""
    try:
        ch.publish(event)
    except Exception:
        pass


async def _resume_register_task(task_id: str, file_id: int, user_id: Optional[int]) -> None:
    _resume_tasks[task_id] = {
        "file_id": file_id,
        "user_id": user_id,
        "status": "pending",
        "progress": 0,
        "analysis_id": None,
        "error_message": None,
        "created_at": time.time(),
    }
    await _resume_persist(task_id, _resume_tasks[task_id])
    _resume_task_order.append(task_id)
    # 兜底:删旧 task 防内存涨(Redis 里的状态靠 TTL 清理,这里顺手删掉)
    while len(_resume_tasks) > 1500:
        old_id = _resume_task_order.popleft()
        _resume_tasks.pop(old_id, None)
        ch = _resume_task_channels.pop(old_id, None)
        if ch is not None:
            for q in ch._subscribers:
                try:
                    q.put_nowait({"status": "expired", "ts": time.time()})
                except Exception:
                    pass
        try:
            redis = _get_redis_pool()
            await redis.delete(_resume_redis_key(old_id))
        except Exception:
            pass


class ResumeAnalyzeRequest(BaseModel):
    file_id: int

@router.post("/analyze")
async def analyze_resume(
    req: ResumeAnalyzeRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """简历分析 — 异步派发端点(2026-08-04+重构)。

    老的同步实现:POST 等 ~7min LLM 返回 → 期间卡住整个 worker 线程池,
    其他用户的下载/API 全排队。改造后:
      1. 立即做轻量校验(file 存在/类型/权限)
      2. 分配 task_id,BackgroundTasks 派发到 _run_resume_analysis_impl
      3. 立即返回 {task_id, file_id, status: "pending"}
      4. 前端轮询 /api/resume/analyze/status/{task_id} 或订阅 SSE 流

    行为契约:
      - status: pending → processing → completed | failed
      - 失败时 error_message 含可读中文原因
      - 完成后 analysis_id = ResumeAnalysis.id,前端用它 GET /api/resume/analyses/{id}
    """
    # 1. 校验 file 存在 / 类型 / 权限
    result = await db.execute(select(models.UploadedFile).where(models.UploadedFile.id == req.file_id))
    db_file = result.scalars().first()
    if not db_file:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="简历文件不存在")
    if db_file.file_type != "resume":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该文件不是简历文件")
    if db_file.user_id is not None:
        if not current_user or current_user.id != db_file.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该简历文件")

    # 2. 分配 task_id 并注册
    task_id = str(uuid.uuid4())
    user_id = current_user.id if current_user else None
    await _resume_register_task(task_id, req.file_id, user_id)

    # 3. 派发到后台(BackgroundTasks 在响应返回后跑,不影响主请求)
    background_tasks.add_task(
        _run_resume_analysis_impl, req.file_id, task_id, user_id
    )

    return {
        "task_id": task_id,
        "file_id": req.file_id,
        "status": "pending",
    }


async def _run_resume_analysis_impl(file_id: int, task_id: str, user_id: Optional[int]):
    """后台跑真实分析逻辑。从原 analyze_resume 路由搬过来,加进度推进 + 失败兜底。

    进度推进节点(给前端显示用):
      5  → fetch_file ok
      15 → COS download ok
      30 → parse ok
      50 → LLM analyze 开始(大头,等 ~7min)
      90 → 后处理 + 持久化
      100 → completed

    任何 step 抛异常都会被外层 try/except 接住,把 task_store.status="failed",
    前端轮询时拿到 error_message。
    """
    try:
        await _run_resume_analysis_impl_inner(file_id, task_id, user_id)
    except HTTPException as he:
        # 配额耗尽等明确错误
        reason = he.detail if isinstance(he.detail, str) else str(he.detail)
        await _resume_mark_failed(task_id, reason)
        logger.warning(f"[resume task={task_id}] failed: {he.detail!r}")
    except Exception as e:
        # 兜底:任何未捕获异常 → failed + error_message
        logger.exception(f"[resume task={task_id}] ❌ 未捕获异常")
        reason = str(e) or "分析失败"
        if len(reason) > 200:
            reason = reason[:200] + "..."
        await _resume_mark_failed(task_id, format_failure(FEATURE_NAME_RESUME, reason))


async def _run_resume_analysis_impl_inner(file_id: int, task_id: str, user_id: Optional[int]):
    # ── 阶段计时：日志一眼看出哪一段慢(对齐 audio.py 的 _stage 打点) ──
    t_total = time.monotonic()
    t_stage = time.monotonic()

    def _log_stage(name: str) -> None:
        nonlocal t_stage
        elapsed = time.monotonic() - t_stage
        logger.info(f"[resume task={task_id}] ▶ stage={name} elapsed={elapsed:.2f}s")
        t_stage = time.monotonic()

    # ── Step 0: 开自己的 db session,不能复用 Depends 注入的 ──
    async with async_session() as db:
        # ── Step 1: 取 file ──
        await _resume_set_progress(task_id, 5, "processing")
        result = await db.execute(select(models.UploadedFile).where(models.UploadedFile.id == file_id))
        db_file = result.scalars().first()
        if not db_file:
            raise RuntimeError("简历文件不存在")
        _log_stage("1_fetch_file")

        # ── Step 2: COS 下载 ──
        await _resume_set_progress(task_id, 15, "processing")
        client = get_cos_client()
        try:
            response = await asyncio.to_thread(
                client.get_object,
                Bucket=bucket,
                Key=db_file.cos_key
            )
            body_stream = response['Body']
            if hasattr(body_stream, 'get_raw_stream'):
                content_bytes = body_stream.get_raw_stream().read()
            else:
                content_bytes = body_stream.read()
        except Exception as e:
            logger.exception(f"[resume task={task_id}] COS 下载失败: {e!r}")
            await delete_file_from_storage(db, db_file)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=format_failure(FEATURE_NAME_RESUME, REASON_COS_DOWNLOAD_FAILED),
            )
        _log_stage("2_cos_download")

        # ── Step 3: 解析为纯文本 ──
        await _resume_set_progress(task_id, 30, "processing")
        try:
            resume_text = extract_resume_text(content_bytes, db_file.filename)
        except ValueError as ve:
            await delete_file_from_storage(db, db_file)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=format_failure(FEATURE_NAME_RESUME, f"文件格式不支持：{ve}"),
            )
        except Exception as e:
            logger.exception(f"[resume task={task_id}] 解析失败: {e!r}")
            await delete_file_from_storage(db, db_file)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=format_failure(FEATURE_NAME_RESUME, REASON_FILE_PARSE_FAILED),
            )
        if not resume_text.strip():
            await delete_file_from_storage(db, db_file)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=format_failure(FEATURE_NAME_RESUME, REASON_FILE_EMPTY),
            )
        _log_stage("3_parse")

        # ── Step 4: 服务端正则解析 + 隐私脱敏 ──
        parsed_structure = parse_resume_structure(resume_text)
        resume_text = desensitize_text(resume_text)
        parsed_structure = desensitize_parsed_structure(parsed_structure)

        # ── Step 4.6: 取 profile ──
        current_user = None
        profile_data = None
        if user_id:
            # eager-load profile: async 模式下 lazy load 会触发 MissingGreenlet
            current_user = await db.get(
                models.User,
                user_id,
                options=[selectinload(models.User.profile)],
            )
        if current_user and current_user.profile:
            p = current_user.profile
            profile_data = {
                "name": current_user.username,
                "status": "在职" if p.job_status == "active" else "离职" if p.job_status == "resigned" else "应届生" if p.job_status == "fresh_grad" else "在校生",
                "experience_years": f"{p.experience_years or '在校'}{p.experience_months or '0个月'}",
                "company_name": p.company_name or "暂无",
                "role_name": p.role_name or "暂无",
                "salary": f"{p.salary_min or 0}K - {p.salary_max or 0}K",
                "target_company": p.target_company or "暂无",
                "target_role": p.target_role or "暂无",
                "target_grade": p.target_grade or "暂无",
                "target_salary": f"{p.target_salary_min or 0}K - {p.target_salary_max or 0}K"
            }
        _log_stage("4_prep")

        # ── Step 5: LLM 分析(大头) ──
        await _resume_set_progress(task_id, 50, "processing")

        # 假进度:LLM 单次调用长且没有子进度,启动一个后台协程把 50→85 平滑推进,
        # 让前端进度条在 LLM 阶段持续移动,不再卡在 50/95(同 audio.py _fake_asr_progress)。
        async def _fake_llm_progress():
            try:
                pct = 50
                while pct < 85:
                    await asyncio.sleep(2.0)
                    pct = min(85, pct + 1)
                    # 注意:第一个参数必须是 task_id(漏传会把 pct 当成 task_id,
                    # _resume_tasks.get(pct) 为 None 直接 return,假进度完全不推进)
                    await _resume_set_progress(task_id, pct, "processing")
            except asyncio.CancelledError:
                pass

        fake_task = asyncio.create_task(_fake_llm_progress())
        try:
            analysis_result = await analyze_resume_text(
                resume_text, profile_data, parsed_structure=parsed_structure
            )
        except Exception as e:
            logger.exception(f"[resume task={task_id}] LLM 分析失败: {e!r}")
            await delete_file_from_storage(db, db_file)
            reason = str(e) or "AI 调用失败"
            if len(reason) > 200:
                reason = reason[:200] + "..."
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=format_failure(FEATURE_NAME_RESUME, reason),
            )
        finally:
            fake_task.cancel()  # LLM 返回(成功或异常)都停掉假进度,后续走真实 90/100
        _log_stage("5_llm_analyze")

        if not analysis_result:
            await delete_file_from_storage(db, db_file)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=format_failure(FEATURE_NAME_RESUME, REASON_LLM_EMPTY),
            )

        # ── Step 6: 后处理 + 持久化 ──
        await _resume_set_progress(task_id, 90, "processing")
        analysis_result["raw_resume_text"] = resume_text
        _merge_parsed_structure(analysis_result, parsed_structure)

        profile_section = analysis_result.get("profile")
        if isinstance(profile_section, dict):
            if current_user:
                # 仅当 profile 里的姓名缺失或为通用占位符/账号名 aa 时，才兜底用 current_user.username
                curr_name = (profile_section.get("name") or "").strip()
                if not curr_name or curr_name in ("候选人", "基本信息", "个人信息", "简历信息", "个人简历", "求职意向", "基本资料", "aa", "XXX"):
                    profile_section["name"] = current_user.username or "候选人"
                if current_user.profile:
                    p = current_user.profile
                    annotated_salary = _format_salary_range(p.salary_min, p.salary_max)
                    if annotated_salary:
                        profile_section["salary"] = annotated_salary
                    if (not profile_section.get("company") or profile_section.get("company") == "-") and p.company_name and p.company_name.strip() not in ("暂无", "暂无公司", "-"):
                        profile_section["company"] = p.company_name.strip()
                    if (not profile_section.get("role") or profile_section.get("role") == "-") and p.role_name and p.role_name.strip() not in ("暂无", "-"):
                        profile_section["role"] = p.role_name.strip()
                        profile_section["title"] = p.role_name.strip()
            else:
                if not profile_section.get("name") or profile_section.get("name") in ("基本信息", "个人信息", "简历信息", "个人简历", "求职意向", "基本资料"):
                    profile_section["name"] = "候选人"
                if not profile_section.get("company") or profile_section.get("company") in ("暂无", "暂无公司", "无", "None", "null", "未填写"):
                    profile_section["company"] = "-"
                if not profile_section.get("role") or profile_section.get("role") in ("暂无", "无", "None", "null", "未填写"):
                    profile_section["role"] = "-"
                    profile_section["title"] = "-"

        _normalize_structure_analysis(analysis_result)

        if isinstance(profile_section, dict):
            for _key in ("company", "role", "title"):
                _v = profile_section.get(_key)
                if not _v or str(_v).strip() in ("暂无", "暂无公司", "无", "None", "null", "未填写", ""):
                    profile_section[_key] = "-"

        breakdown = _compute_score_breakdown(analysis_result)
        analysis_result["score_breakdown"] = breakdown
        analysis_result["score"] = breakdown["weighted"]
        analysis_result["optimized_score"] = min(100, breakdown["weighted"] + 10)

        _enrich_metrics(analysis_result, resume_text=resume_text)

        # 配额扣减(成功才扣)
        if current_user and db_file.user_id == current_user.id:
            from sqlalchemy import func as _func
            prev_count_res = await db.execute(
                select(_func.count(models.ResumeAnalysis.id)).where(
                    models.ResumeAnalysis.file_id == db_file.id
                )
            )
            prev_count = prev_count_res.scalar() or 0
            if prev_count == 0:
                await check_and_consume(db, current_user, FEATURE_RESUME)
                logger.info(
                    f"[resume task={task_id}] 简历分析成功,扣额度 user_id={current_user.id} "
                    f"file_id={db_file.id}"
                )
            else:
                logger.info(
                    f"[resume task={task_id}] 重分析(file_id={db_file.id} 已有 {prev_count} 条历史),不重复扣"
                )

        # 持久化
        record = models.ResumeAnalysis(
            user_id=user_id,
            file_id=db_file.id,
            score=_safe_int(analysis_result.get("score")),
            optimized_score=_safe_int(analysis_result.get("optimized_score")),
            ats_pass_rate=_safe_int(analysis_result.get("ats_pass_rate")),
            result_json=analysis_result,
        )
        db.add(record)
        await db.commit()
        await db.refresh(record)

        if user_id:
            schedule_index({
                "kind": "resume_analysis",
                "user_id": user_id,
                "resume_analysis_id": record.id,
            })
            from app.services.advisor_generator import trigger_custom_advisor_insights
            asyncio.create_task(trigger_custom_advisor_insights(user_id))

            # 项目记忆提取:放在分析成功持久化之后(fire-and-forget),
            # 避免分析失败时已入库的项目记忆成为孤儿(事务一致性)
            from app.services.project_memory_agent import _run_project_memory_sub_agent
            asyncio.create_task(
                _run_project_memory_sub_agent({
                    "user_id": user_id,
                    "file_id": db_file.id,
                    "resume_text": resume_text,
                })
            )

        _log_stage("6_post_process_persist")

        # ── 完成 ──
        _resume_tasks[task_id]["status"] = "completed"
        _resume_tasks[task_id]["progress"] = 100
        _resume_tasks[task_id]["analysis_id"] = record.id
        await _resume_set_progress(task_id, 100, "completed")
        logger.info(
            f"[resume task={task_id}] ✅ completed analysis_id={record.id} "
            f"total_elapsed={time.monotonic() - t_total:.2f}s"
        )


@router.get("/analyze/status/{task_id}")
async def get_resume_analyze_status(task_id: str):
    """轮询端点。返回 task 完整状态。

    前端每 N 秒(见文档建议)拉一次,拿到 status="completed" 后调用
    /api/resume/analyses/{analysis_id} 拿结果数据。

    多 worker 行为:任务状态双写内存 + Redis(_resume_persist),这里优先读
    Redis,因此轮询请求被路由到任何一个 worker 都能拿到真实进度/结果,
    不会因为落到非持有者 worker 而 404 或看到假 pending。
    仅当 Redis 里也没有(写入失败且非本 worker / 已过期)时,才返回 pending
    让前端继续轮询,前端行为与原来一致。
    """
    info = await _resume_read(task_id)
    if info is None:
        return {
            "status": "pending",
            "progress": 0,
            "detail": "任务状态暂不可读(可能已过期),请继续轮询或重新发起分析",
        }
    return info


@router.get("/analyze/status/{task_id}/stream")
async def stream_resume_analyze_status(task_id: str):
    """SSE 实时进度推送(参考 audio.py 的 stream_task_progress)。

    事件序列:
      - event: snapshot   首条当前完整快照
      - event: progress   后续 _set_progress 触发
      - event: heartbeat  15s 无更新

    客户端拿到 status="completed"/"failed"/"expired" 后关流。
    """
    if task_id not in _resume_tasks:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="分析任务不存在")

    ch = _resume_get_channel(task_id)
    q = ch.subscribe()

    async def event_generator():
        try:
            snapshot = {
                "progress": _resume_tasks[task_id]["progress"],
                "status": _resume_tasks[task_id]["status"],
                "analysis_id": _resume_tasks[task_id].get("analysis_id"),
                "error_message": _resume_tasks[task_id].get("error_message"),
            }
            yield _format_sse("snapshot", snapshot)
            if snapshot["status"] in ("completed", "failed", "expired"):
                return
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield _format_sse("heartbeat", {"ts": time.time()})
                    continue
                yield _format_sse("progress", event)
                if event.get("status") in ("completed", "failed", "expired"):
                    return
        finally:
            ch.unsubscribe(q)

    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _format_sse(event: str, data: dict) -> str:
    """拼 SSE 数据行。空 data 会变成单空格(避免某些代理把它当 keepalive)。"""
    import json
    payload = json.dumps(data, ensure_ascii=False, default=str)
    return f"event: {event}\ndata: {payload}\n\n"


@router.get("/analyses")
async def list_resume_analyses(
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """
    当前用户的所有简历诊断历史概要。
    未登录用户：返回空列表（历史报告跟用户绑定）。
    """
    if not current_user:
        return {"items": []}

    stmt = (
        select(models.ResumeAnalysis, models.UploadedFile.filename)
        .join(models.UploadedFile, models.ResumeAnalysis.file_id == models.UploadedFile.id)
        .where(models.ResumeAnalysis.user_id == current_user.id)
        .order_by(models.ResumeAnalysis.created_at.desc())
    )
    rows = (await db.execute(stmt)).all()

    items = []
    for ra, filename in rows:
        items.append({
            "id": ra.id,
            "file_id": ra.file_id,
            "filename": filename,
            "score": ra.score,
            "optimized_score": ra.optimized_score,
            "ats_pass_rate": ra.ats_pass_rate,
            "created_at": ra.created_at.isoformat() if ra.created_at else None,
        })
    return {"items": items}


@router.get("/analyses/{analysis_id}/download")
async def download_resume_analysis(
    analysis_id: int,
    file_format: str = "pdf",
    source: str = "original",
    template: str = "minimal",
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """下载简历文件（基于用户上传的原简历文件进行改写与导出）。

    - 存在原简历文件：
      * 原简历为 DOCX/PDF：原位置保留原格式/字号/表格/排版，将 bullet 替换为 AI 优化版本并转为 PDF / DOCX。
      * 若选择原简历内容：直接基于原简历原始二进制导出 PDF / DOCX。
    - 无原文件记录时：回退到通用高保真 PDF 渲染。
    """
    stmt = select(models.ResumeAnalysis).where(models.ResumeAnalysis.id == analysis_id)
    ra = (await db.execute(stmt)).scalars().first()
    if not ra:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="简历分析记录不存在")
    if ra.user_id is not None:
        if not current_user or current_user.id != ra.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该简历分析记录")

    analysis_data = ra.result_json or {}
    if isinstance(analysis_data, dict) and "parsed_structure" in analysis_data:
        parsed_struct = analysis_data["parsed_structure"]
    else:
        parsed_struct = analysis_data.get("parsed_structure") or {}

    profile = analysis_data.get("profile") or (parsed_struct.get("profile") if isinstance(parsed_struct, dict) else {}) or {}
    raw_name = (profile.get("name") or "").strip() or "候选人"
    safe_name = _sanitize_filename(raw_name)
    today = datetime.now().strftime("%Y-%m-%d")

    # 检查是否有用户上传的原简历文件
    file_stmt = select(models.UploadedFile).where(models.UploadedFile.id == ra.file_id)
    db_file = (await db.execute(file_stmt)).scalars().first() if ra.file_id else None

    # === 路径 A: 存在用户提交的原简历文件 ===
    if db_file:
        src_ext = (db_file.filename or "").rsplit(".", 1)[-1].lower()
        try:
            content_bytes = await _download_from_cos(db_file.cos_key)

            # A1. 用户选择【原简历内容】(完全保留原始提交文件)
            if source == "original":
                if file_format.lower() == "pdf":
                    if src_ext == "pdf":
                        # 直接返回原 PDF 文件
                        encoded_filename = quote(f"面试驾到_原简历_{safe_name}_{today}.pdf")
                        headers = {
                            "Content-Disposition": f'attachment; filename="{encoded_filename}"; filename*=UTF-8\'\'{encoded_filename}',
                            "Access-Control-Expose-Headers": "Content-Disposition",
                        }
                        return Response(content=content_bytes, media_type="application/pdf", headers=headers)
                    else:
                        # 原文件是 DOCX，转成 PDF
                        pdf_bytes = await asyncio.to_thread(docx_to_pdf, content_bytes)
                        encoded_filename = quote(f"面试驾到_原简历_{safe_name}_{today}.pdf")
                        headers = {
                            "Content-Disposition": f'attachment; filename="{encoded_filename}"; filename*=UTF-8\'\'{encoded_filename}',
                            "Access-Control-Expose-Headers": "Content-Disposition",
                        }
                        return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
                else:
                    # 下载原 DOCX 文件
                    return _make_file_response(content_bytes, safe_name, today)

            # A2. 用户选择【AI 优化版履历】(在原简历文件排版上进行文字就地替换改写)
            docx_source_bytes = content_bytes
            if src_ext == "pdf":
                # PDF 原文件转 DOCX 以进行文本改写
                docx_source_bytes = await asyncio.to_thread(convert_pdf_to_docx, content_bytes)

            try:
                rewritten_docx_bytes = await asyncio.to_thread(rewrite_resume_docx, docx_source_bytes, analysis_data)
            except Exception as rw_err:
                logger.warning("[resume_download] 就地改写失败，走结构化 DOCX 兜底: %s", rw_err)
                rewritten_docx_bytes = await asyncio.to_thread(generate_structured_resume_docx, analysis_data)

            if file_format.lower() == "pdf":
                pdf_bytes = await asyncio.to_thread(docx_to_pdf, rewritten_docx_bytes)
                encoded_filename = quote(f"面试驾到_AI优化简历_{safe_name}_{today}.pdf")
                headers = {
                    "Content-Disposition": f'attachment; filename="{encoded_filename}"; filename*=UTF-8\'\'{encoded_filename}',
                    "Access-Control-Expose-Headers": "Content-Disposition",
                }
                return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
            else:
                return _make_file_response(rewritten_docx_bytes, safe_name, today)

        except Exception as e:
            logger.warning("[resume_download] 基于原简历文件修改/转码失败，走全局 PDF/DOCX 兜底生成: %s", e)

    # === 路径 B: 无原文件记录或云端拉取失败时的通用 PDF / DOCX 兜底绘制 ===
    if file_format.lower() == "pdf":
        pdf_bytes = await asyncio.to_thread(
            generate_pdf_from_analysis,
            analysis_data,
            source=source,
            template=template,
        )
        encoded_filename = quote(f"面试驾到_简历_{safe_name}_{today}.pdf")
        headers = {
            "Content-Disposition": f'attachment; filename="{encoded_filename}"; filename*=UTF-8\'\'{encoded_filename}',
            "Access-Control-Expose-Headers": "Content-Disposition",
        }
        return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
    else:
        docx_bytes = await asyncio.to_thread(generate_structured_resume_docx, analysis_data)
        return _make_file_response(docx_bytes, safe_name, today)


async def select_resume_template_llm(analysis_data: Dict[str, Any]) -> Dict[str, Any]:
    """结合之前大模型已输出的优化后简历上下文（profile, work_experiences, projects, summary等），
    二次调用大模型，由大模型自主智能判定最适合该求职者的简历排版模板（classic, minimal, twocolumn, mint, morandi）并说明推荐理由。
    """
    profile = analysis_data.get("profile") or {}
    parsed_struct = analysis_data.get("parsed_structure") or {}
    raw_role = profile.get("target_role") or profile.get("role") or parsed_struct.get("target_role") or analysis_data.get("job_target") or ""
    if not raw_role or raw_role.strip() in ("-", "未填写", "None", "null", "暂无"):
        target_role = "求职目标岗位"
    else:
        target_role = raw_role.strip()

    summary = (analysis_data.get("summary") or profile.get("summary") or "").strip()
    work_exps = analysis_data.get("work_experiences") or []
    projects = analysis_data.get("projects") or analysis_data.get("personal_projects") or []

    exp_summary = []
    for w in work_exps[:3]:
        company = w.get("company", "")
        role = w.get("role", "")
        exp_summary.append(f"{company} - {role}")

    proj_summary = []
    for p in projects[:3]:
        name = p.get("name") or p.get("title") or ""
        proj_summary.append(name)

    context_str = f"""
- 个人优势总结: {summary[:150] if summary else '暂无'}
- 核心工作经历: {', '.join(exp_summary) if exp_summary else '暂无'}
- 核心项目案例: {', '.join(proj_summary) if proj_summary else '暂无'}
"""

    prompt = f"""你是一位顶级 HR 和职业生涯排版专家。
请根据以下求职者简历的核心上下文信息：
{context_str}

请从以下 5 套精致简历排版模板中，由你自主智能决策选出唯一最契合该求职者履历风格与内容密度的模板：

可选模板列表：
1. minimal (极简纯白): 高对比度纯文本排版，极高 ATS 过审率，适合通用岗位、应届生、文字与基础履历
2. twocolumn (沉稳双栏): 左侧技能与履历、右侧经历与项目，立体展示，适合资深技术、架构师、复合型高密履历
3. burgundy (典雅酒红): 深红雅致线条，彰显高端专业力，适合管理、金融、咨询与高管
4. geek (极客风尚): 极客程序员风格，高亮技术栈与算力成果，适合互联网、AI/算法、程序员、产品经理
5. bluegrey (清新蓝灰): 蓝灰柔和圆角卡片，视觉优雅柔和，适合设计、市场、商务、通用职位

请严格输出 JSON 格式（不要包含任何 markdown 代码块标识）。
输出 JSON 示例格式如下（仅作为格式参考示例，请务必根据当前求职者的真实情况动态生成对应的推荐模板 ID 与个性化推荐理由）：
{{
  "recommended_template": "minimal",
  "recommend_reason": "根据您丰富的实习经历与清晰的条理结构，推荐采用【极简纯白】模板，突出核心工作与项目表达。"
}}
注：请勿在推荐理由中出现任何目标岗位字样。
"""

    payload = {
        "model": settings.DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": "你是一位专业的 HR 简历排版判别专家。请严格只输出 JSON。"},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"}
    }

    try:
        from app.utils.llm import call_llm_stream
        res = await asyncio.to_thread(call_llm_stream, payload, 25.0)
        content = res.get("choices", [{}])[0].get("message", {}).get("content", "")
        clean_json = re.sub(r"^```json\s*", "", content.strip())
        clean_json = re.sub(r"\s*```$", "", clean_json)
        parsed = json.loads(clean_json)
        if "recommended_template" in parsed:
            return parsed
    except Exception as e:
        logger.warning("[select_template_llm] LLM call failed or timeout: %s", e)

    return {
        "recommended_template": "minimal",
        "recommend_reason": "根据您的履历风格与内容密度，AI 已为您智能匹配最合适排版模板。"
    }


@router.post("/analyses/{analysis_id}/select-template")
async def select_resume_template(
    analysis_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    """点击「下载优化版简历」时再次调用大模型，结合上面大模型已输出的优化简历上下文，由大模型自主智能判定最匹配的简历模板。"""
    stmt = select(models.ResumeAnalysis).where(models.ResumeAnalysis.id == analysis_id)
    ra = (await db.execute(stmt)).scalars().first()
    if not ra:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="简历分析记录不存在")
    if ra.user_id is not None:
        if not current_user or current_user.id != ra.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该简历分析记录")

    analysis_data = ra.result_json or {}
    result = await select_resume_template_llm(analysis_data)
    return {"success": True, "data": result}


async def _fetch_file_bytes(cos_key: str) -> bytes:
    """从 COS 或本地文件系统读取简历二进制内容。"""
    import os
    if cos_key and os.path.exists(cos_key):
        with open(cos_key, "rb") as f:
            return f.read()
    client = get_cos_client()
    response = await asyncio.to_thread(
        client.get_object,
        Bucket=bucket,
        Key=cos_key
    )
    body_stream = response['Body']
    if hasattr(body_stream, 'get_raw_stream'):
        return body_stream.get_raw_stream().read()
    else:
        return body_stream.read()


def _backfill_missing_sections(res_data: dict) -> None:
    """当源简历文件不可从 COS 重新下载（如老历史记录 NoSuchKey）时，
    从现有 analysis_result 的 work_experiences 和 structure_analysis 智能提取与回填缺失的 skills, summary, profile 等。
    """
    if not isinstance(res_data, dict):
        return

    # 1. 技能提取：从工作经历 bullets 中提取提到的开源/技术栈/框架
    skills = res_data.get("skills")
    if not skills:
        tech_keywords = [
            "Java", "Go", "Python", "C++", "Spring Boot", "SpringBoot", "Spring Cloud",
            "MyBatis", "Redis", "RabbitMQ", "Kafka", "RocketMQ", "Elasticsearch",
            "MySQL", "Nacos", "Docker", "Kubernetes", "RPC", "RESTful", "Linux",
            "JVM", "Netty", "Dubbo", "SQL", "Git", "Code Review", "IK分词器"
        ]
        found_skills = set()
        work_exps = res_data.get("work_experiences") or []
        for w in work_exps:
            for b in (w.get("bullets") or []):
                txt = (b.get("originalText") or b.get("optimizedText") or (str(b) if isinstance(b, str) else ""))
                for kw in tech_keywords:
                    if re.search(r"\b" + re.escape(kw) + r"\b", txt, re.IGNORECASE) or kw in txt:
                        found_skills.add(kw)
        if found_skills:
            res_data["skills"] = list(sorted(found_skills))

    # 2. 个人总结提取：从 structure_analysis 或 ai_suggestions 提取
    if not res_data.get("summary"):
        struct = res_data.get("structure_analysis") or {}
        summary_desc = (struct.get("professional_capability") or {}).get("desc") or (struct.get("work_experience") or {}).get("desc")
        if summary_desc and summary_desc != "暂无分析":
            res_data["summary"] = summary_desc

    # 3. 个人 Profile 保障
    prof = res_data.get("profile")
    if not isinstance(prof, dict):
        prof = {}
        res_data["profile"] = prof

    if not prof.get("name") or prof.get("name") in ("基本信息", "个人信息", "简历信息", "个人简历", "求职意向", "基本资料", "aa", "XXX"):
        prof["name"] = "候选人"


@router.get("/analyses/{analysis_id}")
async def get_resume_analysis(
    analysis_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    stmt = select(models.ResumeAnalysis).where(models.ResumeAnalysis.id == analysis_id)
    ra = (await db.execute(stmt)).scalars().first()
    if not ra:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="简历分析记录不存在")
    if ra.user_id is not None:
        if not current_user or current_user.id != ra.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该简历分析记录")

    res_data = dict(ra.result_json) if ra.result_json else {}

    # 自动重解析原简历文件，补全 education / projects / skills / summary / 真实姓名
    if ra.file_id:
        try:
            file_stmt = select(models.UploadedFile).where(models.UploadedFile.id == ra.file_id)
            db_file = (await db.execute(file_stmt)).scalars().first()
            if db_file:
                content_bytes = await _fetch_file_bytes(db_file.cos_key)
                src_text = extract_resume_text(content_bytes, db_file.filename)
                if src_text and src_text.strip():
                    parsed_struct = parse_resume_structure(src_text)
                    res_data["raw_resume_text"] = src_text
                    _merge_parsed_structure(res_data, parsed_struct)
        except Exception as e:
            logger.warning("[get_resume_analysis] Dynamic re-parse failed for analysis_id=%s: %s", analysis_id, e)

    # 兜底：如果重解析未触发或源文件丢失（NoSuchKey），从已有的结构化诊断中抽取补全 skills / summary / profile
    _backfill_missing_sections(res_data)
    ra.result_json = res_data
    await db.commit()

    if "profile" in res_data and isinstance(res_data["profile"], dict):
        prof = res_data["profile"]
        curr_name = (prof.get("name") or "").strip()
        if not curr_name or curr_name in ("基本信息", "个人信息", "简历信息", "个人简历", "求职意向", "基本资料", "aa", "XXX"):
            if current_user and current_user.username and current_user.username not in ("aa", "XXX"):
                prof["name"] = current_user.username
            else:
                prof["name"] = "候选人"
        if current_user and current_user.profile:
            p = current_user.profile
            if (not prof.get("company") or prof.get("company") == "-") and p.company_name and p.company_name.strip() not in ("暂无", "暂无公司", "-"):
                prof["company"] = p.company_name.strip()
            if (not prof.get("role") or prof.get("role") == "-") and p.role_name and p.role_name.strip() not in ("暂无", "-"):
                prof["role"] = p.role_name.strip()
                prof["title"] = p.role_name.strip()

    _enrich_metrics(res_data)

    return {
        "id": ra.id,
        "file_id": ra.file_id,
        "created_at": ra.created_at.isoformat() if ra.created_at else None,
        **res_data,
    }


@router.delete("/analyses/{analysis_id}")
async def delete_resume_analysis(
    analysis_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional)
):
    stmt = select(models.ResumeAnalysis).where(models.ResumeAnalysis.id == analysis_id)
    ra = (await db.execute(stmt)).scalars().first()
    if not ra:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="简历分析记录不存在")
    if ra.user_id is not None:
        if not current_user or current_user.id != ra.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该简历分析记录")

    file_id = ra.file_id
    await db.delete(ra)
    await db.commit()

    # 级联删除原简历文件(独立步骤,失败不影响历史记录删除):
    # 若没有其他简历分析引用同一文件,则原文件不再需要(生成优化版简历必须读它,记录删光即无用)
    if file_id is not None:
        try:
            async with async_session() as db2:
                remaining = await db2.execute(
                    select(models.ResumeAnalysis.id)
                    .where(models.ResumeAnalysis.file_id == file_id)
                    .limit(1)
                )
                if remaining.scalars().first() is None:
                    f_res = await db2.execute(
                        select(models.UploadedFile).where(models.UploadedFile.id == file_id)
                    )
                    f = f_res.scalars().first()
                    if f:
                        await delete_file_from_storage(db2, f)
                        logger.info(f"[resume] 删除分析 {analysis_id} 级联删除原文件 file_id={file_id}")
        except Exception:
            logger.exception(f"[resume] 删除分析 {analysis_id} 级联删文件失败 file_id={file_id}")

    return {"message": "删除成功"}


def _sanitize_filename(name: str) -> str:
    """剔除 Windows / macOS / Linux 都不允许的字符，控制长度。"""
    # 替换为下划线
    cleaned = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", name).strip("._ ")
    if not cleaned:
        cleaned = "候选人"
    return cleaned[:32]


def _safe_int(v) -> Optional[int]:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _format_salary_range(min_v: Optional[int], max_v: Optional[int]) -> Optional[str]:
    """把 (min_k, max_k) 拼成 "25K-35K"。两边都为空返回 None。"""
    if min_v is None and max_v is None:
        return None
    if min_v is None:
        return f"{max_v}K"
    if max_v is None:
        return f"{min_v}K"
    return f"{min_v}K - {max_v}K"


async def _download_from_cos(cos_key: str) -> bytes:
    """从 COS 下载原文件，analyze / download_resume_analysis 路由复用。"""
    try:
        client = get_cos_client()
        response = await asyncio.to_thread(
            client.get_object,
            Bucket=bucket,
            Key=cos_key,
        )
        body_stream = response['Body']
        if hasattr(body_stream, 'get_raw_stream'):
            return body_stream.get_raw_stream().read()
        return body_stream.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"从云存储下载简历失败: {str(e)}"
        ) from e


def _make_file_response(file_bytes: bytes, safe_name: str, today: str):
    """构造带 RFC 5987 中文文件名的 DOCX 下载 Response。"""
    filename = f"面试驾到_简历_{safe_name}_{today}.docx"
    encoded_filename = quote(filename)
    content_disposition = (
        f"attachment; "
        f'filename="InterviewVAR_Resume_{today}.docx"; '  # ASCII fallback
        f"filename*=UTF-8''{encoded_filename}"
    )
    return Response(
        content=file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": content_disposition,
            "Content-Length": str(len(file_bytes)),
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
    )


def _merge_parsed_structure(analysis_result: dict, parsed_structure: dict) -> None:
    """把服务端解析出的原文结构覆盖到 LLM 输出上。

    目的：保证 PDF/页面里看到的公司名、岗位、时间、bullet 原文 = 简历原文 verbatim。
    LLM 只负责为每条 bullet 附加诊断/优化信息（optimizedText/originalTag/originalDesc/...）。

    匹配策略：
      1. 优先按 originalText 文本匹配（最稳）。
      2. 同一 work_experience 内按位置顺序兜底（防止 LLM 改写了原文导致文本不匹配）。
    未匹配上的 LLM 诊断会被丢弃（不替换原文）。
    """
    import copy

    parsed_jobs = parsed_structure.get("work_experiences") or []
    llm_jobs = analysis_result.get("work_experiences") or []
    if parsed_jobs:
        # work_experiences 整体覆盖：原文结构为准，bullet 顺序保持
        new_jobs: list[dict] = []
        for i, pj in enumerate(parsed_jobs):
            new_job = {
                "company": pj.get("company", ""),
                "role": pj.get("role", ""),
                "period": pj.get("period", ""),
                "bullets": [],
            }
            lj = llm_jobs[i] if i < len(llm_jobs) else None
            llm_bullets = (lj or {}).get("bullets") or []

            for j, pb in enumerate(pj.get("bullets") or []):
                pb_text = pb.strip()
                llm_match = None
                for lb in llm_bullets:
                    if isinstance(lb, dict) and (lb.get("originalText") or "").strip() == pb_text:
                        llm_match = lb
                        break
                if llm_match is None and j < len(llm_bullets):
                    cand = llm_bullets[j]
                    llm_match = cand if isinstance(cand, dict) else None

                if llm_match:
                    merged = copy.deepcopy(llm_match)
                    merged["originalText"] = pb_text
                    
                    orig_tag = merged.get("originalTag")
                    if orig_tag == "亮点":
                        merged["originalTagClass"] = "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20"
                    elif orig_tag == "风险":
                        merged["originalTagClass"] = "text-[#FF7A95] bg-[#FF7A95]/10 border-[#FF7A95]/20"
                    
                    if merged.get("optimizedTag") == "已优化":
                        merged["optimizedTagClass"] = "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20"

                    opt = (merged.get("optimizedText") or "").strip()
                    if opt and opt == pb_text:
                        merged.pop("optimizedText", None)
                        merged.pop("optimizedTag", None)
                        merged.pop("optimizedTagClass", None)
                    new_job["bullets"].append(merged)
                else:
                    new_job["bullets"].append({
                        "originalText": pb_text,
                        "originalTag": "亮点",
                        "originalTagClass": "text-[#5DECCB] bg-[#5DECCB]/10 border-[#5DECCB]/20",
                        "originalDesc": "",
                    })
            new_jobs.append(new_job)

        analysis_result["work_experiences"] = new_jobs

    # profile 基础字段：name/years/phone/email/gender/age/location 用解析器原文
    parser_profile = parsed_structure.get("profile") or {}
    llm_profile = analysis_result.get("profile")
    if not isinstance(llm_profile, dict):
        llm_profile = {}
        analysis_result["profile"] = llm_profile

    if parser_profile:
        pn = parser_profile.get("name")
        if pn and pn not in ("基本信息", "个人信息", "简历信息", "个人简历", "求职意向", "基本资料", "aa", "候选人"):
            llm_profile["name"] = pn
        for key in ("years", "phone", "email", "gender", "age", "location"):
            v = parser_profile.get(key)
            if v:
                llm_profile[key] = v

    # summary 补全
    parsed_sum = parsed_structure.get("summary")
    if parsed_sum:
        analysis_result["summary"] = parsed_sum

    # education / projects / skills 结构化原文补全
    parsed_edu = parsed_structure.get("education") or []
    if parsed_edu:
        analysis_result["education"] = parsed_edu

    parsed_proj = parsed_structure.get("projects") or []
    if parsed_proj:
        analysis_result["projects"] = parsed_proj
        analysis_result["personal_projects"] = parsed_proj

    parsed_skills = parsed_structure.get("skills") or []
    if parsed_skills:
        analysis_result["skills"] = parsed_skills


def _enrich_metrics(analysis_result: dict, resume_text: Optional[str] = None) -> None:
    """计算并挂载四大核心指标：word_count, risks_count, suggestions_count, match_score。

    2026-07-25+: 不再使用硬编码魔数回退。数据缺失时保持原字段为 None,
    让前端根据字段是否为 null 来决定展示"暂无"而不是伪造数字。
    """
    if not isinstance(analysis_result, dict):
        return

    # 1. 总字数
    if resume_text and resume_text.strip():
        analysis_result["word_count"] = len(resume_text.strip())
    elif "word_count" not in analysis_result or not isinstance(analysis_result["word_count"], int):
        t_len = 0
        for exp in analysis_result.get("work_experiences") or []:
            for b in exp.get("bullets") or []:
                t_len += len(b.get("originalText") or b.get("optimizedText") or "")
        for proj in analysis_result.get("projects") or []:
            for b in proj.get("bullets") or []:
                t_len += len(b.get("originalText") or b.get("optimizedText") or "")
        analysis_result["word_count"] = t_len if t_len > 0 else None

    # 2. 风险点数量
    risks = analysis_result.get("risks")
    if risks is None and isinstance(analysis_result.get("risk_analysis"), dict):
        risks = analysis_result["risk_analysis"].get("risks")
    if isinstance(risks, list):
        analysis_result["risks_count"] = len(risks)
    else:
        r_cnt = 0
        for exp in analysis_result.get("work_experiences") or []:
            for b in exp.get("bullets") or []:
                if b.get("originalTag") == "风险":
                    r_cnt += 1
        analysis_result["risks_count"] = r_cnt if r_cnt > 0 else None

    # 3. 优化建议数量
    opt_suggs = analysis_result.get("optimization_suggestions") or analysis_result.get("ai_suggestions")
    if isinstance(opt_suggs, list) and len(opt_suggs) > 0:
        analysis_result["suggestions_count"] = len(opt_suggs)
    else:
        analysis_result["suggestions_count"] = None

    # 4. 岗位匹配度
    match_score = (analysis_result.get("match_analysis") or {}).get("match_score")
    if match_score is None and isinstance(analysis_result.get("score_breakdown"), dict):
        match_score = (analysis_result["score_breakdown"].get("keyword_match") or {}).get("score")
    if match_score is None:
        match_score = analysis_result.get("score")  # 也可能是 None
    analysis_result["match_score"] = match_score


# 简历结构地图：统一 7 段 section 键名（技术岗/非技术岗分析侧重点由 LLM prompt 区分）。
# 专业能力=professional_capability（技术岗侧重技术栈，非技术岗侧重工具/方法论），
# 作品/案例=works_portfolio（技术岗侧重开源贡献，非技术岗侧重案例/演讲/专利），
# 管理/协作经验=management（社招按带人/统筹评估，应届生按团队协作/组织经历评估，不因无管理经验判「缺失」）。
_STRUCTURE_SECTION_KEYS: tuple = (
    "education",
    "work_experience",
    "projects",
    "professional_capability",
    "works_portfolio",
    "business_outcomes",
    "management",
)

_STRUCTURE_VALID_STATUS: frozenset = frozenset({"优秀", "亮点", "风险", "缺失"})


def _normalize_structure_analysis(analysis_result: dict) -> None:
    """兜底清洗 LLM 返回的 structure_analysis（双轨 schema）。

    LLM 可能漏字段 / status 拼错（如 "優异"） / score 越界 / section 缺失。
    全部归一化为前端能直接消费的结构：
      - 7 个 section 缺一不可，缺失的用占位对象填充
      - status 不在枚举内 → "优秀"
      - score 不是 0-100 整数 → clamp 到 [0, 100]
      - desc / advice / before / after 缺字段 → 空字符串 / 空数组
      - 顶层 track 缺省时按 "technical" 兜底，保证老报告按原 schema 渲染
    """
    section_keys = _STRUCTURE_SECTION_KEYS

    raw = analysis_result.get("structure_analysis")
    if not isinstance(raw, dict):
        raw = {}

    normalized: dict = {}
    for key in section_keys:
        sec = raw.get(key)
        if not isinstance(sec, dict):
            sec = {}

        status = sec.get("status")
        if not isinstance(status, str) or status.strip() not in _STRUCTURE_VALID_STATUS:
            status = "优秀"
        else:
            status = status.strip()

        score = sec.get("score")
        try:
            score_int = int(score)
        except (TypeError, ValueError):
            score_int = 80
        score_int = max(0, min(100, score_int))

        desc = sec.get("desc")
        if not isinstance(desc, str):
            desc = "暂无分析"

        advice = sec.get("advice")
        if not isinstance(advice, list):
            advice = []
        advice = [str(a) for a in advice if a is not None][:3]

        before = sec.get("before")
        if not isinstance(before, str):
            before = ""

        after = sec.get("after")
        if not isinstance(after, str):
            after = ""

        normalized[key] = {
            "status": status,
            "score": score_int,
            "desc": desc,
            "advice": advice,
            "before": before,
            "after": after,
        }

    analysis_result["structure_analysis"] = normalized


# ──────────────────────────────────────────────────────────────────
# 综合评分 5 维度真实分项计算
# 替代前端硬编码的 85/82/78/92/88 占位假数据
# 维度选择原则：跨岗位通用，不偏向技术岗
# ──────────────────────────────────────────────────────────────────

# 风险等级 → 扣分（用于"表达专业度"维度，间接反映错别字/拼写/空洞表达）
_RISK_PENALTY = {"高风险": 15, "中风险": 8, "低风险": 3}

# 5 维度权重（必须合计 1.0）
# 设计目标：跨岗位通用 —— 技术/销售/运营/产品/设计均可适用
_BREAKDOWN_WEIGHTS = {
    "keyword_match": 0.30,       # 关键词匹配度：与目标 JD 的核心词覆盖
    "experience_value": 0.30,    # 工作经历含金量：履历规模/决策力
    "quantification": 0.20,      # 成果量化程度：数字指标（QPS/GMV/转化率/留存/用户量等跨岗位通用）
    "resume_completeness": 0.10, # 简历完整度：结构完整 + ATS 可读
    "expression_quality": 0.10,  # 表达专业度：用词规范、无错别字、动作词精准
}


def _safe_get_score(d: dict, key: str = "score") -> int:
    """从 dict 安全读取指定 key 的数值（缺字段 / 类型错 / 越界 → 0）。"""
    if not isinstance(d, dict):
        return 0
    try:
        v = int(d.get(key, 0))
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, v))


def _compute_score_breakdown(analysis_result: dict) -> dict:
    """从已有 LLM 评估字段计算 5 维度真实分数 + 加权综合分。

    返回结构：
      {
        "dimensions": [
          {"key": "keyword_match", "label": "关键词匹配度", "score": 75, "weight": 0.30, "source": "match_analysis.match_score"},
          ...
        ],
        "weighted": 78,        # 加权综合分（0-100 整数），同时覆盖 analysis_result["score"]
        "formula": "Σ(维度分 × 权重)，权重 30/30/20/10/10",  # 公式描述（前端展示用）
      }
    """
    structure = analysis_result.get("structure_analysis") or {}
    risks = analysis_result.get("risks") or []
    match_analysis = analysis_result.get("match_analysis") or {}

    # 1. 关键词匹配度 ← match_analysis.match_score（LLM 给的目标岗位匹配度）
    keyword_match = _safe_get_score(match_analysis, "match_score")

    # 2. 工作经历含金量 ← avg(work_experience.score, projects.score)
    we_score = _safe_get_score(structure.get("work_experience"), "score")
    proj_score = _safe_get_score(structure.get("projects"), "score")
    experience_value = (we_score + proj_score) // 2 if (we_score + proj_score) else 0

    # 3. 成果量化程度 ← business_outcomes.score + work_experience.score 平均
    #    业务成果 section 专门统计 QPS/GMV/转化率/留存/用户量等数字指标；
    #    跨岗位通用 —— 技术岗看 QPS/性能，销售岗看 GMV/客户数，运营岗看转化率/留存。
    bo_score = _safe_get_score(structure.get("business_outcomes"), "score")
    quantification_scores = [s for s in (we_score, proj_score, bo_score) if s > 0]
    quantification = round(sum(quantification_scores) / len(quantification_scores)) if quantification_scores else 0

    # 4. 简历完整度 ← ats_pass_rate × 60% + education 完整度 × 40%
    #    2026-07-20+：取消 personal_info 之后，简历基础完整度的兜底维度切到 education 段
    #    （教育背景作为新 idx=0，是结构完整度的最低基线信号）。
    ats_raw = analysis_result.get("ats_pass_rate")
    try:
        ats_compatibility = max(0, min(100, int(ats_raw))) if ats_raw is not None else 0
    except (TypeError, ValueError):
        ats_compatibility = 0
    edu_score = _safe_get_score(structure.get("education"), "score")
    resume_completeness = round(ats_compatibility * 0.6 + edu_score * 0.4)

    # 5. 表达专业度 = 100 - sum(风险扣分)，下限 0
    #    风险点（高/中/低）通常对应错别字、拼写不规范、指标空洞、口语化表达等问题，
    #    跨岗位通用 —— 不只针对技术岗。
    risk_penalty = sum(_RISK_PENALTY.get(r.get("severity", ""), 0) for r in risks if isinstance(r, dict))
    expression_quality = max(0, 100 - risk_penalty)

    dimensions = [
        {
            "key": "keyword_match",
            "label": "关键词匹配度",
            "score": keyword_match,
            "weight": _BREAKDOWN_WEIGHTS["keyword_match"],
            "source": "match_analysis.match_score",
        },
        {
            "key": "experience_value",
            "label": "工作经历含金量",
            "score": experience_value,
            "weight": _BREAKDOWN_WEIGHTS["experience_value"],
            "source": "avg(structure_analysis.work_experience.score, projects.score)",
        },
        {
            "key": "quantification",
            "label": "成果量化程度",
            "score": quantification,
            "weight": _BREAKDOWN_WEIGHTS["quantification"],
            "source": "avg(structure_analysis.{work_experience, projects, business_outcomes}.score)",
        },
        {
            "key": "resume_completeness",
            "label": "简历完整度",
            "score": resume_completeness,
            "weight": _BREAKDOWN_WEIGHTS["resume_completeness"],
            "source": "ats_pass_rate × 60% + structure_analysis.education.score × 40%",
        },
        {
            "key": "expression_quality",
            "label": "表达专业度",
            "score": expression_quality,
            "weight": _BREAKDOWN_WEIGHTS["expression_quality"],
            "source": "100 - sum(高风险×15 + 中风险×8 + 低风险×3)",
        },
    ]

    weighted = round(sum(d["score"] * d["weight"] for d in dimensions))

    return {
        "dimensions": dimensions,
        "weighted": weighted,
        "formula": "Σ(维度分 × 权重)，权重 30% + 30% + 20% + 10% + 10%",
    }
