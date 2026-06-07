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

    # Alibaba DashScope — used for ASR (Paraformer-v2)
    # The key from the Aliyun Bailian WebSearch MCP config: sk-7eb9032977794d2694d46116fb8db4a4
    DASHSCOPE_API_KEY: str = "sk-7eb9032977794d2694d46116fb8db4a4"

    # Volcano Engine (ByteDance Doubao) ASR
    VOLC_ASR_API_KEY: str = "91b64a7e-bd24-41ba-95e7-b1dbca5cb6b3"
    VOLC_ASR_RESOURCE_ID: str = "volc.seedasr.auc"

    # 文件保留策略（按会员等级），单位：天。免费用户与未登录访客共用免费档。
    FILE_RETENTION_DAYS_FREE: int = 7
    FILE_RETENTION_DAYS_PRO: int = 30
    FILE_RETENTION_DAYS_MAX: int = 120
    # 过期文件清理任务运行周期，单位：小时
    FILE_CLEANUP_INTERVAL_HOURS: int = 24
    
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
