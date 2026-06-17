import asyncio
import logging
import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.routers import auth, audio, file, resume
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
    description="Backend user authentication, profiles management, and LangGraph APIs.",
    version="1.0.0"
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
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Auth Router
app.include_router(auth.router)
app.include_router(audio.router)
app.include_router(file.router)
app.include_router(resume.router)


@app.on_event("startup")
async def startup_event():
    # Automatically create tables in local PostgreSQL on startup (development convenience)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
    # 启动后台定期清理任务
    asyncio.create_task(run_periodic_cleanup())


@app.on_event("shutdown")
async def shutdown_event():
    pass


@app.get("/")
def read_root():
    return {"message": "面试VAR Backend Services are running."}

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8001,
        reload=True,
        reload_includes=["*.env", "*.py"],  # 监听 .env 等非 Python 文件的变更
    )
