from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_VERSION: str = "V0.0.0"
    DATABASE_URL: str = "postgresql+asyncpg://offerpilot:offerPilot%402026@localhost:5432/offerpilot"
    REDIS_URL: str = "redis://:offerPilot%402026@localhost:6379/0"
    
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
    
    # 文本生成 LLM：DeepSeek（OpenAI-compatible）
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    # 主模型（reasoning，用于深度诊断/创作）
    DEEPSEEK_MODEL: str = "deepseek-v4-flash"
    # 快速模型（chat，用于结构化抽取/分类/分段）
    # P0 优化 O2：把结构化抽取类任务从 reasoning 切到 chat，预计提速 3-5x
    DEEPSEEK_MODEL_FAST: str = "deepseek-chat"

    # MiniMax Embedding API（AI 职业顾问用）
    # 注意：与 chat 端点域名不同——embedding 用 api.minimax.chat
    # 与文本生成 LLM 是两条独立链路：embo-01 仍走 MiniMax，文本生成走 deepseek。
    MINIMAX_API_KEY: str = ""
    MINIMAX_GROUP_ID: str = "2041338752588062737"
    MINIMAX_EMBEDDING_URL: str = "https://api.minimax.chat/v1/embeddings"
    EMBEDDING_MODEL: str = "embo-01"
    EMBEDDING_DIM: int = 1536
    EMBEDDING_BATCH_SIZE: int = 32
    EMBEDDING_TIMEOUT_S: float = 30.0
    EMBEDDING_QPS: int = 20

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

    # Volcano Engine Doubao 流式短语音识别（WSS，实时上屏候选人文字）
    # 浏览器 mic PCM（24kHz → 在 bridge 里降采样到 16kHz）同步喂这个连接，
    # 拿到 partial/final 文本后 broadcast 为 live.transcript(role=candidate)
    # 文档：https://www.volcengine.com/docs/6561/1594356
    #   endpoint:        wss://openspeech.bytedance.com/api/v3/sauc/bigmodel
    #   resource_id:      volc.seedasr.sauc.duration / volc.bigasr.sauc.duration
    #                     (按控制台开通的模型+计费方式决定：模型1.0/2.0 × 小时版/并发版)
    VOLC_STREAMING_ASR_WSS_URL: str = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"
    VOLC_STREAMING_ASR_RESOURCE_ID: str = "volc.bigasr.sauc.duration"

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

    # ── 分析功能配额（30 天滚动窗口内最大次数） ─────────────────────
    # 修复"用户删除历史记录 → 又可免费使用"的 bug：
    #   旧实现用 SELECT COUNT(*) FROM interview_sessions WHERE user_id=? 判断，
    #   用户删除记录后即可绕过。新实现每次发起分析写一条 UserQuotaUsage，
    #   30 天窗口按 used_at 过滤；删除业务记录不会影响配额计数。
    # feature 字符串与 UserQuotaUsage.feature 字段对齐：
    #   "audio"   —— 面试录音分析（上传 wav/mp3 后 LLM 分析）
    #   "record"  —— 面试记录分析（粘贴文本或重跑已有 session）
    #   "resume"  —— 简历分析
    QUOTA_WINDOW_DAYS: int = 30
    QUOTA_FREE: dict = {"audio": 1, "record": 1, "resume": 1}
    QUOTA_PRO:  dict = {"audio": 10, "record": 10, "resume": 10}
    QUOTA_MAX:  dict = {"audio": 30, "record": 30, "resume": 30}

    # Aliyun Bailian DASHSCOPE_API_KEY
    DASHSCOPE_API_KEY: str = ""
    
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
