import asyncio
import logging
import os
import posixpath
import sys
import uvicorn
from logging.handlers import TimedRotatingFileHandler

# asyncpg 在 Windows 上需要 SelectorEventLoop
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# Docker secrets 装载器:必须放在 from app.config import settings 之前
# 服务器部署时从 /run/secrets/ 读敏感 key,本地开发 no-op
from app.utils.secrets import load_docker_secrets
load_docker_secrets()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import engine, Base
from app.routers import auth, audio, file, resume, live, counselor, feedback, guide, admin_moderation, moderation_preview

try:
    import app.routers.memory as _memory_router
    _MEMORY_LOADED = True
except Exception as _e:
    logging.error(f"[main] Failed to import memory router: {_e}")
    _MEMORY_LOADED = False
    _memory_router = None
from app.utils.cleanup import run_periodic_cleanup, run_periodic_log_cleanup, cleanup_old_logs
from app.utils.cleanup import run_periodic_pending_presign_cleanup

from fastapi import Request
import time

import sys

# 日志按天切块 + error 单独文件
# 容器内为 /app/logs（与 docker-compose 中 /data/logs:/app/logs 挂载点对齐）
log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs")
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, "backend.log")
err_file = os.path.join(log_dir, "backend-error.log")

# 自定义旋转后的文件名：backend.log.2026-07-17 → backend-2026-07-17.log
def _daily_namer(default_name):
    dir_name = posixpath.dirname(default_name)
    base = posixpath.basename(default_name)
    if ".log." in base:
        name_part, date_part = base.rsplit(".log.", 1)
        return posixpath.join(dir_name, f"{name_part}-{date_part}.log")
    return default_name

# Windows 控制台 UTF-8 编码修复（解决中文乱码）
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)

# 清理因 uvicorn 热加载 / 模块多次 import 重复添加的 TimedRotatingFileHandler，防止日志重复双打印
for h in list(root_logger.handlers):
    if isinstance(h, TimedRotatingFileHandler):
        root_logger.removeHandler(h)

# 先设置基础配置（控制台输出）
if not root_logger.handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")

# 全量日志 handler（按天切，保留 LOG_RETENTION_DAYS 天）
all_handler = TimedRotatingFileHandler(
    filename=log_file,
    when="midnight",
    interval=1,
    backupCount=settings.LOG_RETENTION_DAYS,
    encoding="utf-8",
    utc=False,  # 用本地时区（依赖容器 TZ=Asia/Shanghai）
)
all_handler.namer = _daily_namer
all_handler.setFormatter(formatter)
root_logger.addHandler(all_handler)

# 错误日志 handler（按天切，只记 ERROR 及以上）
err_handler = TimedRotatingFileHandler(
    filename=err_file,
    when="midnight",
    interval=1,
    backupCount=settings.LOG_RETENTION_DAYS,
    encoding="utf-8",
    utc=False,
)
err_handler.namer = _daily_namer
err_handler.setLevel(logging.ERROR)
err_handler.setFormatter(formatter)
root_logger.addHandler(err_handler)

# 启动时立即轮转一次：把当前 backend.log / backend-error.log 改名为带日期的文件
# 这样今天的日志会进 backend-YYYY-MM-DD.log，新文件从空开始
try:
    if os.path.exists(log_file) and os.path.getsize(log_file) > 0:
        all_handler.doRollover()
    if os.path.exists(err_file) and os.path.getsize(err_file) > 0:
        err_handler.doRollover()
except Exception as _e:
    logging.warning(f"[main] 日志启动轮转失败: {_e}")

# 抑制高频噪音 logger:watchfiles + httpx(HTTP Request 日志) + httpcore(底层)
# 这些库默认 INFO 级会把每次 embedding/MCP 调用都打一行,污染日志。
logging.getLogger("watchfiles").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

# 启动期打印当前日志目录，便于运维核对路径（容器内 /app/logs ↔ 宿主机 /data/logs）
logging.info("[main] 日志目录 = %s (Docker 部署下此目录对应宿主机 /data/logs)", log_dir)

app = FastAPI(
    title="面试驾到 - Backend Services",
    description="Backend user authentication, profiles management, LangGraph APIs, and AI Career Counselor.",
    version=settings.PROJECT_VERSION
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    """请求日志中间件。

    2026-07-30 改:前端轮询拉得很勤,INFO 风暴真的没用,改成
      - 任何 4xx/5xx 都打(便于排查报错)
      - 慢请求(>= 1s)打,标 slow
      - 其余 200/OK 直接 pass,不打
    高频心跳/探活路径永远是 200 也不打。

    2026-08-02 改:已知外部探测 / AI 面试辅助浏览器扩展盲打的路径,
    当 Authorization 头为空(Auth: None)时静默不打 ERR 日志;
    合法请求只要带了 token 仍正常记录,不被误伤。
    """
    start_time = time.time()
    response = await call_next(request)
    duration = time.time() - start_time

    path = request.url.path
    quiet_paths = {"/api/auth/me", "/health", "/api/live/quota"}
    if path in quiet_paths and response.status_code < 400:
        return response

    is_error = response.status_code >= 400
    is_slow = duration >= 1.0
    if not is_error and not is_slow:
        return response

    auth_header = request.headers.get("Authorization", "None")
    auth_prefix = auth_header[:15] if auth_header != "None" else "None"

    # 已知外部探测 / AI 面试辅助扩展盲打路径(Authorization 头为空时静默)
    # 前缀:/api/v1/* —— 项目本身无任何 v1 路由,所有 v1 命中都是外部探测
    # 精确:与同类 SaaS(Cluely/FinalRoundAI/InterviewCoder)标配路径重名的项目路由
    _PROBE_PREFIXES = ("/api/v1/",)
    _PROBE_EXACT = frozenset({
        "/api/generate",
        "/api/counselor/advisor-insights",
        "/api/memory/knowledge/abilities",
        "/api/counselor/sessions",
        "/api/memory/projects",
        "/api/memory/knowledge/questions",
    })
    if auth_prefix == "None" and (
        path in _PROBE_EXACT
        or any(path.startswith(p) for p in _PROBE_PREFIXES)
    ):
        return response

    tag = "ERR" if is_error else "SLOW"
    logging.info(
        f"Request[{tag}]: {request.method} {path} | "
        f"Auth: {auth_prefix}... | "
        f"Status: {response.status_code} | "
        f"Duration: {duration:.3f}s"
    )
    return response

# CORS configurations - Allow local frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://124.223.185.108",
        # 生产域名（http 用于备案期 ip 直连测试，https 用于域名访问）
        "http://interviewvar.com",
        "https://interviewvar.com",
        "http://www.interviewvar.com",
        "https://www.interviewvar.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Auth Router
app.include_router(auth.router)
app.include_router(audio.router)
app.include_router(file.router)
app.include_router(resume.router)
app.include_router(live.router)
app.include_router(counselor.router)
app.include_router(feedback.router)
app.include_router(guide.router)
app.include_router(admin_moderation.router)
app.include_router(moderation_preview.router)
if _MEMORY_LOADED and _memory_router is not None:
    app.include_router(_memory_router.router)
    logging.info("[main] Memory router registered successfully")
else:
    logging.warning("[main] Memory router NOT registered (import failed)")

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    translated_msgs = []
    for err in errors:
        msg = str(err.get("msg", ""))
        loc = err.get("loc", [])
        field_name = loc[-1] if loc else "字段"
        
        if "value is not a valid email address" in msg or "not within a valid top-level domain" in msg:
            translated_msgs.append("邮箱地址格式无效，请检查后缀域名（如 .com, .cn）")
        elif "field required" in msg.lower() or "missing" in msg.lower():
            translated_msgs.append(f"缺少必填字段: {field_name}")
        elif "value is not a valid phone" in msg:
            translated_msgs.append("手机号码格式无效")
        elif "value is not a valid integer" in msg:
            translated_msgs.append(f"{field_name} 格式错误，请输入有效数字")
        else:
            translated_msgs.append(msg)

    friendly_detail = "；".join(translated_msgs) if translated_msgs else "输入数据格式有误，请检查后重试"
    return JSONResponse(status_code=422, content={"detail": friendly_detail})


@app.on_event("startup")
async def startup_event():
    # 1. 确保 pgvector 扩展已启用（AI 职业顾问向量库依赖）
    try:
        async with engine.begin() as conn:
            from sqlalchemy import text as _text
            await conn.execute(_text("CREATE EXTENSION IF NOT EXISTS vector"))
        logging.info("[startup] pgvector extension verified")
    except Exception as _e:
        logging.error(f"[startup] Failed to ensure pgvector extension: {_e}")
        # 不抛出——其他功能可用，仅 counselor 向量检索不可用

    # 2. 自动建表（仅建缺失的表；不 ALTER 已存在的列）
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 启动后台定期清理任务
    asyncio.create_task(run_periodic_cleanup())
    # 2026-08 引入：pending presign 清理(每 6h 跑一次,见 cleanup.py)
    asyncio.create_task(run_periodic_pending_presign_cleanup())
    # 启动后台定期日志清理任务（LOG_RETENTION_DAYS 之外的旧日志自动清理）
    asyncio.create_task(run_periodic_log_cleanup())
    # 启动时立即异步清理一次历史孤立日志（把 backupCount 调小后目录里残留的旧文件清掉）
    asyncio.create_task(_startup_log_cleanup())
    # 启动标签字典种子数据初始化
    asyncio.create_task(_seed_project_tags())
    # 启动管理员账号初始化
    asyncio.create_task(_seed_admin_account())
    # 启动精选推荐数据种子（面试指南页固定预置数据，幂等）
    asyncio.create_task(_seed_featured_guides())
    # 启动内容审核后台巡检
    from app.utils.content_moderation import run_periodic_rescan
    asyncio.create_task(run_periodic_rescan())
    logging.info("[main] 内容审核后台巡检已启用 (周期=%sh)",
                 settings.CONTENT_MODERATION_RESCAN_HOURS)


async def _startup_log_cleanup():
    """启动期立即跑一次旧日志清理，避免历史残留撑爆磁盘。"""
    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, cleanup_old_logs)
    except Exception as _e:
        logging.warning(f"[main] 启动期日志清理失败: {_e}")


@app.on_event("shutdown")
async def shutdown_event():
    pass


@app.get("/")
def read_root():
    return {"message": "面试驾到 Backend Services are running."}


async def _seed_project_tags():
    """确保 project_tags 字典表已填充。

    检查表是否为空 → 批量插入 8 个主分类标签 + 10 个辅助标签。
    幂等：已有数据时跳过（不重复插入）。
    """
    from app.database import async_session
    from app.models import ProjectTag
    from sqlalchemy import select as sa_select

    category_tags = [
        ("AI工程",     "ai_engineering",   "text-primary bg-primary/10 border-primary/20",           1),
        ("数据工程",   "data_engineering",  "text-tertiary bg-tertiary/10 border-tertiary/20",        2),
        ("交易骨干",   "trading_backbone",  "text-secondary bg-secondary/10 border-secondary/20",     3),
        ("基础平台",   "infra_platform",    "text-amber-500 bg-amber-500/10 border-amber-500/20",    4),
        ("增长工程",   "growth_eng",        "text-sky-500 bg-sky-500/10 border-sky-500/20",          5),
        ("安全合规",   "safety_gov",        "text-red-500 bg-red-500/10 border-red-500/20",          6),
        ("公共组件",   "common_components", "text-slate-500 bg-slate-500/10 border-slate-500/20",    7),
        ("运维效能",   "devops_sre",        "text-green-500 bg-green-500/10 border-green-500/20",    8),
    ]
    sub_tags = [
        ("核心项目", "core",         1),
        ("高频提问", "frequent",     2),
        ("大流量",   "high_traffic", 3),
        ("从0到1",   "from_scratch", 4),
        ("开源",     "opensource",   5),
        ("获奖",     "awarded",      6),
        ("跨团队",   "cross_team",   7),
        ("业务增长", "growth",       8),
        ("成本优化", "cost_opt",     9),
        ("技术重构", "refactor",     10),
    ]

    async with async_session() as db:
        # 幂等检查
        result = await db.execute(sa_select(ProjectTag).limit(1))
        if result.scalars().first() is not None:
            return  # 已有数据，跳过

        for tag_name, tag_key, color_class, sort_order in category_tags:
            db.add(ProjectTag(
                tag_name=tag_name, tag_key=tag_key, tag_type="category",
                color_class=color_class, sort_order=sort_order,
            ))
        for tag_name, tag_key, sort_order in sub_tags:
            db.add(ProjectTag(
                tag_name=tag_name, tag_key=tag_key, tag_type="sub",
                sort_order=sort_order,
            ))
        await db.commit()
    logging.info("[seed] 项目标签字典初始化完成: 8 categories + 10 sub-tags")


async def _seed_admin_account():
    """初始化预置管理员账号 (admin / offerPilot@2026)"""
    from app.database import async_session
    from app import models
    from app.utils.security import get_password_hash
    from sqlalchemy import select as sa_select
    from sqlalchemy.orm import selectinload

    async with async_session() as db:
        try:
            hashed_pwd = get_password_hash("offerPilot@2026")
            result = await db.execute(
                sa_select(models.User)
                .options(selectinload(models.User.profile))
                .where(models.User.username == "admin")
            )
            admin = result.scalars().first()
            # 记录是否需要创建默认档案：新账号必然缺档案；
            # 已存在账号通过 selectinload 预加载的 profile 判断，避免异步懒加载触发 greenlet 错误。
            need_profile = False
            if not admin:
                admin = models.User(
                    username="admin",
                    password_hash=hashed_pwd,
                    membership="test",
                    is_online=False
                )
                db.add(admin)
                await db.flush()
                need_profile = True
                logging.info("[seed] 预置管理员账号初始化成功: admin / offerPilot@2026")
            else:
                # 幂等重置预置密码，保证 admin 始终为 offerPilot@2026
                admin.password_hash = hashed_pwd
                need_profile = admin.profile is None

            # 为 admin 补齐默认档案（全部默认值，头像使用 /register.jpg）
            if need_profile:
                db.add(models.UserProfile(
                    user_id=admin.id,
                    gender="male",
                    age=0,
                    job_status="active",
                    avatar_url="/register.jpg",
                    experience_years="应届",
                    experience_months="0个月",
                    company_name="暂无公司",
                    role_name="后端开发工程师",
                    salary_min=0,
                    salary_max=0,
                    school="暂无学校",
                    degree="本科",
                    has_experience=False,
                    target_cities=[],
                    target_company="大厂公司 (目标)",
                    target_role="高级工程师",
                    target_grade="高级",
                    target_salary_min=0,
                    target_salary_max=0,
                ))

            await db.commit()
        except Exception as e:
            logging.error(f"[seed] 预置管理员账号初始化失败: {e}")


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8001,
        reload=True,
        reload_includes=["*.env", "*.py"],  # 监听 .env 等非 Python 文件的变更
        # 关掉 uvicorn 自带的 access log —— 否则每条 200 还是会打
        # 自己加的 log_requests 中间件已覆盖: 4xx/5xx 必打, ≥1s 慢请求必打
        access_log=False,
    )


# ============================================================================
# 精选推荐种子数据 (幂等：使用 ON CONFLICT (id) DO UPDATE 多次启动不会重复插入)
# ============================================================================
# 用法：要新增/修改预置数据，直接在 PRESET_FEATURED_GUIDES 列表中追加/编辑条目即可。
# id 唯一键；多次启动执行同一 SQL 不会报错也不会产生重复行。
PRESET_FEATURED_GUIDES_SQL: list[str] = [
    # id=1: 面试驾到官方账号首推
    """
    INSERT INTO featured_guides (
        id, title, cover_img, platform, platform_badge_bg,
        duration, url, author, author_avatar, author_verified,
        fans_count, category, reads, likes, favorites, created_at
    ) VALUES (
        1,
        '我们想打造一个陪你成长的 AI 职业伙伴🚀',
        '/guide/context/1.jpg',
        '小红书',
        'bg-[#FF2442]/20 text-[#FF2442] border-[#FF2442]/30',
        '图文笔记',
        'https://www.xiaohongshu.com/explore/6a67251d000000001d02342c?xsec_token=ABjNQQTIIKOpQ3qBhwjet_W0eG_ItjLbApVi6GHprq5Xs=&xsec_source=pc_user',
        '面试驾到',
        '',
        TRUE,
        '0',
        '推荐',
        0, 0, 0,
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        title            = EXCLUDED.title,
        cover_img        = EXCLUDED.cover_img,
        platform         = EXCLUDED.platform,
        platform_badge_bg= EXCLUDED.platform_badge_bg,
        duration         = EXCLUDED.duration,
        url              = EXCLUDED.url,
        author           = EXCLUDED.author,
        author_avatar    = EXCLUDED.author_avatar,
        author_verified  = EXCLUDED.author_verified,
        fans_count       = EXCLUDED.fans_count,
        category         = EXCLUDED.category
    -- reads/likes/favorites 保留数据库里用户行为产生的真实计数，不被种子覆盖
    """,
    # ─────────────────────────────────────────────────────────
    # 2026-08-01 追加：来自 Obsidian 笔记 saas/ai面试教练/功能/精选内容.md
    # 平台色：小红书 #FF2442（橙红）｜ 抖音 #FE2C55（粉红）
    # ─────────────────────────────────────────────────────────
    # id=2: 艾绒职场实现教练 · 面试缺点回答
    """
    INSERT INTO featured_guides (
        id, title, cover_img, platform, platform_badge_bg,
        duration, url, author, author_avatar, author_verified,
        fans_count, category, reads, likes, favorites, created_at
    ) VALUES (
        2,
        '猎头教你：面试被问缺点怎么说❓',
        '/guide/context/2.jpg',
        '小红书',
        'bg-[#FF2442]/20 text-[#FF2442] border-[#FF2442]/30',
        '2:07',
        'https://www.xiaohongshu.com/explore/6a61e59e0000000011019ef8?xsec_token=ABGT5QOrwpfEaqZbx3AulZoN3j-MWOwUE-dnWBt4gIzpc=&xsec_source=pc_search',
        '艾绒职场实现教练',
        '',
        TRUE,
        '0',
        '推荐',
        0, 0, 0,
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        title            = EXCLUDED.title,
        cover_img        = EXCLUDED.cover_img,
        platform         = EXCLUDED.platform,
        platform_badge_bg= EXCLUDED.platform_badge_bg,
        duration         = EXCLUDED.duration,
        url              = EXCLUDED.url,
        author           = EXCLUDED.author,
        author_avatar    = EXCLUDED.author_avatar,
        author_verified  = EXCLUDED.author_verified,
        fans_count       = EXCLUDED.fans_count,
        category         = EXCLUDED.category
    -- reads/likes/favorites 保留数据库里用户行为产生的真实计数，不被种子覆盖
    """,
    # id=3: 艾绒职场实现教练 · 面试薪资
    """
    INSERT INTO featured_guides (
        id, title, cover_img, platform, platform_badge_bg,
        duration, url, author, author_avatar, author_verified,
        fans_count, category, reads, likes, favorites, created_at
    ) VALUES (
        3,
        '为什么HR不愿意告诉你面试岗位的薪资❓',
        '/guide/context/3.jpg',
        '小红书',
        'bg-[#FF2442]/20 text-[#FF2442] border-[#FF2442]/30',
        '2:54',
        'https://www.xiaohongshu.com/explore/6a43b6a8000000000f0065f3?xsec_token=AB0Nn5upg-Wm-1VbmZ0i_AQUBDEDRB8MUaQPc8BNnoeDI=&xsec_source=pc_search',
        '艾绒职场实现教练',
        '',
        TRUE,
        '0',
        '推荐',
        0, 0, 0,
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        title            = EXCLUDED.title,
        cover_img        = EXCLUDED.cover_img,
        platform         = EXCLUDED.platform,
        platform_badge_bg= EXCLUDED.platform_badge_bg,
        duration         = EXCLUDED.duration,
        url              = EXCLUDED.url,
        author           = EXCLUDED.author,
        author_avatar    = EXCLUDED.author_avatar,
        author_verified  = EXCLUDED.author_verified,
        fans_count       = EXCLUDED.fans_count,
        category         = EXCLUDED.category
    -- reads/likes/favorites 保留数据库里用户行为产生的真实计数，不被种子覆盖
    """,
    # id=4: 艾绒职场实现教练 · offer 退路
    """
    INSERT INTO featured_guides (
        id, title, cover_img, platform, platform_badge_bg,
        duration, url, author, author_avatar, author_verified,
        fans_count, category, reads, likes, favorites, created_at
    ) VALUES (
        4,
        '收到offer后，一定要给自己留退路',
        '/guide/context/4.jpg',
        '小红书',
        'bg-[#FF2442]/20 text-[#FF2442] border-[#FF2442]/30',
        '2:24',
        'https://www.xiaohongshu.com/explore/6a48d0a6000000000f01d7a2?xsec_token=ABUIyBoIV_fbgVnwMbWFPDk1k_WgNvSvNpiAkCSDvcwaA=&xsec_source=pc_search',
        '艾绒职场实现教练',
        '',
        TRUE,
        '0',
        '推荐',
        0, 0, 0,
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        title            = EXCLUDED.title,
        cover_img        = EXCLUDED.cover_img,
        platform         = EXCLUDED.platform,
        platform_badge_bg= EXCLUDED.platform_badge_bg,
        duration         = EXCLUDED.duration,
        url              = EXCLUDED.url,
        author           = EXCLUDED.author,
        author_avatar    = EXCLUDED.author_avatar,
        author_verified  = EXCLUDED.author_verified,
        fans_count       = EXCLUDED.fans_count,
        category         = EXCLUDED.category
    -- reads/likes/favorites 保留数据库里用户行为产生的真实计数，不被种子覆盖
    """,
    # id=5: 面试驾到 · 秋招情报站 Vol.1
    """
    INSERT INTO featured_guides (
        id, title, cover_img, platform, platform_badge_bg,
        duration, url, author, author_avatar, author_verified,
        fans_count, category, reads, likes, favorites, created_at
    ) VALUES (
        5,
        '🚨面试驾到·秋招情报站 Vol.1',
        '/guide/context/5.jpg',
        '小红书',
        'bg-[#FF2442]/20 text-[#FF2442] border-[#FF2442]/30',
        '图文笔记',
        'https://www.xiaohongshu.com/explore/6a69bd0e000000000c0153d4?xsec_token=ABQLqP1kWTDCv8PZDNV_BhNygtLrcQ5d7M4Fz6NR5FsR4=&xsec_source=pc_user',
        '面试驾到',
        '',
        TRUE,
        '0',
        '推荐',
        0, 0, 0,
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        title            = EXCLUDED.title,
        cover_img        = EXCLUDED.cover_img,
        platform         = EXCLUDED.platform,
        platform_badge_bg= EXCLUDED.platform_badge_bg,
        duration         = EXCLUDED.duration,
        url              = EXCLUDED.url,
        author           = EXCLUDED.author,
        author_avatar    = EXCLUDED.author_avatar,
        author_verified  = EXCLUDED.author_verified,
        fans_count       = EXCLUDED.fans_count,
        category         = EXCLUDED.category
    -- reads/likes/favorites 保留数据库里用户行为产生的真实计数，不被种子覆盖
    """,
    # id=6: 面试驾到 · 提前批
    """
    INSERT INTO featured_guides (
        id, title, cover_img, platform, platform_badge_bg,
        duration, url, author, author_avatar, author_verified,
        fans_count, category, reads, likes, favorites, created_at
    ) VALUES (
        6,
        '现在立刻马上！放下你手里的行测题！提前批看',
        '/guide/context/6.jpg',
        '小红书',
        'bg-[#FF2442]/20 text-[#FF2442] border-[#FF2442]/30',
        '图文笔记',
        'https://www.xiaohongshu.com/explore/6a6d69d70000000005020694?xsec_token=ABN2yZVKDlcOI6M6ZlG3BwdsFiXI4aB1KKNwW9d7cy1UQ=&xsec_source=pc_user',
        '面试驾到',
        '',
        TRUE,
        '0',
        '推荐',
        0, 0, 0,
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        title            = EXCLUDED.title,
        cover_img        = EXCLUDED.cover_img,
        platform         = EXCLUDED.platform,
        platform_badge_bg= EXCLUDED.platform_badge_bg,
        duration         = EXCLUDED.duration,
        url              = EXCLUDED.url,
        author           = EXCLUDED.author,
        author_avatar    = EXCLUDED.author_avatar,
        author_verified  = EXCLUDED.author_verified,
        fans_count       = EXCLUDED.fans_count,
        category         = EXCLUDED.category
    -- reads/likes/favorites 保留数据库里用户行为产生的真实计数，不被种子覆盖
    """,
    # 2026-08-01 临时下架：若不游视频（id=7、8）已删除种子；DB 里现存数据需手动 DELETE FROM featured_guides WHERE id IN (7,8);
    # 后续追加：复制上面模板改 id=N, title, url, cover_img 即可
]


async def _seed_featured_guides():
    """启动期通过原生 SQL 幂等写入精选推荐预置数据。

    使用 INSERT ... ON CONFLICT (id) DO UPDATE：
      - 首次启动：插入新行；
      - 再次启动：若 id 已存在则按 EXCLUDED 内容刷新（除 reads/likes/favorites 外），
        即使重复执行也不会报错或产生重复行。
    """
    try:
        from sqlalchemy import text as _text
        async with engine.begin() as conn:
            for sql in PRESET_FEATURED_GUIDES_SQL:
                await conn.execute(_text(sql))
        logging.info("[seed] 精选推荐预置数据已写入 (共 %d 条)", len(PRESET_FEATURED_GUIDES_SQL))
    except Exception as _e:
        logging.error("[seed] 精选推荐预置数据写入失败: %s", _e)
