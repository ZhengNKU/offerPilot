from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/offerpilot"
    REDIS_URL: str = "redis://localhost:6379/0"
    
    JWT_SECRET: str = "super-secret-key-change-me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    
    TENCENT_SECRET_ID: str = ""
    TENCENT_SECRET_KEY: str = ""
    TENCENT_SMS_APP_ID: str = ""
    TENCENT_SMS_SIGN_NAME: str = ""
    TENCENT_SMS_TEMPLATE_ID: str = ""
    
    # SMTP Email configuration
    SMTP_HOST: str = ""
    SMTP_PORT: int = 465
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_SENDER: str = ""
    SMTP_USE_SSL: bool = True
    
    MINIMAX_API_KEY: str = "sk-cp-MWMKKxL_Pw6DnMDlTOsoH-r0CuKRlIjej1HllThrp0W5ibWrTW9-7c4AZR3OjV0fQDckONY9mtTgYxLARigGIKatRyJXStX1aeLadgwlirjSp2PREMklY_g"
    MINIMAX_BASE_URL: str = "https://api.minimaxi.com/v1"

    # Volcano Engine (ByteDance Doubao) ASR
    VOLC_ASR_API_KEY: str = "91b64a7e-bd24-41ba-95e7-b1dbca5cb6b3"
    VOLC_ASR_RESOURCE_ID: str = "volc.seedasr.auc"

    # Volcano Engine Doubao Realtime (实时语音大模型，HTTP/WS 快捷 API 接入)
    # 申请地址：https://www.volcengine.com/product/voice-realtime
    # 仅在后端使用，禁止下发到浏览器
    # 鉴权头（5 件套，来自官方 Python SDK config.py）：
    #   X-Api-App-ID:     <用户 App ID>            ← 来自 .env
    #   X-Api-Access-Key: <用户 Access Key>        ← 来自 .env
    #   X-Api-App-Key:     PlgvMymc7f3tQnJ6         ← 官方固定常量
    #   X-Api-Resource-Id: volc.speech.dialog       ← 官方固定
    #   X-Api-Connect-Id: <UUID 每次连接随机>      ← bridge 内自动生成
    VOLC_REALTIME_APP_ID: str = ""            # → X-Api-App-ID
    VOLC_REALTIME_API_KEY: str = ""           # → X-Api-Access-Key
    VOLC_REALTIME_APP_KEY: str = "PlgvMymc7f3tQnJ6"  # 火山官方固定常量，禁止修改
    VOLC_REALTIME_RESOURCE_ID: str = "volc.speech.dialog"  # 官方固定
    VOLC_REALTIME_WSS_URL: str = "wss://openspeech.bytedance.com/api/v3/realtime/dialogue"

    # 实时面试限制
    LIVE_MAX_DURATION_MIN: int = 30
    LIVE_HEARTBEAT_INTERVAL_S: int = 15
    LIVE_WS_TOKEN_EXPIRE_MIN: int = 60

    # 文件保留策略（按会员等级），单位：天。免费用户与未登录访客共用免费档。
    FILE_RETENTION_DAYS_FREE: int = 7
    FILE_RETENTION_DAYS_PRO: int = 30
    FILE_RETENTION_DAYS_MAX: int = 120
    # 过期文件清理任务运行周期，单位：小时
    FILE_CLEANUP_INTERVAL_HOURS: int = 24
    
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
