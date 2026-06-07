import asyncio
import logging
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.routers import auth, audio, file
from app.utils.cleanup import run_periodic_cleanup

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

app = FastAPI(
    title="OfferPilot AI Coach - Backend Services",
    description="Backend user authentication, profiles management, and LangGraph APIs.",
    version="1.0.0"
)

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


@app.on_event("startup")
async def startup_event():
    # Automatically create tables in local PostgreSQL on startup (development convenience)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Ensure the is_online column exists for existing tables
        from sqlalchemy import text
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT FALSE;"))
        # 会员等级字段：NULL=免费, "pro", "max"。控制文件保留时长。
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS membership VARCHAR(20) DEFAULT NULL;"))

    # 启动后台定期清理任务
    asyncio.create_task(run_periodic_cleanup())


@app.on_event("shutdown")
async def shutdown_event():
    pass


@app.get("/")
def read_root():
    return {"message": "OfferPilot Backend Services are running."}

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
