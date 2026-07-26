from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import model_validator

class Settings(BaseSettings):
    PROJECT_VERSION: str = "V0.0.0"
    DATABASE_URL: str = "postgresql+asyncpg://offerpilot:offerPilot%402026@postgres:5432/offerpilot"
    REDIS_URL: str = "redis://:offerPilot%402026@redis:6379/0"
    
    JWT_SECRET: str = "super-secret-key-change-me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    # 运行环境：production / development。从 .env 读取，默认 development。
    # 影响：孤儿 COS 扫描只在 production 执行，防止本地和线上共用桶时误删。
    ENVIRONMENT: str = "development"

    # ── 对外可访问的 base URL ──
    PUBLIC_BASE_URL: str = ""
    
    TENCENT_SECRET_ID: str = ""
    TENCENT_SECRET_KEY: str = ""
    TENCENT_SMS_APP_ID: str = ""
    TENCENT_SMS_SIGN_NAME: str = ""
    TENCENT_SMS_TEMPLATE_ID: str = ""
    
    # Tencent Cloud SES（邮件推送）configuration
    # 复用上方已有的 TENCENT_SECRET_ID / TENCENT_SECRET_KEY
    # SES 控制台：https://console.cloud.tencent.com/ses
    TENCENT_SES_REGION: str = "ap-guangzhou"    # SES API 地域，如 ap-guangzhou / ap-hongkong / ap-singapore
    TENCENT_SES_FROM_EMAIL: str = ""            # 已验证的发件地址，例如 noreply@interviewvar.com
    TENCENT_SES_FROM_NAME: str = "面试驾到"       # 收件方看到的发件人显示名
    TENCENT_SES_REPLY_TO: str = ""              # 可选：回信地址
    TENCENT_SES_TEMPLATE_ID: int = 0            # SES 控制台创建的模板 ID（数字），普通账户仅支持模板发送

    # ── 内容审核（腾讯云 TMS 文本 + IMS 图片）─────────────────
    # 复用上方 TENCENT_SECRET_ID / TENCENT_SECRET_KEY，无需新增秘钥。
    # 控制台：
    #   TMS：https://console.cloud.tencent.com/cms/clouds/manage
    #   IMS：https://console.cloud.tencent.com/ims/manage
    # BizType 留空 = 使用默认通用策略；运营在控制台配置自定义策略后填入 BizType 字符串。
    TENCENT_TMS_BIZ_TYPE: str = ""              # 文本策略编号；空=默认通用策略
    TMS_REGION: str = "ap-guangzhou"            # TMS 地域
    TENCENT_IMS_BIZ_TYPE: str = ""              # 图片策略编号；空=默认
    IMS_REGION: str = "ap-guangzhou"            # IMS 地域
    # 失败策略：秘钥缺失时自动 fail-open（dev 模式），秘钥配齐后由本开关控制
    # False = fail-closed（TMS 故障时 503 拦截）；True = fail-open（仅灰度期建议）
    # 默认开启兜底,避免 IMS/TMS 偶发超时阻塞用户上传;后台
    # 巡检任务 (run_periodic_rescan, 默认每 6h) 会兜底复查。
    CONTENT_MODERATION_FAIL_OPEN: bool = True
    # TMS / IMS 调用超时（asyncio.wait_for 包裹），防 SDK hang
    # 同时覆盖文本 (TMS) 与图片 (IMS) 两种调用。IMS 走 ≤5MB base64 跨地域，
    # 生产环境从 4.0s 提到 8.0s 以兼容 ap-guangzhou 跨区冷连接。
    TMS_TIMEOUT_S: float = 8.0
    # 单次 web_search 联网检索硬超时（asyncio.wait_for 包裹）。
    # tool 调用降级到本地纯 LLM 后会立即结束工具循环，不再多跑 iter 浪费时间。
    # 腾讯云 MCP 正常返回约需 1.5~4s，阈值需留足余量（原 4.0 卡在返回耗时上，导致大面积超时降级）。
    WEB_SEARCH_TIMEOUT_S: float = 12.0
    # 腾讯云 WebSearch MCP 服务端点
    TENCENT_MCP_SEARCH_URL: str = "https://mcp-api.tencent-cloud.com/sse/c2453837744fd833"
    # 本地兜底词库开关；True=开启（默认）；False=跳过本地匹配（全靠 TMS）
    CONTENT_MODERATION_LOCAL_WORDS_ENABLED: bool = True
    # 审计写入策略：False=仅 Review/Block 写审计（默认，省空间）；True=连 Pass 也写
    CONTENT_MODERATION_AUDIT_ALL: bool = False
    # 后台巡检：定期重扫最近内容,TMS 模型升级后能发现旧内容中的违规
    CONTENT_MODERATION_RESCAN_ENABLED: bool = True
    CONTENT_MODERATION_RESCAN_HOURS: int = 6
    
    # 文本生成 LLM：DeepSeek（OpenAI-compatible）
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    # 主模型（reasoning，用于深度诊断/创作）
    DEEPSEEK_MODEL: str = "deepseek-v4-flash"
    # 快速模型（chat，用于结构化抽取/分类/分段）
    # P0 优化 O2：把结构化抽取类任务从 reasoning 切到 chat，预计提速 3-5x
    DEEPSEEK_MODEL_FAST: str = "deepseek-v4-flash"

    # ── Embedding（阿里百炼 Qwen3-Embedding text-embedding-v4）────────────────
    # 走 OpenAI 兼容协议 /v1/embeddings；复用同一把 DASHSCOPE_API_KEY（与 MCP 联网搜索同 key）。
    # 可选维度：2048 / 1536 / 1024(默认) / 768 / 512 / 256 / 128 / 64。
    # 我们固定用 1536，与原 pgvector Vector(1536) 列对齐，无需列级迁移。
    # base_url 三种写法（按场景选一）：
    #   通用默认工作空间：  https://dashscope.aliyuncs.com/compatible-mode/v1
    #   北京地域 + WorkspaceId：https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
    #   新加坡地域：           https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
    # 从 https://bailian.console.aliyun.com/ 获取 WorkspaceId
    DASHSCOPE_EMBEDDING_BASE_URL: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    DASHSCOPE_EMBEDDING_MODEL: str = "text-embedding-v4"
    DASHSCOPE_EMBEDDING_DIM: int = 1536   # 与现有 Vector(1536) 列对齐，省迁移
    DASHSCOPE_WORKSPACE_ID: str = ""      # 留空走默认工作空间；走地域填此 ID 并改 base_url

    # 业务代码用的统一字段名（models.py 的 Vector(EMBEDDING_DIM) 与之对齐）
    EMBEDDING_MODEL: str = DASHSCOPE_EMBEDDING_MODEL     # 兼容老引用
    EMBEDDING_DIM: int = DASHSCOPE_EMBEDDING_DIM          # 兼容老引用（仍 1536）
    EMBEDDING_BATCH_SIZE: int = 10    # DashScope 单批上限 10 条
    EMBEDDING_TIMEOUT_S: float = 30.0
    EMBEDDING_QPS: int = 100          # DashScope QPS 较宽松，可按实际情况调

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

    # 文件保留策略，单位：天。
    # 内测档 test 60 天；免费档 30 天。PRO/MAX 暂未上线。
    FILE_RETENTION_DAYS_TEST: int = 60
    FILE_RETENTION_DAYS_FREE: int = 30
    # 过期文件清理任务运行周期，单位：小时
    FILE_CLEANUP_INTERVAL_HOURS: int = 24

    # 日志保留天数。TimedRotatingFileHandler 的 backupCount 与孤立旧日志清理任务共用此值。
    LOG_RETENTION_DAYS: int = 7
    # 孤立旧日志清理任务运行周期，单位：小时
    LOG_CLEANUP_INTERVAL_HOURS: int = 24
    # 日志清理任务要扫描的额外目录（逗号分隔）。默认空。
    # 在 Docker 部署下无需配置 —— 容器内 /app/logs 经 docker-compose volume 映射到宿主机 /data/logs，
    # 容器内直接清理 /app/logs 即可。对于裸机/直接进程运行的场景，
    # 可以在这里显式指定宿主机的日志目录（例如 /data/logs）。
    LOG_CLEANUP_DIRS: str = ""

    # 单点登录豁免名单（逗号分隔用户名，大小写不敏感）。
    # 这些账号再次签发 token 时不会挤掉前一会话，允许多端同时在线。
    # 默认仅豁免 admin（管理员账号需要日常多端调试，避免自己挤掉自己）。
    MULTI_SESSION_EXEMPT_USERNAMES: str = "admin"

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
    # 正式上线免费档：录音 0（关闭）/ 记录 1 / 简历 1
    QUOTA_FREE: dict = {"audio": 0, "record": 1, "resume": 1}
    # 内测版本统一为 test 档（2026-07-18+）：所有内测用户（包括 admin）均为 test
    # 内测额度：面试录音分析 2 次 / 面试记录分析 3 次 / 简历分析 3 次 / 模拟面试 10 分钟（live.py MEMBERSHIP_MONTHLY_MINUTES）/ AI 职业顾问 30 次/天（counselor.py DAILY_LIMIT）
    # 注册起 30 天后自动降级为 FREE 配额（quota.py _is_trial_expired 控制）
    QUOTA_TEST: dict = {"audio": 2, "record": 3, "resume": 3}

    # Aliyun Bailian DASHSCOPE_API_KEY
    DASHSCOPE_API_KEY: str = ""

    @model_validator(mode="after")
    def _check_jwt_secret(self) -> "Settings":
        """
        启动期校验 JWT_SECRET：
        - 禁止空值或已知占位符（避免 .env 漏配或残留模板值时静默用弱密钥启动）
        - 强制 ≥32 字节熵（HS256 的 NIST 推荐下限，防止开发同学临时填个 "secret" 就跑）
        """
        unsafe = {
            "",
            "secret",
            "changeme",
            "super-secret-key-change-me",
            "super-secret-key-change-me-in-production",
        }
        if self.JWT_SECRET in unsafe:
            raise ValueError(
                "JWT_SECRET 未配置或仍为占位符 — 请在 .env 中设置 `openssl rand -hex 64` 的输出（≥32 字节熵）"
            )
        if len(self.JWT_SECRET) < 32:
            raise ValueError(
                f"JWT_SECRET 强度不足：当前 {len(self.JWT_SECRET)} 字符，HS256 至少需要 32 字节（256 bit）熵"
            )
        return self

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
