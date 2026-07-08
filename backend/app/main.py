import asyncio
import logging
import os
import sys
import uvicorn

# asyncpg 在 Windows 上需要 SelectorEventLoop
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.routers import auth, audio, file, resume, live, counselor

try:
    import app.routers.memory as _memory_router
    _MEMORY_LOADED = True
except Exception as _e:
    logging.error(f"[main] Failed to import memory router: {_e}")
    _MEMORY_LOADED = False
    _memory_router = None
from app.utils.cleanup import run_periodic_cleanup

from fastapi import Request
import time

import sys

# 日志同时输出到控制台和文件
log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs")
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, "backend.log")

# Windows 控制台 UTF-8 编码修复（解决中文乱码）
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# 先设置基础配置（控制台输出）
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# 再添加文件 handler（避免被 uvicorn 覆盖）
file_handler = logging.FileHandler(log_file, encoding="utf-8")
file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
logging.getLogger().addHandler(file_handler)

# 抑制 watchfiles 的 verbose 日志
logging.getLogger("watchfiles").setLevel(logging.WARNING)

app = FastAPI(
    title="面试VAR - Backend Services",
    description="Backend user authentication, profiles management, LangGraph APIs, and AI Career Counselor.",
    version="1.1.0"
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    auth_header = request.headers.get("Authorization", "None")
    auth_prefix = auth_header[:15] if auth_header != "None" else "None"
    
    start_time = time.time()
    response = await call_next(request)
    duration = time.time() - start_time
    
    logging.info(
        f"Request: {request.method} {request.url.path} | "
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
if _MEMORY_LOADED and _memory_router is not None:
    app.include_router(_memory_router.router)
    logging.info("[main] Memory router registered successfully")
else:
    logging.warning("[main] Memory router NOT registered (import failed)")


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

    # 2. Automatically create tables in local PostgreSQL on startup (development convenience)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 启动后台定期清理任务
    asyncio.create_task(run_periodic_cleanup())
    # 启动标签字典种子数据初始化
    asyncio.create_task(_seed_project_tags())


@app.on_event("shutdown")
async def shutdown_event():
    pass


@app.get("/")
def read_root():
    return {"message": "面试VAR Backend Services are running."}


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


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8001,
        reload=True,
        reload_includes=["*.env", "*.py"],  # 监听 .env 等非 Python 文件的变更
    )
