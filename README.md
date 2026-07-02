# 面试VAR · AI 面试教练系统

> 落地页技术栈、核心概念、四大子产品的总览参见 [docs/](./docs/)。
> 视觉规范（配色 / 字体 / 玻璃拟态）参见 [OfferPilot 视觉规范](C:\Users\47181\.claude\projects\D--ai-----offerPilot\memory\offerpilot-visual-style.md)。

**面试VAR（InterviewVAR）** 是一款 AI 驱动的面试智能分析与职业成长辅助系统。它围绕「真实面试录音 / 简历 / 模拟面试 / 复盘记忆」四个核心场景，串联起 LLM、ASR、对象存储、文档解析、用户画像与会员体系，为求职者提供从投递前到拿 offer 后的全周期陪伴。

仓库采用 **前后端分离** 的 Monorepo 布局：

```
offerPilot/
├── backend/          # FastAPI 后端服务（Python 3.10+）
├── frontend/         # Next.js 16 前端应用（React 19 / Tailwind 4）
├── docs/             # 设计与产品文档（含 nanobanana-ppt 资料）
└── README.md         # ← 你正在读的文件
```

---

## 目录

- [项目亮点](#项目亮点)
- [四大子产品（产品矩阵）](#四大子产品产品矩阵)
- [技术栈一览](#技术栈一览)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
  - [环境要求](#环境要求)
  - [启动后端](#启动后端)
  - [启动前端](#启动前端)
- [后端（backend/）详解](#后端backend详解)
  - [技术栈与依赖](#技术栈与依赖)
  - [目录与模块划分](#目录与模块划分)
  - [数据模型（ORM）](#数据模型orm)
  - [REST API 一览](#rest-api-一览)
  - [核心业务流程](#核心业务流程)
  - [配置项（.env）](#配置项env)
  - [会员等级与文件保留策略](#会员等级与文件保留策略)
- [前端（frontend/）详解](#前端frontend详解)
  - [技术栈与依赖](#技术栈与依赖-1)
  - [目录与路由](#目录与路由)
  - [核心页面与组件](#核心页面与组件)
  - [视觉规范](#视觉规范)
  - [AuthProvider：全局认证状态](#authprovider全局认证状态)
  - [与后端的接口约定](#与后端的接口约定)
- [前后端交互流程图](#前后端交互流程图)
- [常见问题](#常见问题)
- [Roadmap](#roadmap)
- [License](#license)

---

## 项目亮点

- **真实录音闭环**：上传 mp3/wav → 调用火山引擎大模型 ASR → DeepSeek (reasoning) 推理评分 → 一键产出 IPI 分数、Offer 概率、风险点、STAR 优化话术、语义分段小评。
- **简历原文保真改写**：上传 PDF/DOCX → 规则化抽取结构 → LLM 仅优化工作经历 bullets → `python-docx` 原地替换 run 文字，**字体/颜色/分栏/图标全部保留**，bullet 匹配率 < 80% 自动报错。
- **会员分层 + 文件生命周期管理**：Free / Pro / Max 三档免费 7 / 30 / 120 天保留；后台 `run_periodic_cleanup` 每 24h 清理过期文件与离线用户文件。
- **多模态视觉体验**：玻璃拟态 + 3D 倾斜卡片 + GSAP / Framer Motion 动效 + Tailwind 4 自定义主题，深色太空感 UI。
- **安全优先**：bcrypt 加盐 + JWT（HS256，24h 过期）+ Redis 黑名单 + 注册 / 改密 / 改密保全部使用 6 位验证码（短信 / 邮件）+ 跨标签页 localStorage 同步。

---

## 四大子产品（产品矩阵）

| 子产品 | 入口 | 核心能力 | 涉及后端模块 |
| --- | --- | --- | --- |
| 🎙 **面试录音分析** | `/debugger/record` → `/debugger/report` | 真实面试录音上传 → ASR → LLM 评估 → IPI 分数 / Offer 概率 / 风险点 / 逐段小评 | `routers/audio.py` · `utils/asr.py` · `utils/llm.py` |
| 📄 **简历诊断与改写** | `/debugger/resume` | 简历 PDF/DOCX 解析 → LLM 评分 + 优化建议 → **保留原样式** 改写为新版 DOCX 下载 | `routers/resume.py` · `utils/resume_parser.py` · `utils/docx_resume_writer.py` · `utils/pdf_to_docx.py` |
| 🗣 **AI 模拟面试训练** | `/debugger/voice` 与 `/training` | 拟真面试官对话、追问、即时反馈 | `routers/audio.py`（共用 ASR / LLM 通道） |
| 🧠 **复盘记忆与画像** | `/memory` · `/home` | 历史报告聚合、职业画像编辑、Offer 预测 | `routers/auth.py`（profile CRUD） · `routers/file.py` |

> 上述产品形态与「四大子产品」的概念映射与运营故事见 `docs/nanobanana-ppt/`。

---

## 技术栈一览

| 维度 | 选型 |
| --- | --- |
| 前端框架 | **Next.js 16.2.6**（App Router） + **React 19.2.4** |
| 前端样式 | **Tailwind CSS 4** + CSS Variables（Material 3 风格自定义主题） |
| 前端动效 | **Framer Motion 12** + **GSAP 3.15** |
| 前端语言 | TypeScript 5（strict） |
| 后端框架 | **FastAPI**（异步） + **Uvicorn** |
| 后端语言 | Python 3.10+ |
| ORM | **SQLAlchemy 2.x async** + `asyncpg` |
| 数据库 | **PostgreSQL 14+** |
| 缓存 | **Redis 6+**（验证码 / 限流 / Token 黑名单） |
| 对象存储 | **腾讯云 COS**（`ap-nanjing` · bucket `offer-pilot-1392177347`） |
| 大模型（文本生成） | **DeepSeek**（`https://api.deepseek.com/v1`，OpenAI-compatible） |
| ASR | **火山引擎大模型 ASR**（`volc.seedasr.auc`） |
| 短信 | 腾讯云 SMS（缺省时回退到日志模拟） |
| 邮件 | SMTP（缺省时回退到日志模拟） |
| 鉴权 | **bcrypt** + **PyJWT**（HS256） |
| 文档解析 | `pypdf` · `python-docx` · `pdf2docx`（PyMuPDF 后端） |
| 部署目标 | 前后端各自独立运行：前端 `:3000`、后端 `:8001` |

---

## 项目结构

```
offerPilot/
├── backend/                       # FastAPI 后端
│   ├── .env                       # 本地环境变量（请勿提交）
│   ├── requirements.txt
│   ├── uvicorn.log                # 运行日志（开发期）
│   ├── venv/                      # 本地虚拟环境（已 ignore）
│   └── app/
│       ├── __init__.py
│       ├── main.py                # FastAPI 入口 · CORS · 启动清理任务
│       ├── config.py              # pydantic-settings 读取 .env
│       ├── database.py            # async_engine / async_session / get_db / get_redis
│       ├── models.py              # SQLAlchemy ORM（10 张表）
│       ├── schemas.py             # Pydantic 入参 / 出参 schema
│       ├── routers/
│       │   ├── auth.py            # /api/auth  登录 / 注册 / 档案 CRUD
│       │   ├── audio.py           # /api/audio  录音会话 / ASR / 报告
│       │   ├── file.py            # /api/file  上传 / 删除 / COS 桥接
│       │   └── resume.py          # /api/resume  简历分析 / 改写 / 历史
│       └── utils/
│           ├── security.py        # bcrypt 哈希 + JWT 签发与校验
│           ├── sms.py             # 腾讯云短信 SDK 封装
│           ├── email.py           # SMTP 邮件 + 模板（CID 内嵌 logo）
│           ├── asr.py             # 火山引擎 ASR Submit/Query 轮询
│           ├── llm.py             # DeepSeek Chat 调用与 JSON 鲁棒解析
│           ├── resume_parser.py   # PDF/DOCX 文本 + 结构抽取（保真）
│           ├── docx_resume_writer.py  # 原地替换 run 文字，保留样式
│           ├── pdf_to_docx.py     # PDF → DOCX（pdf2docx + PyMuPDF）
│           └── cleanup.py         # 过期文件后台清理任务
│
├── frontend/                      # Next.js 16 前端
│   ├── package.json
│   ├── next.config.ts
│   ├── tsconfig.json
│   ├── eslint.config.mjs
│   ├── postcss.config.mjs
│   ├── public/                    # 字体、Logo、背景图
│   │   ├── fonts/
│   │   ├── debugger-1.jpg / debugger-2.jpg
│   │   ├── home-hand.jpg / home-start.jpg
│   │   ├── register.jpg
│   │   └── …
│   └── src/
│       ├── app/
│       │   ├── layout.tsx         # 根布局（zh-CN · dark · AuthProvider）
│       │   ├── globals.css        # Tailwind 4 主题 + 自定义工具类
│       │   ├── page.tsx           # 落地页（Hero / 产品矩阵 / 3D 倾斜卡片）
│       │   ├── home/page.tsx      # 「职业驾驶舱」主面板
│       │   ├── register/page.tsx  # 注册流（验证码 + 三步档案）
│       │   ├── training/page.tsx  # AI 模拟面试训练
│       │   ├── memory/page.tsx    # 复盘记忆 / 历史报告
│       │   └── debugger/
│       │       ├── page.tsx       # 调试器入口
│       │       ├── record/page.tsx    # 录音上传 + 实时进度
│       │       ├── report/page.tsx    # 报告详情（IPI / Offer 概率 / 风险）
│       │       ├── resume/page.tsx    # 简历上传 + 改写后下载
│       │       └── voice/page.tsx     # 模拟面试对话
│       └── components/
│           └── AuthProvider.tsx   # 全局认证 Context + 弹窗 + Toast
│
├── docs/
│   └── nanobanana-ppt/            # 设计 / 运营资料
│
├── .claude.md                     # 智能体协作说明（WebSearch 触发条件）
├── .gitignore
└── README.md                      # ← 本文件
```

---

## 快速开始

### 环境要求

| 工具 | 版本 |
| --- | --- |
| Node.js | ≥ 20 |
| npm / pnpm / yarn | 任一 |
| Python | ≥ 3.10 |
| PostgreSQL | ≥ 14（已建库 `offerpilot`） |
| Redis | ≥ 6 |

### 启动后端

```bash
cd backend

# 1) 创建并激活虚拟环境
python -m venv venv
# Windows (Git Bash)
source venv/Scripts/activate
# macOS / Linux
# source venv/bin/activate

# 2) 安装依赖
pip install -r requirements.txt

# 3) 准备 .env（如已存在请跳过）
cat > .env <<'ENV'
DATABASE_URL=postgresql+asyncpg://offerpilot:offerpilot123@localhost:5432/offerpilot
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=super-secret-key-change-me-in-production
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# 腾讯云（按需配置；缺省将回退到日志模拟）
TENCENT_SECRET_ID=
TENCENT_SECRET_KEY=
TENCENT_SMS_APP_ID=
TENCENT_SMS_SIGN_NAME=
TENCENT_SMS_TEMPLATE_ID=

# SMTP（按需配置；缺省将回退到日志模拟）
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASSWORD=
SMTP_SENDER=
SMTP_USE_SSL=True

# 大模型 & ASR
# 文本生成 LLM（DeepSeek，OpenAI-compatible）
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-v4-flash

# 求职顾问 RAG 的 Embedding 链路（仍走 MiniMax embo-01，独立配置）
MINIMAX_API_KEY=sk-cp-...
MINIMAX_GROUP_ID=
MINIMAX_EMBEDDING_URL=https://api.minimax.chat/v1/embeddings

VOLC_ASR_API_KEY=
VOLC_ASR_RESOURCE_ID=volc.seedasr.auc

# 文件保留策略（天）
FILE_RETENTION_DAYS_FREE=7
FILE_RETENTION_DAYS_PRO=30
FILE_RETENTION_DAYS_MAX=120
FILE_CLEANUP_INTERVAL_HOURS=24
ENV

# 4) 启动 PostgreSQL & Redis（确保已运行）
# 5) 启动 FastAPI
python -m app.main
# 监听 http://localhost:8001
# Swagger UI: http://localhost:8001/docs
```

启动事件会自动：

1. `Base.metadata.create_all` 创建所有 ORM 表（开发期便利，生产请改 Alembic）。
2. 启动后台协程 `run_periodic_cleanup()`，按 `FILE_CLEANUP_INTERVAL_HOURS` 周期清理过期文件。

### 启动前端

```bash
cd frontend
npm install
npm run dev
# 打开 http://localhost:3000
```

前端通过 `http://localhost:8001` 直连后端（CORS 已放行 `localhost:3000` 与 `127.0.0.1:3000`）。生产环境建议改为 `NEXT_PUBLIC_API_BASE` 之类的环境变量并通过 `next.config.ts` 重写。

> ⚠️ **开发期 401 处理**：`AuthProvider` 在检测到 `GET /api/auth/me` 返回 401 时会主动清理 `localStorage` 中的 `interviewVar_token`，并广播 `storage` 事件通知其他标签页同步登出。

---

## 后端（backend/）详解

### 技术栈与依赖

来自 `backend/requirements.txt`：

| 类别 | 包 |
| --- | --- |
| Web | `fastapi` · `uvicorn[standard]` |
| ORM | `sqlalchemy>=2.0.0` · `asyncpg` |
| 缓存 | `redis` |
| 鉴权 | `pyjwt` · `bcrypt` |
| 腾讯云 | `tencentcloud-sdk-python`（短信）· `cos-python-sdk-v5`（对象存储） |
| 数据 | `pydantic>=2.0.0` · `pydantic-settings` · `python-dotenv` · `python-multipart` |
| 文档 | `python-docx>=1.0` · `pdf2docx>=0.5` |

### 目录与模块划分

- **`app/main.py`** — FastAPI 应用对象、CORS、所有 router 挂载、启动 / 关闭事件、请求日志中间件（`log_requests`）。
- **`app/config.py`** — `pydantic_settings.BaseSettings` 读取 `.env`，暴露全局 `settings`。
- **`app/database.py`** — 异步引擎 `create_async_engine`、会话工厂 `async_sessionmaker`、依赖注入 `get_db()` / `get_redis()`。
- **`app/models.py`** — 10 张表的 ORM 模型（详见下一节）。
- **`app/schemas.py`** — Pydantic v2 入参 / 出参模型，统一前后端契约。
- **`app/routers/`** — 4 个业务路由：
  - `auth.py` — 注册 / 登录 / 验证码 / 档案 CRUD。
  - `audio.py` — 面试会话、ASR、报告、问答 / 风险 / 优化话术。
  - `file.py` — 通用文件上传（COS 桥接）、删除、预签名下载。
  - `resume.py` — 简历分析、改写 DOCX 下载、历史列表。
- **`app/utils/`** — 业务能力原语（详见模块说明）。

### 数据模型（ORM）

`app/models.py` 关键表（全部带 `created_at` / `updated_at` 时间戳）：

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `users` | `username` (unique) · `password_hash` · `phone` · `email` · `is_online` · `membership` (NULL/`pro`/``max`) | 账户主体；删除时级联清理所有关联 |
| `user_profiles` | `gender` · `age` · `job_status` · `avatar_url` · `experience_years/months` · `company_name` · `role_name` · `salary_min/max` · `school` · `degree` · `has_experience` · `target_cities[]` · `target_company` · `target_role` · `target_grade` · `target_salary_min/max` | 1:1 用户画像（注册时一次性创建） |
| `interview_sessions` | `user_id` · `title` · `audio_url` · `duration` · `file_size` · `status` (`uploaded`/`processing`/`completed`/`failed`) · `ipi_score` · `offer_probability` · `summary_strengths[]` · `summary_weaknesses[]` · `summary_suggestions[]` · `executive_summary` | 一次录音分析的总览 |
| `analysis_tasks` | `session_id` · `task_type` (`asr`/`parsing`/`risk`/`final_report`) · `progress` (0-100) · `status` · `error_message` · `started_at` · `finished_at` | 子任务进度追踪 |
| `interview_transcripts` | `session_id` (PK) · `data` (JSONB) | **整段会话一条记录**，数组元素为 `{start_time, end_time, speaker, content, highlights?}` |
| `transcript_sections` | `session_id` · `section_index` · `title` (2-6 字) · `category` (`self_intro`/`project`/`tech`/`system_design`/`behavioral`/`other`) · `tag` (`良好`/`一般`/`风险`) · `start_time` · `end_time` · `summary` · `advantages[]` · `shortcomings[]` · `review_points[]` · `optimization_advice` | 语义分段小评 |
| `interview_questions` | `session_id` · `category` · `difficulty` (`easy/medium/hard`) · `question` · `answer` | QA 抽取 |
| `interview_risks` | `session_id` · `risk_type` · `severity` (`high/medium/low`) · `title` · `evidence` · `suggestion` · `occurrence_time` | 风险点 |
| `answer_improvements` | `session_id` · `question_id?` · `original_answer` · `optimized_answer` | STAR 优化话术 |
| `files`（`uploaded_files`） | `user_id?` · `filename` · `cos_key` · `file_url` · `file_size` · `file_type` (`audio`/`resume`) | 通用文件表 |
| `resume_analyses` | `user_id?` · `file_id` · `score` · `optimized_score` · `ats_pass_rate` · `result_json` (JSONB) | 简历分析历史；`result_json` 存 LLM 完整输出 |

### REST API 一览

> BaseURL：`http://localhost:8001`
> 所有受保护接口在 Header 中携带 `Authorization: Bearer <token>`。

#### `/api/auth`（`routers/auth.py`）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/send-code` | 公开 | 发送 6 位验证码（短信 / 邮件），1 分钟限流，5 分钟有效 |
| POST | `/register/step1` | 公开 | 校验用户名 / 手机 / 邮箱唯一性 + 验证码，返回可继续第二步 |
| POST | `/register/complete` | 公开 | 完成三步注册（账户 + 画像 + 求职期望），返回 JWT |
| POST | `/login` | 公开 | 密码 / 验证码双模式登录 |
| POST | `/logout` | Bearer | 当前 token 加入 Redis 黑名单（24h） |
| POST | `/reset-password` | 公开 | 验证码 + 新密码重置 |
| PUT | `/security/update` | Bearer | 修改绑定手机 / 邮箱 / 密码 |
| DELETE | `/delete-account` | Bearer | 注销账号（级联删除所有数据） |
| GET | `/me` | Bearer | 获取当前用户档案 |
| PUT | `/profile/update` | Bearer | 更新用户档案 / 期望字段 |

#### `/api/file`（`routers/file.py`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/upload` | multipart：上传音频（≤ 20MB · mp3/wav）或简历（≤ 5MB · pdf/docx），返回 `file_id` / `file_url`（预签名 1h） |
| DELETE | `/delete` | query `file_id` 删除（COS + DB） |
| POST | `/delete` | body `{file_id}` 形式删除 |

#### `/api/audio`（`routers/audio.py`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/check_limit` | 免费用户是否还有 1 次体验机会 |
| POST | `/create_session` | 基于已上传 COS URL 创建一个面试会话（不再二次上传） |
| POST | `/start_analysis` | 启动后台分析：ASR → DeepSeek 推理 → 写库 |
| GET | `/task_progress/{task_id}` | 轮询任务进度（in-memory `task_store`） |
| GET | `/session/{session_id}/report` | 取报告汇总 |
| GET | `/session/{session_id}/transcript` | 取转写（含 highlights） |
| GET | `/session/{session_id}/sections` | 取语义分段 |
| GET | `/session/{session_id}/questions` | 取问题清单 |
| GET | `/session/{session_id}/risks` | 取风险点 |
| GET | `/session/{session_id}/improvements` | 取 STAR 优化话术 |
| GET | `/sessions` | 当前用户历史会话列表 |
| DELETE | `/session/{session_id}` | 删除会话 |

#### `/api/resume`（`routers/resume.py`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/analyze` | body `{file_id}`：解析 + LLM 诊断 + 落库 `resume_analyses` |
| GET | `/analyses` | 当前用户历史概要列表 |
| GET | `/analyses/{id}` | 取单次完整分析 JSON |
| GET | `/analyses/{id}/download` | 下载 **保留原样式** 的改写 DOCX（PDF 源先转 DOCX，bullet 匹配 < 80% 抛 500） |
| DELETE | `/analyses/{id}` | 删除分析记录 |

### 核心业务流程

#### 1. 注册 → 画像 → 求职期望（三步注册）

```
[Step 1] POST /api/auth/register/step1
  → 校验 username / phone / email 唯一性 + 验证码
[Step 2] 前端在 /register 收集 profile（性别 / 年龄 / 经验 / 公司 / 岗位 / 学历 / 薪资）
[Step 3] POST /api/auth/register/complete
  → 一次性写入 users + user_profiles
  → 发 JWT (24h)
  → 返回 UserProfileResponse
```

#### 2. 面试录音分析（最重链路）

```
[Frontend] /debugger/record
   │  1) POST /api/file/upload (multipart)  →  COS 上传 + presigned URL
   │  2) POST /api/audio/check_limit        →  免费用户配额校验
   │  3) POST /api/audio/create_session     →  DB 记录 session (status=uploaded)
   │  4) POST /api/audio/start_analysis     →  后台协程 run_real_analysis()
   │     │
   │     ├─ ASR (utils/asr.py)
   │     │   submit → 轮询 query → {start_time, end_time, speaker, content}[]
   │     │
   │     ├─ LLM (utils/llm.py)
   │     │   generate_transcript_highlights()  → 句子级高亮
   │     │   sectionize_transcript()           → 语义分段
   │     │   analyze_interview_dialogue()      → IPI / Offer 概率 / 优劣势
   │     │
   │     └─ 落库
   │         - interview_transcripts (JSONB)
   │         - transcript_sections
   │         - interview_questions / risks / improvements
   │         - interview_sessions (汇总字段)
   │
   │  5) GET /api/audio/task_progress/{task_id} 轮询
   │  6) GET /api/audio/session/{id}/report       →  /debugger/report
```

#### 3. 简历分析 + 改写

```
[Frontend] /debugger/resume
   │  1) POST /api/file/upload (file_type=resume)
   │  2) POST /api/resume/analyze {file_id}
   │     ├─ extract_resume_text()               PDF / DOCX → 纯文本
   │     ├─ parse_resume_structure()            规则化（保真）抽取
   │     ├─ analyze_resume_text()               DeepSeek 综合评分
   │     ├─ 用画像薪资覆盖 LLM 提取值
   │     └─ 落库 resume_analyses
   │
   │  3) GET /api/resume/analyses               历史概要
   │  4) GET /api/resume/analyses/{id}          详情
   │  5) GET /api/resume/analyses/{id}/download DOCX 改写版
   │     ├─ PDF 源：convert_pdf_to_docx()（pdf2docx 线程池）
   │     └─ rewrite_resume_docx() 就地替换 run 文字
```

#### 4. 文件生命周期

`app/utils/cleanup.py` 每 24h 执行一次，按以下规则判定过期：

- 访客文件（`user_id IS NULL`）→ **立即删除**。
- 用户不在线（`is_online = False`）→ **立即删除**。
- 在线用户：按 `membership` 取对应保留天数（Free 7 / Pro 30 / Max 120）。

删除走 `delete_file_from_storage` — 先 `client.delete_object(COS)` 再 `db.delete(file)`；COS 失败也继续清库，避免孤儿。

### 配置项（.env）

| Key | 默认 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@localhost:5432/offerpilot` | 异步 PG 连接串 |
| `REDIS_URL` | `redis://localhost:6379/0` | 验证码 / 限流 / 黑名单 |
| `JWT_SECRET` | `super-secret-key-change-me` | **生产必须修改** |
| `JWT_ALGORITHM` | `HS256` | |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | 24h |
| `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` | — | 短信 / COS 共用 |
| `TENCENT_SMS_APP_ID` / `_SIGN_NAME` / `_TEMPLATE_ID` | — | 缺省时回退日志模拟 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_SENDER` / `SMTP_USE_SSL` | — | 缺省时回退日志模拟 |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | `https://api.deepseek.com/v1` / `deepseek-v4-flash` | 文本生成 LLM（DeepSeek，OpenAI-compatible） |
| `MINIMAX_API_KEY` / `MINIMAX_EMBEDDING_URL` / `MINIMAX_GROUP_ID` | `https://api.minimax.chat/v1/embeddings` | AI 职业顾问 RAG 的 Embedding（embo-01，独立链路） |
| `VOLC_ASR_API_KEY` / `VOLC_ASR_RESOURCE_ID` | `volc.seedasr.auc` | 火山引擎大模型 ASR |
| `FILE_RETENTION_DAYS_FREE` / `_PRO` / `_MAX` | `7` / `30` / `120` | 文件保留 |
| `FILE_CLEANUP_INTERVAL_HOURS` | `24` | 清理周期 |

### 会员等级与文件保留策略

| 等级 | 字段值 | 文件保留 |
| --- | --- | --- |
| 免费（未登录或未付费） | `membership IS NULL` | 7 天 |
| Pro | `"pro"` | 30 天 |
| Max | `"max"` | 120 天 |

> 免费用户额外限制：**只能创建 1 个面试会话**。`/api/audio/check_limit` 与 `/api/audio/create_session` 都会校验。

---

## 前端（frontend/）详解

### 技术栈与依赖

来自 `frontend/package.json`：

| 类别 | 包 |
| --- | --- |
| 框架 | `next@16.2.6` · `react@19.2.4` · `react-dom@19.2.4` |
| 动效 | `framer-motion@^12.4.0` · `gsap@^3.15.0` |
| 工具链 | `typescript@^5` · `eslint@^9` · `eslint-config-next@16.2.6` · `tailwindcss@^4` · `@tailwindcss/postcss@^4` |
| 类型 | `@types/node` · `@types/react@^19` · `@types/react-dom@^19` |

### 目录与路由

`frontend/src/app/` 使用 Next.js **App Router**：

| 路由 | 文件 | 角色 |
| --- | --- | --- |
| `/` | `page.tsx` | 落地页：Hero / 三大产品卡片 / 3D 倾斜卡 / 用户证言 / 行动召唤 |
| `/home` | `home/page.tsx` | 「职业驾驶舱」主面板：档案、目标、历史报告、订阅管理 |
| `/register` | `register/page.tsx` | 注册流：验证码 → 档案 → 求职期望，并展示用户协议 / 隐私政策 |
| `/training` | `training/page.tsx` | AI 模拟面试训练 |
| `/memory` | `memory/page.tsx` | 复盘记忆：跨会话聚合、时间线、关键词回溯 |
| `/debugger` | `debugger/page.tsx` | 调试器入口（4 个子模块导航） |
| `/debugger/record` | `record/page.tsx` | 录音上传 + 实时分析进度 |
| `/debugger/report` | `report/page.tsx` | 报告详情：IPI / Offer 概率 / 风险 / STAR 优化 |
| `/debugger/resume` | `resume/page.tsx` | 简历上传 / 改写 / 下载 |
| `/debugger/voice` | `voice/page.tsx` | 拟真面试官对话 |

### 核心页面与组件

- **`app/layout.tsx`** — 根布局，`lang="zh-CN"`，`dark h-full antialiased`，注入 `AuthProvider`，加载本地字体 `/fonts/fonts.css`。
- **`app/globals.css`** — Tailwind 4 主题（Material 3 风格的自定义 token）+ 工具类 fallback（`max-w-container-max` · `px-gutter` · `py-section-padding` · `gap-stack-gap`）。
- **`app/page.tsx`** — 落地页：交互式 3D 倾斜卡（鼠标 spotlight 跟踪）+ IntersectionObserver 触发的 `StatCounter` + 滚动动效，CTA 全部跳到 `/debugger`。
- **`components/AuthProvider.tsx`** — 单一全局 React Context：
  - 状态：`isLoggedIn` · `user` · `showLogin/showLogout/showDelete` · `toastMsg`。
  - 行为：`login()` · `logout()` · `deleteAccount()` · `updateUser()` · `triggerToast()`。
  - 副作用：监听 `storage` 事件实现跨标签页同步；启动时用 `localStorage.interviewVar_token` 调 `GET /api/auth/me` 拉取最新档案；401 自动清空本地凭据。
  - 全局弹窗：`AuthModals` 内部组件（登录 / 退出 / 注销二次确认）+ 顶部 `AnimatePresence` Toast。

### 视觉规范

设计风格：深色太空感 + 玻璃拟态（glassmorphism）+ 微光渐变（`#c0c1ff` → `#ffb2b7`）。

| 角色 | Token / 值 |
| --- | --- |
| 背景 | `--color-background: #0b1326` |
| 表面 | `--color-surface-container-low: #131b2e` / `--color-surface-container-highest: #2d3449` |
| 主色 | `--color-primary: #c0c1ff` |
| 次色 | `--color-secondary: #ffb2b7` |
| 第三色 | `--color-tertiary: #4edea3` |
| 文字 | `--color-on-surface: #dae2fd` |
| 字体（body） | Inter · `--font-body-md` |
| 字体（标题/展示） | Hanken Grotesk · `--font-headline-lg` / `--font-display-xl` |
| 字体（标签/等宽） | Geist Mono · `--font-label-mono` |

> 完整规范：[OfferPilot 视觉规范](C:\Users\47181\.claude\projects\D--ai-----offerPilot\memory\offerpilot-visual-style.md)

### AuthProvider：全局认证状态

```ts
// 关键 localStorage key
interviewVar_token       // JWT
interviewVar_isLoggedIn  // "true" | "false"
interviewVar_user        // JSON 序列化的 UserProfile
```

- 启动时若存在 `token`，自动 `GET /api/auth/me` 合并最新档案（手机 / 邮箱等本地不存的字段）。
- 401 → 主动清空凭据 + 广播 `storage` 事件 + 回退默认 `defaultUser`。
- `updateUser()` 在本地立即生效并写入 `localStorage`，随后 `PUT /api/auth/profile/update` 异步同步后端（不阻塞 UI）。
- `logout()` / `deleteAccount()` 均先走后端，再清本地。

### 与后端的接口约定

- BaseURL：**开发期硬编码**为 `http://localhost:8001`，CORS 已放行。
- 所有受保护请求：`Authorization: Bearer <token>`。
- 跨域：`credentials` 显式启用。
- 错误处理：FastAPI `HTTPException(detail=...)` 在前端通过 `res.json().detail` 弹 Toast / 表单内联错误。
- 文件上传：`multipart/form-data`，字段名 `file` + 业务字段 `file_type=audio|resume`。
- 文件下载：简历改写后端直接 `Response(content=docx_bytes, media_type=application/vnd.openxmlformats-...)` 并使用 RFC 5987 `filename*=UTF-8''...` 携带中文文件名。

---

## 前后端交互流程图

```
┌──────────────────────┐  HTTPS/JSON  ┌────────────────────────┐
│   Next.js (3000)     │ ───────────▶ │  FastAPI (8001)         │
│  ────────────────    │              │  ─────────────────────  │
│  • 落地页 (/)        │              │  • /api/auth   鉴权      │
│  • 职业驾驶舱(/home) │ ◀─────────── │  • /api/file   COS 桥接  │
│  • 注册流(/register) │              │  • /api/audio  录音分析  │
│  • 调试器(/debugger) │              │  • /api/resume 简历诊断  │
│  • 复盘(/memory)     │              │                        │
│  • 训练(/training)   │              │  ┌──────────────────┐  │
│  • AuthProvider 全局 │              │  │ PostgreSQL (ORM) │  │
│    状态 + 弹窗 + Toast│             │  └──────────────────┘  │
└──────────────────────┘              │  ┌──────────────────┐  │
         │                            │  │  Redis           │  │
         │ localStorage 同步          │  │  · 验证码        │  │
         ▼                            │  │  · 限流          │  │
   interviewVar_token                │  │  · Token 黑名单  │  │
   interviewVar_user                  │  └──────────────────┘  │
                                      │  ┌──────────────────┐  │
                                      │  │ 腾讯云 COS       │  │
                                      │  │ ap-nanjing       │  │
                                      │  └──────────────────┘  │
                                      │  ┌──────────────────┐  │
                                      │  │ 外部能力          │  │
                                      │  │ · DeepSeek        │  │
                                      │  │ · 火山引擎 ASR   │  │
                                      │  │ · 腾讯云 SMS     │  │
                                      │  │ · SMTP 邮件      │  │
                                      │  └──────────────────┘  │
                                      └────────────────────────┘
```

---

## 常见问题

**Q1. 启动时提示「Redis 连接失败」/「PG 拒绝连接」？**
- 确认本地已启动 PostgreSQL（监听 5432）和 Redis（监听 6379）。
- `DATABASE_URL` 中账密与 `postgres` 用户匹配；`psql` 手动 `CREATE DATABASE offerpilot;` 建库。

**Q2. 上传文件后报「腾讯云对象存储未配置」？**
- 在 `backend/.env` 填入 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`；COS 客户端会按需懒加载。

**Q3. ASR 一直 pending / LLM 调用超时？**
- 检查 `VOLC_ASR_API_KEY` 和 `DEEPSEEK_API_KEY` 是否有效；
- `llm.py` 已对 SSL / 连接抖动做了 4 次指数退避重试（`Retry(total=4, ...)`）；
- 长转写（>80 句）默认 120s 超时；如仍不够请在 `call_llm_sync` 调大 `timeout`。
- Embedding 失败单独排查：`MINIMAX_API_KEY` / `MINIMAX_GROUP_ID` / `MINIMAX_EMBEDDING_URL` 是否有效。

**Q4. 简历改写下载失败：`简历排版与诊断结果不匹配`？**
- 这是 `docx_resume_writer.BulletMatchError`：bullet 匹配率 < 80%。
- 解决：源简历使用「工作经历」section 标题 + 标准 `• / - / *` 缩进；扫描型 PDF 请先 OCR 后再上传。

**Q5. 验证码没收到？**
- 未配置腾讯云 SMS / SMTP 时，`utils/sms.py` / `utils/email.py` 会**回退到日志模拟**，并把验证码打印到后端控制台（`[SMS DEV SIMULATION]` / `[EMAIL DEV SIMULATION]`）。

**Q6. 注册后报「用户名已存在」但我确实没注册过？**
- 默认 `defaultUser`（"Dame Zheng"）在前端 `localStorage.interviewVar_user` 中预置；如果直接清理 `localStorage` 后访问受保护页面，`AuthProvider` 也会用占位数据，需要通过后端真实登录替换。

**Q7. 数据库表结构变更怎么办？**
- 当前 `main.py` 的 `Base.metadata.create_all` 仅在开发期便利，不会执行 `ALTER`。
- 生产建议改用 Alembic 管理 schema migration。

---

## Roadmap

- [ ] 接入 Stripe / 微信支付打通 Pro / Max 会员开通
- [ ] 引入 LangGraph 把"ASR → 分段 → 评分 → 风险 → STAR 改写"串成可观测 pipeline
- [ ] 视频面试支持（多模态表情 / 语气分析）
- [ ] Offer 概率模型的校准数据集（公开题库 + 用户反馈闭环）
- [ ] WebSocket 流式输出报告（目前为轮询 `task_progress`）
- [ ] OpenAPI 客户端代码自动生成到 `frontend/src/lib/api.ts`
- [ ] i18n（英文版）支持

---

## License

本仓库目前为 **Private / All Rights Reserved**。
如需对外发布 / 二次分发，请先与作者联系并补充合适的开源协议。

---

###TASK_COMPLETED###
