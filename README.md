# 面试驾到 · OfferPilot

> 落地页技术栈、核心概念、子产品矩阵的总览见 [docs/](./docs/)。
> 视觉规范（配色 / 字体 / 玻璃拟态）见 [OfferPilot 视觉规范](C:\Users\47181\.claude\projects\D--ai-----offerPilot\memory\offerpilot-visual-style.md)。
> 服务器侧"Docker 部署 + 密钥注入"全过程见 [docs/部署文档.txt](./docs/部署文档.txt)。

**面试驾到（内部代号 OfferPilot / 前缀 `interviewvar_*`）** 是一款 AI 驱动的面试智能分析与职业成长辅助系统。它围绕**真实面试录音 / 简历 / 模拟面试 / 复盘记忆 / 社区反馈**五个核心场景，串联 DeepSeek 推理、火山引擎双 ASR（流式短语音 + 实时语音大模型）、阿里百炼 Embedding、pgvector RAG、对象存储、文档解析、用户画像与会员体系，为求职者提供从投递前到拿 offer 后的全周期陪伴。

仓库采用 **前后端分离** Monorepo + **Docker 多容器** 生产部署：

```
offerPilot/
├── backend/          # FastAPI 后端（Python 3.10+，uvicorn 2 worker）
├── frontend/         # Next.js 16 前端（React 19 / Tailwind 4，独立同源部署）
├── deploy/           # docker-compose · nginx · env.public · setup-secrets.sh · swap.sh · package.ps1
├── docs/             # 部署文档 + nanobanana-ppt 视觉/运营资料
└── README.md         # ← 你正在读的文件
```

---

## 目录

- [核心特性](#核心特性)
- [五大子产品矩阵](#五大子产品矩阵)
- [技术栈一览](#技术栈一览)
- [项目结构](#项目结构)
- [本地开发](#本地开发)
  - [环境要求](#环境要求)
  - [启动后端](#启动后端)
  - [启动前端](#启动前端)
- [后端（backend/）详解](#后端backend详解)
  - [技术栈与依赖](#技术栈与依赖)
  - [路由层（11 个 router）](#路由层11-个-router)
  - [服务层（19 个 service）](#服务层19-个-service)
  - [工具层（utils/）](#工具层utils)
  - [数据模型（17+ 张 ORM 表）](#数据模型17-张-orm-表)
  - [REST API 一览](#rest-api-一览)
  - [核心业务流程](#核心业务流程)
  - [配置项：.env / .env.public](#配置项env--envpublic)
  - [会员等级 / 文件保留](#会员等级--文件保留)
- [前端（frontend/）详解](#前端frontend详解)
  - [技术栈与依赖](#技术栈与依赖-1)
  - [路由与目录](#路由与目录)
  - [AuthProvider 全局认证](#authprovider-全局认证)
  - [视觉规范](#视觉规范)
  - [与后端的接口约定](#与后端的接口约定)
- [生产部署（Docker + Secrets）](#生产部署docker--secrets)
  - [一键初始化服务器](#一键初始化服务器)
  - [9 个第三方密钥注入](#9-个第三方密钥注入)
  - [打包 / 换包 / 回滚](#打包--换包--回滚)
- [前后端交互流程图](#前后端交互流程图)
- [常见问题](#常见问题)
- [Roadmap](#roadmap)
- [License](#license)

---

## 核心特性

- **真实录音闭环**：上传 mp3/wav → 火山引擎·豆包·流式短语音 ASR → DeepSeek 推理 → IPI 分数 / Offer 概率 / 风险点 / STAR 优化话术 / 语义分段小评。后台 `run_periodic_cleanup` 每 24h 按会员档位清理过期文件。
- **实时语音模拟面试（Live）**：4 类岗位 × 4 档难度 × 16 套人格/音色组合 → 火山引擎**实时语音大模型 dialog**（与流式 ASR **不是同一把 key**）双向对话。即时统计面试时长，按 (week, month) upsert 到 `user_live_minutes`，免费用户不可用、内测用户 10 分钟/月（注册起 30 天后过期降级为 0）。
- **简历原文保真改写**：上传 PDF/DOCX → `pdf2docx`（PyMuPDF 后端）兜底转 DOCX → 规则化抽取结构 → DeepSeek 仅优化工作经历 bullets → `python-docx` 原地替换 run 文字，**字体 / 颜色 / 分栏 / 图标全部保留**，bullet 匹配率 < 80% 自动 `BulletMatchError` 抛 500。导出兼容 PDF / DOCX 双格式。
- **AI 职业顾问（Counselor）RAG**：DeepSeek + 阿里百炼 Qwen3-Embedding v4（**1536 维** + pgvector **HNSW + cosine ops**，对称嵌入），召回历史面试总结 / 简历分析 / 项目记忆 / 实时面试 transcript 等 6 类 `source_type`，SSE 流式输出 + `[cite:TYPE#ID#CHUNK]` 溯源标记。MCP 客户端（`streamable_http_client + terminate_on_close`，**锁 mcp==1.27.0**）对接联网搜索工具，`tool_registry.py` 声明式注册。
- **精选推荐（Featured Guides）+ 反馈社区（Feedback）**：`featured_guides` 启动期用 `INSERT ... ON CONFLICT (id) DO UPDATE` 幂等写入 6 条预置数据（小红书 / 抖音图文笔记）。`feedbacks / comments / votes` 三表支持置顶、点赞、匿名留存的反馈墙。
- **内容审核与敏感词过滤**：所有用户文本提交（反馈、评论、文档描述等）过 `moderation_dep` 装饰器；`moderation_audit_logs` 表用 **SHA-256 + 关键词 hash** 存储，**不存原文 / 不存明文**，符合合规要求。
- **会员分层 + 文件生命周期**：当前档位 `NULL=免费` / `"test"=内测`（PRO/MAX 暂未上线），对应文件保留 `7/30/120` 天；上传时锁定 `files.retention_days`，与后续升降级解耦。rolling 30 天配额改用 `user_quota_usage` 时间戳表，避免「删业务记录却重置配额」的旧 bug。
- **多模态视觉体验**：玻璃拟态 + 3D 倾斜卡片 + GSAP / Framer Motion 动效 + Tailwind 4 自定义 Material 3 主题，深色太空感 UI。
- **安全优先**：bcrypt 加盐 + JWT（HS256，24h 过期）+ Redis 黑名单 + 6 位验证码（短信 / SES 邮件）+ 跨标签页 `localStorage` 同步。

---

## 五大子产品矩阵

| 子产品 | 前端入口 | 后端 Router | 核心能力 |
| --- | --- | --- | --- |
| 🎙 **面试录音分析** | `/debugger/record` → `/debugger/report` | `audio.py` | 真实录音 → 流式 ASR → DeepSeek → IPI / Offer 概率 / 风险 / STAR 优化 |
| 📄 **简历诊断与改写** | `/debugger/resume` | `resume.py` | PDF/DOCX 解析 → LLM 评分 → **保留原样式**改写 DOCX；支持 PDF 导出 |
| 🗣 **AI 模拟面试（Live）** | `/debugger/voice` | `live.py` | WebSocket 接火山实时语音大模型，按 persona + duration 自动对话 |
| 🧠 **复盘记忆 + AI 职业顾问** | `/memory` + `/home` | `memory.py` · `counselor.py` | 历史报告聚合 / 项目记忆 / 知识能力图谱 / SSE 流式顾问问答 |
| 🌐 **精选推荐 + 反馈社区** | `/guide` · `/feedback` | `guide.py` · `feedback.py` | 精选文章视频墙 + 用户反馈列表 / 评论 / 点赞 |

---

## 技术栈一览

| 维度 | 选型 |
| --- | --- |
| 前端框架 | **Next.js 16.2.6**（App Router） + **React 19.2.4** |
| 前端样式 | **Tailwind CSS 4** + CSS Variables（Material 3 风格自定义主题） |
| 前端动效 | **Framer Motion 12** + **GSAP 3.15** |
| 前端语言 | TypeScript 5（strict） |
| 后端框架 | **FastAPI**（异步） + **Uvicorn**（生产 `--workers 2`） |
| 后端语言 | Python 3.10+ |
| ORM | **SQLAlchemy 2.x async** + `asyncpg`（Windows 强制 `SelectorEventLoopPolicy`） |
| 数据库 | **PostgreSQL 14 + pgvector**（镜像 `pgvector/pgvector:pg16`） |
| 缓存 | **Redis 7**（验证码 / 限流 / Token 黑名单 / 分布式 leader 选举） |
| 对象存储 | **腾讯云 COS**（`ap-nanjing` · bucket `offer-pilot-1392177347`） |
| 文本生成 LLM | **DeepSeek**（`https://api.deepseek.com/v1`，OpenAI-compatible） |
| 实时语音 | **火山引擎·实时语音大模型 dialog**（WebSocket，双向对话） |
| 流式短语音 ASR | **火山引擎·豆包·流式短语音识别**（submit / query 轮询） |
| Embedding + RAG | **阿里百炼 Qwen3-Embedding v4**（1536 维 / pgvector HNSW / 对称嵌入） |
| 联网搜索 | MCP 客户端 `streamable_http_client`（pin `mcp==1.27.0`，与 redis / dashscope 共 key） |
| 短信 | 腾讯云 SMS（缺省回退日志模拟） |
| 邮件 | **腾讯云 SES**（`TENCENT_SES_REGION` 等；缺省回退日志模拟）—— 已从原 SMTP 迁移 |
| 鉴权 | **bcrypt** + **PyJWT**（HS256） |
| 文档解析 | `pypdf` · `python-docx` · `pdf2docx`（PyMuPDF 后端） · LibreOffice headless（PDF 导出） |
| 内容审核 | 自研 TF-IDF + 关键词 hash 审计（不依赖第三方云） |
| 部署 | Docker Compose（5 容器：postgres / redis / backend / frontend / nginx） · `setup-secrets.sh` 注入 9 把密钥 · `package.ps1` + `swap.sh` 一键换包 |

---

## 项目结构

```
offerPilot/
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── .env                      # 本地开发完整 env（不入仓）
│   ├── .dockerignore
│   ├── restart.ps1 / inspect_pid.ps1   # Windows 本地调试
│   └── app/
│       ├── main.py               # FastAPI 入口 · CORS · Redis leader · 启动期 seed
│       ├── config.py             # pydantic-settings（partial：env.public + secrets 组合）
│       ├── database.py           # async_engine / async_session / get_db / get_redis
│       ├── models.py             # 17+ 张表 ORM（含 pgvector Vector(1536)）
│       ├── schemas.py            # Pydantic v2 入参 / 出参
│       ├── routers/              # 11 个路由（详见下表）
│       ├── services/             # 19 个服务（详见下表）
│       └── utils/                # 鉴权 / 短信 SES / ASR / LLM / RAG / 文档解析 / 清理 / 调度
│
├── frontend/
│   ├── Dockerfile                # 多阶段，output: "standalone"
│   ├── package.json
│   ├── next.config.ts
│   └── src/app/                  # App Router 路由
│
├── deploy/
│   ├── docker-compose.yml        # 5 容器：postgres / redis / backend / frontend / nginx
│   ├── env.public                # 非敏感配置模板（入库）
│   ├── setup-secrets.sh          # 9 个敏感 key 注入脚本（交互 / --force / --check / --only）
│   ├── nginx.conf                # 反代 + WebSocket + Gzip
│   ├── package.ps1               # 本地 docker save + scp 到 /data/packages
│   ├── swap.sh                   # 服务器侧 docker load + up -d + image prune
│   ├── secrets/                  # 9 个敏感 key 文件目录（不入库，gitignore）
│   ├── ses/                      # SES 凭证（如改回 SMTP 时使用）
│   ├── ssl/                      # 证书挂载（nginx）
│   └── packages/                 # 本地打包产物 backend.tar / frontend.tar
│
├── docs/
│   ├── 部署文档.txt              # 服务器初始化 → Dockerfile → 打包 → 换包完整流程
│   ├── cors-setup-checklist.md
│   └── nanobanana-ppt/           # 产品视觉 / 运营 PPT 资料
│
├── .claude.md
├── .gitattributes                # *.sh text eol=lf（防 Linux CRLF 报错）
├── .gitignore
└── README.md
```

---

## 本地开发

### 环境要求

| 工具 | 版本 |
| --- | --- |
| Node.js | ≥ 20 |
| Python | ≥ 3.10（Windows 强制 SelectorEventLoop） |
| PostgreSQL | ≥ 14 + pgvector 扩展（启动期自动 `CREATE EXTENSION IF NOT EXISTS vector`） |
| Redis | ≥ 6 |
| （可选）Docker | 仅生产部署需要；本地直接跑 `python -m app.main` 即可 |

### 启动后端

```bash
cd backend

python -m venv venv
source venv/Scripts/activate     # Git Bash / macOS / Linux 各自调整
pip install -r requirements.txt

# 把 .env 复制好（找运维拿本地版，**不要 commit**）
cp .env.example .env             # 或直接编辑 .env

# 启动
python -m app.main
# 监听 http://localhost:8001
# Swagger UI: http://localhost:8001/docs
```

`python -m app.main` 内部等价于：

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload \
  --reload-includes "*.env,*.py" --no-access-log
```

启动期会自动：

1. 装载 Docker secrets（服务器侧生效，本地 no-op —— 由 `app/utils/secrets.py` 提供）。
2. `CREATE EXTENSION IF NOT EXISTS vector` + `Base.metadata.create_all`（开发期便利，生产建议改 Alembic）。
3. 启动后台协程：`run_periodic_cleanup`（过期文件清理）、`run_periodic_pending_presign_cleanup`、`run_periodic_log_cleanup`、`run_periodic_rescan`（内容审核定期重扫）。
4. 通过 **Redis 分布式 leader 选举**（`app/utils/scheduler.py`）确保 `--workers 2` 时每个周期任务 / 启动期一次性任务只跑一次：`_startup_log_cleanup` / `_seed_project_tags` / `_seed_admin_account` / `_seed_featured_guides`。

### 启动前端

```bash
cd frontend
npm install
npm run dev
# 打开 http://localhost:3000
```

前端通过 `http://localhost:8001` 直连后端（CORS 已放行 `localhost:3000` / `127.0.0.1:3000` / `124.223.185.108` / `interviewvar.com`）。生产改为 `NEXT_PUBLIC_API_BASE` + nginx 同源代理。

---

## 后端（backend/）详解

### 技术栈与依赖

来自 `backend/requirements.txt`：

| 类别 | 包 |
| --- | --- |
| Web | `fastapi` · `uvicorn[standard]` |
| ORM / DB | `sqlalchemy>=2.0` · `asyncpg` · `pgvector`（SQLAlchemy 类型） |
| 缓存 | `redis` |
| 鉴权 | `pyjwt` · `bcrypt` |
| 腾讯云 | `tencentcloud-sdk-python`（SMS / SES）· `cos-python-sdk-v5`（对象存储） |
| HTTP 客户端 | `httpx` · `httpcore`（含 MCP 客户端依赖） |
| LLM / Embedding | OpenAI 兼容 SDK（DeepSeek + 阿里百炼共用） |
| MCP | `mcp==1.27.0`（**必须锁定**，低版本会触发 `streamable_http_client` 3 元组 + `terminate_on_close` 的 ValueError） |
| 数据校验 | `pydantic>=2` · `pydantic-settings` · `python-dotenv` · `python-multipart` |
| 文档解析 | `python-docx>=1.0` · `pdf2docx>=0.5`（PyMuPDF 后端） · `pypdf` |

### 路由层（11 个 router）

`main.py` 通过 `app.include_router(...)` 注册，并异步尝试加载 `memory.py`（如失败只 warn，不阻塞）：

| Router | 文件 | 路径前缀 | 一句话 |
| --- | --- | --- | --- |
| `auth` | `routers/auth.py` | `/api/auth` | 注册 / 登录 / 验证码 / 档案 / 注销 |
| `audio` | `routers/audio.py` | `/api/audio` | 录音会话、ASR 编排、报告聚合 |
| `file` | `routers/file.py` | `/api/file` | COS 桥接 / presign 上传 / 删除 |
| `resume` | `routers/resume.py` | `/api/resume` | 简历分析 / DOCX/PDF 双格式导出 |
| **`live`** | `routers/live.py` | `/api/live` | **实时语音面试** WebSocket + quota |
| **`counselor`** | `routers/counselor.py` | `/api/counselor` | **AI 职业顾问** SSE 流式对话 |
| **`feedback`** | `routers/feedback.py` | `/api/feedback` | 反馈列表 / 评论 / 点赞 |
| **`guide`** | `routers/guide.py` | `/api/guide` | 精选推荐 featured_guides CRUD |
| **`admin_moderation`** | `routers/admin_moderation.py` | `/api/admin/moderation` | 审核日志检索（仅 admin） |
| **`moderation_preview`** | `routers/moderation_preview.py` | `/api/moderation/preview` | 预演审核结果（调试用） |
| **`memory`** | `routers/memory.py` | `/api/memory` | 复盘 / 项目记忆 / 知识能力图谱（异步 import） |

### 服务层（19 个 service）

`backend/app/services/` 把"协议 / IO / 调度"从 router 抽出来：

| Service | 角色 |
| --- | --- |
| `advisor_generator` | 顾问会话的「建议四栏」（focus_areas / interview_trends / recommended_actions / career_suggestions）生成 |
| `company_tiers` | 公司分级字典（用于简历匹配度打分） |
| `counselor_agent` | RAG 召回 + SSE 流式生成主入口 |
| `embedding` | 阿里百炼 Qwen3-Embedding v4 客户端（1536 维，带 retry + 截断） |
| `embedding_indexer` | 把面试 / 简历 / 项目 / live transcript 切分后写入 `user_analysis_embeddings` |
| `grade_mapping` | 「职级」标准化（如 P5/P6 ↔ Lv1/Lv2） |
| `knowledge_ability_service` | 4 核心能力 + 20 细化能力的生成 / 触发 |
| `live_bridge` | 实时语音面试事件桥（候选人退出 / 中断 / 完成） |
| `live_config` | 16 套人格 / 音色配置（`LIVE_PROFILES`）；**火山 `speech_rate` 直接透传**，不做后处理 |
| `live_slots` | 时间段估算 / 并发排队 |
| `match_scorer` | 简历 ↔ 求职目标匹配度 30–97 分算法 |
| **`mcp_client`** | **`streamable_http_client + terminate_on_close` 包装，pin `mcp==1.27.0`** |
| `project_memory_agent` | 项目记忆 LLM 抽取（`project_memories` 写入） |
| `project_mention_service` | 面试 transcript 反查项目提及次数（`mention_count`/`last_mentioned_at`） |
| `question_generator` | 高频面试题 LLM 生成（按 4 核心能力 + 20 细化能力，每项 10 道） |
| `quota` | 试用期判断 / 配额计算（`_is_trial_expired`） |
| `tool_registry` | 工具声明式注册（agent 函数 ↔ 联网搜索 MCP） |
| `volc_realtime_bridge` | 火山实时语音大模型 WebSocket 双向桥 |
| `volc_streaming_asr` | 火山流式短语音 ASR 客户端（submit / query 轮询） |

### 工具层（utils/）

| Utility | 角色 |
| --- | --- |
| `security.py` | bcrypt 哈希 + JWT 签发与校验 |
| `secrets.py` | Docker secrets 装载器（启动期读 `/run/secrets/*` → `os.environ`，本地 no-op） |
| `scheduler.py` | Redis 分布式 leader 选举 + `log_once`（多 worker 日志去重） |
| `sms.py` | 腾讯云 SMS（缺省日志模拟） |
| `email_ses.py` | 腾讯云 SES 邮件（替代原 SMTP） |
| `asr.py` | 旧 ASR stub（保留兼容；新代码走 `services/volc_streaming_asr.py`） |
| `llm.py` | DeepSeek Chat 调用 + JSON 鲁棒解析 + 4 次指数退避重试 |
| `resume_parser.py` | PDF/DOCX 文本 + 结构抽取 |
| `docx_resume_writer.py` | `python-docx` 原地替换 run 文字；**NFKC + smart quote + fuzzy 兜底**修 0/12 匹配；`BulletMatchError` 阈值 80% |
| `pdf_to_docx.py` | PDF → DOCX（pdf2docx 线程池） |
| `cleanup.py` | `run_periodic_cleanup` / `run_periodic_pending_presign_cleanup` / `cleanup_old_logs` |
| `content_moderation.py` | 内容审核 + 关键词 hash + 周期重扫 |
| `moderation_dep.py` | `moderated` 装饰器（路由 / 服务的统一入口） |
| `match_grade.py` | 求职期望匹配度（与 `services/match_scorer.py` 协作） |

### 数据模型（17+ 张 ORM 表）

`app/models.py` 关键表（全部带 `created_at` / `updated_at`）：

| 模块 | 表 | 关键字段 | 备注 |
| --- | --- | --- | --- |
| 账户 | `users` | `username/phone/email` 唯一 · `membership` (`NULL`/`test`) · `is_online` | 删除级联 |
| 账户 | `user_profiles` | 1:1 画像 · `match_rate` (30-97) · `match_rate_pending` · `additional_desc` | 走 RAG 召回 |
| 录音分析 | `interview_sessions` | `company/role/round/date/grade/salary` 列 · `ipi_score` · `offer_probability` · `quota_charged` · `error_message` | |
| 录音分析 | `analysis_tasks` | `task_type` (`asr/parsing/risk/final_report`) · `progress` | 子任务进度 |
| 录音分析 | `interview_transcripts` | `session_id` PK · `data JSONB` | **整段一条 JSONB**，不再一行一句 |
| 录音分析 | `transcript_sections` | `title` 2-6 字 · `category` (6 类) · `tag` (良好/一般/风险) · `advantages/shortcomings/review_points` | 语义分段小评 |
| 录音分析 | `interview_questions` / `interview_risks` / `answer_improvements` | `category/difficulty/question/answer` · `risk_type/severity/title/evidence/suggestion` · STAR 改写 | |
| 文件 | `files` | `cos_key` · `status` (`pending`/`finalized`) · `presign_token` · `retention_days` | presign 直传方案 |
| 简历 | `resume_analyses` | `score/optimized_score/ats_pass_rate` · `result_json` JSONB | `file_id` 改 `SET NULL`（文件清理不毁报告） |
| 项目记忆 | `project_memories` | `(user_id, project_name)` 唯一 · `version` · `mention_count` · `last_mentioned_*` | 二次上传触发 version 累进 |
| 项目记忆 | `project_tags` | 字典表：8 主分类 + 10 辅助标签 | 启动期 `_seed_project_tags` 幂等 |
| **Live** | `interview_live_sessions` | `interview_type/difficulty/duration_min/followup_rounds` · `voice_id/persona_cn` · 状态机 `created→ws_connecting→live→ending→ended→analyzing→completed\|failed` · partial unique 限流 | **v1.2 设计** |
| **Live** | `user_live_minutes` | `(user_id, period_type, period_key)` 唯一 · `total_seconds` · `sessions_count` | PR6 限额 |
| **Counselor** | `user_analysis_embeddings` | `(source_type, source_id, chunk_index)` 唯一 · **`Vector(1536)`** · HNSW index `vector_cosine_ops` | RAG 主索引 |
| **Counselor** | `counselor_sessions` | `summary` + `summary_upto_msg_id` + `message_count` | 长会话压缩 |
| **Counselor** | `counselor_messages` | `content` · `citations` · `recalled_chunks` · `stream_completed` | |
| **Counselor** | `user_advisor_insights` | `insights` JSONB（四栏建议） | |
| **Counselor** | `knowledge_core_abilities` / `knowledge_sub_abilities` / `knowledge_question_cache` | (user_id, sub_ability_name) 唯一 · `questions` JSONB（每项 10 道永久缓存） | |
| 配额 | `user_quota_usage` | `(user_id, feature, used_at)` 三元组索引；30 天滚动窗口 | 时间戳天然处理过期 |
| 反馈 | `feedbacks` / `feedback_comments` / `feedback_votes` | `type/module/screenshot_url` · `is_pinned` · 注销时 `user_id SET NULL` 保留匿名 | |
| 精选 | `featured_guides` | `platform/platform_badge_bg/fans_count`（**NOT NULL varchar**） | `_seed_featured_guides()` 幂等 |
| 审核 | `moderation_audit_logs` | `content_hash` (SHA-256) · `keywords_hash` JSONB · `is_fallback` | **不存原文 / 不存明文** |

### REST API 一览

> BaseURL：`http://localhost:8001`
> 所有受保护接口在 Header 中携带 `Authorization: Bearer <token>`。

#### `/api/auth`（注册 / 登录 / 档案）

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/send-code` | 发送 6 位验证码（短信 / SES 邮件），1 分钟限流，5 分钟有效 |
| POST | `/register/step1` | 校验用户名 / 手机 / 邮箱唯一性 + 验证码 |
| POST | `/register/complete` | 三步注册写库 + 发 JWT (24h) |
| POST | `/login` | 密码 / 验证码双模式 |
| POST | `/logout` | token 入 Redis 黑名单（24h） |
| POST | `/reset-password` | 验证码 + 新密码重置 |
| PUT | `/security/update` | 改绑定手机 / 邮箱 / 密码 |
| DELETE | `/delete-account` | 注销账号（级联删业务数据，feedback/vote 改匿名） |
| GET/PUT | `/me` · `/profile/update` | 当前用户档案读 / 改 |

#### `/api/file` · `/api/audio` · `/api/resume`

见后端 router 章节顶部的「核心业务」流程图，主要是 multipart 上传 → presign 直传 → 后台 ASR+LLM 编排 → 报告聚合。

#### `/api/live`（**实时语音面试**）

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/sessions` | 创建 live 会话（落 `interview_live_sessions`） |
| GET | `/sessions/{id}` | 查会话详情 |
| POST | `/sessions/{id}/start` | 标记 `started_at`，进入 `ws_connecting` |
| WS | `/ws/{session_id}` | 候选人 ↔ 火山实时语音大模型（双向音频 / 文本事件） |
| POST | `/sessions/{id}/end` | 关闭 session · 触发分析 · 写 `user_live_minutes` |
| GET | `/sessions/{id}/report` | 实时面试报告（IPI / Offer 概率 / 优劣 / executive_summary） |
| GET | `/quota` | 查询当月实时面试剩余时长（**免费=0 / test=10 分钟/月**） |
| GET | `/history` | 历史 live 列表 |

#### `/api/counselor`（**AI 职业顾问**）

| Method | Path | 说明 |
| --- | --- | --- |
| POST | `/chat` | **SSE 流式**对话；带 `session_id` 时续写，否则新开会话 |
| GET | `/sessions` | 会话列表（含 `summary` / `message_count`） |
| GET | `/sessions/{id}` | 会话详情（含 messages + recalled_chunks） |
| DELETE | `/sessions/{id}` | 删除会话 |

#### `/api/guide` · `/api/feedback` · `/api/memory` · `/api/admin/moderation`

文档已在 router 文件中以 `tags` 标注；`/api/memory/projects` `/api/memory/knowledge/abilities` 等端点支撑 `/home` 与 `/memory` 页数据；`/api/admin/moderation` 仅 admin（admin / offerPilot@2026）可读审核日志。

### 核心业务流程

#### A. 注册 → 画像 → 求职期望

```
POST /api/auth/register/step1   →  username / phone / email 唯一性 + 验证码
          ↓
前端 /register 收 profile + 期望
          ↓
POST /api/auth/register/complete →  写 users + user_profiles → JWT(24h)
```

#### B. 录音分析（最重链路，2026-08-04 性能优化版）

```
[Frontend] /debugger/record
  1) POST /api/file/upload       →  COS upload + presigned URL（multipart / presign 二选一）
  2) POST /api/audio/check_limit →  30 天滚动窗口配额校验（user_quota_usage）
  3) POST /api/audio/create_session   →  interview_sessions row
  4) POST /api/audio/start_analysis   →  后台协程 run_real_analysis()
       ├─ ASR   (utils/asr → services/volc_streaming_asr)      submit → query 轮询
       ├─ LLM   (utils/llm)
       │     ├─ generate_transcript_highlights()   句子级高亮
       │     ├─ sectionize_transcript()            语义分段
       │     └─ analyze_interview_dialogue()       IPI / Offer 概率 / 优劣势
       └─ 落库   interview_transcripts · sections · questions · risks · improvements · sessions
  5) GET  /api/audio/task_progress/{task_id}       轮询
  6) GET  /api/audio/session/{id}/report           /debugger/report
```

#### C. 实时语音面试 Live（PR1+）

```
[Frontend] /debugger/voice 选 4×4×duration  →  POST /api/live/sessions
                                          ↓
           ws_connecting → live 双向对话（volc_realtime_bridge）
                                          ↓
           候选人结束 → POST /api/live/sessions/{id}/end
                                          ↓
           analyzing → 火山 ASR 流式结果转写 + DeepSeek 评测
                                          ↓
           写 user_live_minutes 当周 + 当月 upsert
```

#### D. AI 职业顾问 Counselor

```
[Frontend] /memory + /home 弹窗
  POST /api/counselor/chat {session_id?, message}  →  SSE 流
       ├─ RAG：把 message 喂 Embedding → pgvector HNSW cosine 召回 top-k
       │        source_type ∈ {面试总结, 语义分段, 简历分析, 项目记忆, live interview, live transcript}
       ├─ tool_registry 触发联网搜索 MCP（如需要）
       ├─ counselor_agent 流式生成，[cite:TYPE#ID#CHUNK] 标记引用
       └─ 落 counselor_messages（含 citations + recalled_chunks）
```

#### E. 简历分析 + 改写（DOCX + PDF 双格式导出）

```
[Frontend] /debugger/resume
  POST /api/file/upload (file_type=resume)
  POST /api/resume/analyze {file_id}
     ├─ extract_resume_text()               PDF / DOCX → 纯文本
     ├─ parse_resume_structure()            规则化（保真）抽取
     ├─ analyze_resume_text()               DeepSeek 综合评分（保留 thinking，主流程不能盲关）
     ├─ 用画像薪资覆盖 LLM 提取值
     └─ 落库 resume_analyses（result_json 全量）

  GET  /api/resume/analyses/{id}/download?format=docx|pdf
     ├─ PDF 源：convert_pdf_to_docx()（pdf2docx 线程池）
     ├─ DOCX 改写：rewrite_resume_docx()  原地替换 run 文字
     │             NFKC + smart quote + fuzzy 兜底修 0/12 匹配
     │             bullet 匹配 < 80% 抛 BulletMatchError(500)
     └─ Prompt 加 ±15% 字数限制防溢出
  PDF 导出（如选 PDF）：LibreOffice headless 把改写后 DOCX 转 PDF
```

#### F. 文件生命周期（`app/utils/cleanup.py`）

每 24h（`FILE_CLEANUP_INTERVAL_HOURS`）跑一次按以下规则判定过期：

| 场景 | 删除策略 |
| --- | --- |
| 访客文件（`user_id IS NULL`） | 立即删除 |
| 用户不在线（`is_online = False`） | 立即删除 |
| 在线用户按 `membership` | `NULL`=Free 7d / `"test"`=30d / `"pro"`=30d / `"max"`=120d |

删除走 `delete_file_from_storage` —— 先 `client.delete_object(COS)` 再 `db.delete(file)`；COS 失败也继续清库，避免孤儿。`files.retention_days` 在上传时锁定，与后续升降级解耦。

### 配置项：.env / .env.public

> **生产部署**：所有第三方 API key 由 `setup-secrets.sh` 写进 `deploy/secrets/<name>` 文件，Docker secrets 挂载进容器，由 `app/utils/secrets.py` 装载到 `os.environ`。

| Key | 默认（开发） | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@localhost:5432/offerpilot` | 异步 PG；生产换 `postgres:5432` |
| `REDIS_URL` | `redis://localhost:6379/0` | 生产换 `redis:6379` + 密码 |
| `JWT_SECRET` | `super-secret-key-change-me` | **生产必须 `openssl rand -hex 64`** |
| `JWT_ALGORITHM` | `HS256` | |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | 24h |
| `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` | — | 短信 / SES / COS 共用 |
| `TENCENT_SES_REGION` / `TENCENT_SES_FROM_EMAIL` / `TENCENT_SES_FROM_NAME` / `TENCENT_SES_REPLY_TO` / `TENCENT_SES_TEMPLATE_ID` | `ap-guangzhou` / `noreply@interviewvar.com` | **新引入，替代原 SMTP** |
| `TENCENT_SMS_APP_ID` / `_SIGN_NAME` / `_TEMPLATE_ID` | — | 短信 |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | `https://api.deepseek.com/v1` / `deepseek-v4-flash` | |
| `DASHSCOPE_API_KEY` / `DASHSCOPE_EMBEDDING_BASE_URL` / `_MODEL` / `_DIM` / `_WORKSPACE_ID` | `https://dashscope.aliyuncs.com/compatible-mode/v1` / `text-embedding-v4` / `1536` | **联网搜索 MCP 与 Embedding 共 key** |
| `VOLC_STREAMING_ASR_API_KEY` | — | **流式短语音** ASR（与实时语音不是同一把 key） |
| `VOLC_REALTIME_API_KEY` | — | **实时语音大模型** dialog（与流式 ASR 不是同一把 key） |
| `VOLC_REALTIME_APP_KEY` / `VOLC_REALTIME_RESOURCE_ID` / `VOLC_REALTIME_WSS_URL` | `PlgvMymc7f3tQnJ6` / `volc.speech.dialog` / `wss://openspeech.bytedance.com/api/v3/realtime/dialogue` | realtime 固定资源 ID |
| `FILE_RETENTION_DAYS_FREE` / `_TEST` / `_PRO` / `_MAX` | `7` / `30` / `30` / `120` | |
| `FILE_CLEANUP_INTERVAL_HOURS` | `24` | |
| `LOG_RETENTION_DAYS` | `30` | backend.log 按天切块保留 |

### 会员等级 / 文件保留

| 等级 | `users.membership` | 文件保留 | 实时面试（`user_live_minutes` 月度上限） | 顾问 |
| --- | --- | --- | --- | --- |
| 免费 | `NULL` | 7 天 | 0 分钟（不可用） | 终身累计 30 次 |
| 内测 | `"test"`（**注册起 30 天过期**） | 30 天 | 10 分钟 / 月 | 30 次 / 天 |
| Pro（未上线） | `"pro"` | 30 天 | 60 分钟 / 月 | — |
| Max（未上线） | `"max"` | 120 天 | 不限 | — |

> 内测档位由 `services/quota.py:_is_trial_expired` 判断，过期后自动降级为 `NULL`（=free）。

---

## 前端（frontend/）详解

### 技术栈与依赖

| 类别 | 包 |
| --- | --- |
| 框架 | `next@16.2.6` · `react@19.2.4` · `react-dom@19.2.4` |
| 动效 | `framer-motion@^12.4.0` · `gsap@^3.15.0` |
| 工具链 | `typescript@^5` · `eslint@^9` · `eslint-config-next@16.2.6` · `tailwindcss@^4` · `@tailwindcss/postcss@^4` |
| 类型 | `@types/node` · `@types/react@^19` · `@types/react-dom@^19` |

### 路由与目录

`frontend/src/app/`（Next.js App Router）：

| 路由 | 文件 | 角色 |
| --- | --- | --- |
| `/` | `app/page.tsx` | 落地页：Hero / 5 大产品卡片 / 3D 倾斜卡 / 用户证言 |
| `/home` | `app/home/page.tsx` | 职业驾驶舱：档案 / 目标 / 历史报告 / 顾问入口 |
| `/register` | `app/register/page.tsx` | 三步注册流（验证码 → 画像 → 期望） |
| `/training` | `app/training/page.tsx` | 训练营模式（原调试器入口改造） |
| `/memory` | `app/memory/page.tsx` | 复盘聚合 / 项目记忆时间线 |
| `/guide` | `app/guide/page.tsx` | **精选推荐墙**：featured guides + 点赞 / 收藏 / 阅读 |
| `/feedback` | `app/feedback/` | 反馈社区：列表 / 评论 / 点赞 / 置顶 |
| `/debugger` | `app/debugger/page.tsx` | 调试器导航 |
| `/debugger/record` | `app/debugger/record/` | 录音上传 + 实时进度 |
| `/debugger/report` | `app/debugger/report/` | 报告详情（IPI / Offer 概率 / 风险 / STAR 优化） |
| `/debugger/resume` | `app/debugger/resume/` | 简历上传 / 改写 / **DOCX+PDF 双格式下载** |
| `/debugger/voice` | `app/debugger/voice/` | **Live 实时语音模拟面试** |
| `/api` | `app/api/` | Next.js BFF/代理层（与 FastAPI 同源） |
| `/helper` `/utils` | `app/helper/` `app/utils/` | 工具函数 / 类型 |

### AuthProvider 全局认证

```ts
// 关键 localStorage key
interviewVar_token       // JWT
interviewVar_isLoggedIn  // "true" | "false"
interviewVar_user        // JSON 序列化的 UserProfile
```

- 启动时若存在 `token`，自动 `GET /api/auth/me` 合并最新档案。
- 401 → 主动清空凭据 + 广播 `storage` 事件 + 回退默认 `defaultUser`。
- `updateUser()` 本地立即生效写 `localStorage`，再异步 `PUT /api/auth/profile/update`。
- 全局弹窗 `AuthModals`（登录 / 退出 / 注销二次确认）+ `AnimatePresence` Toast。

### 视觉规范

深色太空感 + 玻璃拟态（glassmorphism）+ 微光渐变（`#c0c1ff` → `#ffb2b7`）。

| 角色 | Token / 值 |
| --- | --- |
| 背景 | `--color-background: #0b1326` |
| 表面 | `--color-surface-container-low: #131b2e` / `--color-surface-container-highest: #2d3449` |
| 主色 | `--color-primary: #c0c1ff` |
| 次色 | `--color-secondary: #ffb2b7` |
| 第三色 | `--color-tertiary: #4edea3` |
| 文字 | `--color-on-surface: #dae2fd` |
| 字体 | Inter (body) · Hanken Grotesk (title) · Geist Mono (label/mono) |

完整规范：[OfferPilot 视觉规范](C:\Users\47181\.claude\projects\D--ai-----offerPilot\memory\offerpilot-visual-style.md)。

### 与后端的接口约定

- BaseURL：开发期硬编码 `http://localhost:8001`，CORS 已放行。
- 受保护请求：`Authorization: Bearer <token>`；`credentials` 启用。
- 错误处理：FastAPI `HTTPException(detail=...)` → 前端 `res.json().detail` → Toast / 表单内联。
- 文件上传：`multipart/form-data`，业务字段 `file_type=audio|resume`；或 `presign-upload` 直传 COS。
- 文件下载：`Response(content=..., media_type=...)` + RFC 5987 `filename*=UTF-8''...` 携带中文文件名。

---

## 生产部署（Docker + Secrets）

> 服务器初始化 → Dockerfile → 打包 → 换包完整步骤见 [docs/部署文档.txt](./docs/部署文档.txt)。

### 一键初始化服务器

```bash
# 1. SSH 登入服务器（Ubuntu 22.04+ / 腾讯云 CVM）
ssh ubuntu@<your-ip>

# 2. 挂载数据盘到 /data
sudo umount /dev/vdb 2>/dev/null || true
sudo mkfs.ext4 /dev/vdb
sudo mkdir -p /data && sudo mount /dev/vdb /data
sudo sed -i 's|/dev/vdb /mnt/datadisk0 ext4 defaults,nofail 0 0|/dev/vdb /data ext4 defaults 0 0|' /etc/fstab

# 3. 建子目录 + 4GB swap
sudo mkdir -p /data/{postgres,redis,uploads,logs,backups,scripts,packages}
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 4. Docker（阿里云镜像源）
curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.aliyun.com/docker-ce/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker ubuntu && newgrp docker

# 5. 数据目录移到 /data
sudo systemctl stop docker && sudo mkdir -p /data/docker && sudo mv /var/lib/docker/* /data/docker/ 2>/dev/null || true
sudo tee /etc/docker/daemon.json <<'EOF' >/dev/null
{
  "data-root": "/data/docker",
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com",
    "https://docker.1panel.live"
  ]
}
EOF
sudo systemctl restart docker

# 6. 时区
sudo timedatectl set-timezone Asia/Shanghai
```

### 9 个第三方密钥注入

**永远不要把 API key commit 进 git。** 通过 `deploy/setup-secrets.sh` 把每个 key 写到 `deploy/secrets/<name>` 单文件，由 docker-compose 的 `secrets:` 块挂载进容器，运行时由 `app/utils/secrets.py` 装载到环境变量。

```bash
cd /data/offerPilot/deploy

# 1) 列出全部 9 个 key 的文件名（交接 / 审计用）
./setup-secrets.sh --show-names

# 2) 检查哪些已写入、哪些缺失
./setup-secrets.sh --check

# 3) 交互式写入（缺啥写啥；既有值跳过）
./setup-secrets.sh

# 4) 只想补 / 改单个 key
./setup-secrets.sh --only volc_realtime_api_key

# 5) 全部强制重写（轮换 key 时）
./setup-secrets.sh --force
```

`setup-secrets.sh` 会写入的 9 个 key 文件：

| 文件名 | 用途 |
| --- | --- |
| `deepseek_api_key` | DeepSeek `sk-` 开头 |
| `dashscope_api_key` | 阿里百炼 `sk-` 开头（Embedding + 联网搜索 MCP） |
| `dashscope_workspace_id` | 阿里百炼 WorkspaceId `ws-` 开头 |
| `tencent_secret_id` | 腾讯云 SecretId `AKID` 开头 |
| `tencent_secret_key` | 腾讯云 SecretKey |
| `tencent_sms_app_id` | 腾讯云短信 AppId |
| `volc_streaming_asr_api_key` | **流式短语音** ASR（与 realtime 不是同一把 key） |
| `volc_realtime_api_key` | **实时语音大模型** dialog（与 ASR 不是同一把 key） |
| `jwt_secret` | JWT 签名（`openssl rand -hex 64` ≥32 字节熵） |

### 打包 / 换包 / 回滚

```powershell
# 本地 (Windows · PowerShell)
.\deploy\package.ps1 -Service frontend   # 只打前端
.\deploy\package.ps1 -Service backend    # 只打后端
.\deploy\package.ps1 -Service all        # 一起打
# 产物: deploy\packages\{frontend,backend}.tar
```

```bash
# 服务器
scp deploy/packages/*.tar ubuntu@<ip>:/data/packages/

cd /data/offerPilot
bash deploy/swap.sh frontend   # 只换前端
bash deploy/swap.sh backend    # 只换后端
bash deploy/swap.sh all        # 前后端都换（含 docker image prune -f）
```

### 启动 / 健康检查

```bash
cd /data/offerPilot/deploy
docker compose up -d                 # 5 容器：postgres / redis / backend / frontend / nginx
docker compose ps                    # 状态
docker logs -f offerpilot-backend    # 实时后端日志（自动按天切到 /data/logs）
```

资源上限（`deploy/docker-compose.yml` 中 `deploy.resources.limits`）：

| 容器 | CPU | Memory |
| --- | --- | --- |
| postgres (含 pgvector) | 0.5 | 384M |
| redis | 0.15 | 128M |
| **backend**（uvicorn `--workers 2`） | 1.5 | 2560M |
| frontend (Next.js standalone) | 0.15 | 384M |
| nginx | 0.05 | 64M |

---

## 前后端交互流程图

```
┌──────────────────────┐  HTTPS / JSON  ┌──────────────────────────────────┐
│   Next.js (:3000)    │ ──────────────▶│  FastAPI (uvicorn --workers 2)    │
│  ──────────────────  │                │  ────────────────────────────────  │
│  • /                 │                │  • /api/auth        注册 / 登录   │
│  • /home (职业驾驶舱)│ ◀──── SSE ──── │  • /api/file        presign COS  │
│  • /register         │                │  • /api/audio       录音分析      │
│  • /debugger/*       │                │  • /api/resume      简历诊断      │
│  • /memory           │                │  • /api/live        实时语音 WS   │
│  • /guide            │                │  • /api/counselor   SSE RAG 对话 │
│  • /feedback         │                │  • /api/guide / feedback / memory │
│  • AuthProvider 全局 │                │  • /api/admin/moderation          │
│    状态 + 弹窗 + Toast│               │                                    │
└──────────────────────┘                │  ┌──────────────────────────────┐  │
        │ storage 事件                  │  │ PostgreSQL + pgvector        │  │
        ▼                               │  │ (HNSW / cosine / 1536D)       │  │
   interviewVar_token                   │  └──────────────────────────────┘  │
   interviewVar_user                    │  ┌──────────────────────────────┐  │
                                        │  │ Redis                        │  │
                                        │  │ · 验证码 / 限流 / 黑名单      │  │
                                        │  │ · 分布式 leader 选举          │  │
                                        │  └──────────────────────────────┘  │
                                        │  ┌──────────────────────────────┐  │
                                        │  │ 腾讯云 COS（ap-nanjing）     │  │
                                        │  └──────────────────────────────┘  │
                                        │  ┌──────────────────────────────┐  │
                                        │  │ 外部能力                      │  │
                                        │  │ · DeepSeek                    │  │
                                        │  │ · 火山 ASR + 实时语音大模型     │  │
                                        │  │ · 阿里百炼 Embedding + 联网   │  │
                                        │  │ · 腾讯云 SMS / SES            │  │
                                        │  └──────────────────────────────┘  │
                                        └──────────────────────────────────┘
```

---

## 常见问题

**Q1. 启动报 `pgvector extension` 错误？**
- 镜像必须用 `pgvector/pgvector:pg16`；启动期会自动 `CREATE EXTENSION IF NOT EXISTS vector`，失败仅警告，**仅 counselor 向量检索不可用**，其他功能照常。

**Q2. `mcp` 包启动报 `streamable_http_client` 3 元组 ValueError？**
- `requirements.txt` 必须锁 `mcp==1.27.0`。低版本没有 `terminate_on_close` 参数。
- Docker 镜像层缓存也会复用旧依赖；`swap.sh` 内 `docker image prune -f` 务必保留。

**Q3. 多 worker 下启动期日志打两遍？**
- 由 `app/utils/scheduler.py` 的 Redis leader 选举 + `log_once(key)` 去重；新启动期任务必须包 `run_startup_once(fn)` 让 leader 独占执行。

**Q4. 简历改写下载 500：`BulletMatchError`？**
- bullet 匹配 < 80%：`docx_resume_writer` 已加 NFKC + smart quote + fuzzy 兜底但仍失败。
- 源简历使用「工作经历」section 标题 + 标准 `• / - / *` 缩进；扫描型 PDF 请先 OCR 后再上传。

**Q5. 实时语音面试连不上？**
- `volc_realtime_api_key`（不是 `volc_streaming_asr_api_key`）必须配置；WebSocket URL `wss://openspeech.bytedance.com/api/v3/realtime/dialogue` 与 ResourceId `volc.speech.dialog` 必须固定。
- 免费用户（`membership=NULL`）调 `/api/live/sessions` 会直接 403；需要先把 `membership` 升到 `test`。

**Q6. 验证码没收到？**
- 未配腾讯云 SMS / SES 时，`utils/sms.py` / `utils/email_ses.py` 会**回退日志模拟**，验证码打印到 `backend-YYYY-MM-DD.log`。

**Q7. `Edit/Write` 在 Windows 上改了 .sh，Linux 服务器 `$'\r': command not found`？**
- 仓库根 `.gitattributes` 已写 `*.sh text eol=lf`；新文件记得加。

**Q8. 数据库表结构变更怎么办？**
- `main.startup_event` 第 2 步 `Base.metadata.create_all` 只创建缺失表，不 ALTER。生产建议改 Alembic。

---

## Roadmap

- [ ] PRO / MAX 会员档位定价落地（文件保留 + 实时面试时长 + 顾问限额分级）
- [ ] 视频面试多模态（表情 / 语气分析）
- [ ] OpenAPI 客户端代码自动生成到 `frontend/src/lib/api.ts`
- [ ] WebSocket 流式输出报告（替代当前 `/api/audio/task_progress` 轮询）
- [ ] i18n（英文版）支持
- [ ] Offer 概率模型校准（公开题库 + 用户反馈闭环）

---

## License

本仓库目前为 **Private / All Rights Reserved**。
对外发布 / 二次分发前请联系作者并补充合适的开源协议。
