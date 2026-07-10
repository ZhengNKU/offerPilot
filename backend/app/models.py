from datetime import datetime
from typing import List, Optional
from sqlalchemy import ForeignKey, String, Integer, Boolean, DateTime, func, ARRAY, Float, BigInteger, UniqueConstraint, Index, text, Text, desc
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector
from app.database import Base

class User(Base):
    __tablename__ = "users"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(20), unique=True, nullable=True, index=True)
    email: Mapped[Optional[str]] = mapped_column(String(100), unique=True, nullable=True, index=True)
    is_online: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # 会员等级: NULL=免费, "pro", "max"。决定文件保留时长。
    membership: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    profile: Mapped["UserProfile"] = relationship("UserProfile", back_populates="user", cascade="all, delete-orphan", uselist=False)
    sessions: Mapped[List["InterviewSession"]] = relationship("InterviewSession", back_populates="user", cascade="all, delete-orphan")
    files: Mapped[List["UploadedFile"]] = relationship("UploadedFile", back_populates="user", cascade="all, delete-orphan")

class UserProfile(Base):
    __tablename__ = "user_profiles"
    
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    
    # Personal attributes (Step 2)
    gender: Mapped[str] = mapped_column(String(10), default="other")
    age: Mapped[int] = mapped_column(Integer, nullable=False)
    job_status: Mapped[str] = mapped_column(String(20), default="active")
    avatar_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    
    # Professional background (Step 2)
    experience_years: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    experience_months: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    company_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    role_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    salary_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    salary_max: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    school: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    degree: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    has_experience: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # Career expectations (Step 3)
    target_cities: Mapped[List[str]] = mapped_column(ARRAY(String), nullable=False)
    target_company: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    target_role: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    target_grade: Mapped[Optional[str]] = mapped_column(String(50), default="高级", nullable=True)
    target_salary_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    target_salary_max: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # 求职目标匹配度（30-97，由 match_scorer 算法计算）
    match_rate: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, default=None)

    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    user: Mapped["User"] = relationship("User", back_populates="profile")


class InterviewSession(Base):
    __tablename__ = "interview_sessions"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    audio_url: Mapped[str] = mapped_column(String, nullable=False)
    duration: Mapped[int] = mapped_column(Integer, default=0)
    file_size: Mapped[int] = mapped_column(BigInteger, default=0)
    status: Mapped[str] = mapped_column(String(50), default="uploaded") # uploaded, processing, completed, failed
    job_description: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # ── 面试元数据（用户在 debugger / debugger/record 表单上填的）
    # 公司 / 岗位 / 轮次 / 面试日期 / 级别 / 薪资
    # 老数据没有这些列，回退到 title 字符串拼接；详见 routers/memory.py
    company: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    role: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    round: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    date: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    grade: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    salary: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Aggregated report score fields
    ipi_score: Mapped[int] = mapped_column(Integer, default=0)
    offer_probability: Mapped[int] = mapped_column(Integer, default=0)
    summary_strengths: Mapped[List[str]] = mapped_column(ARRAY(String), default=list)
    summary_weaknesses: Mapped[List[str]] = mapped_column(ARRAY(String), default=list)
    summary_suggestions: Mapped[List[str]] = mapped_column(ARRAY(String), default=list)
    executive_summary: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    
    analysis_result: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    user: Mapped[Optional["User"]] = relationship("User", back_populates="sessions")
    tasks: Mapped[List["AnalysisTask"]] = relationship("AnalysisTask", back_populates="session", cascade="all, delete-orphan")
    transcript: Mapped[Optional["InterviewTranscript"]] = relationship("InterviewTranscript", back_populates="session", cascade="all, delete-orphan", uselist=False)
    sections: Mapped[List["TranscriptSection"]] = relationship("TranscriptSection", back_populates="session", cascade="all, delete-orphan")
    questions: Mapped[List["InterviewQuestion"]] = relationship("InterviewQuestion", back_populates="session", cascade="all, delete-orphan")
    risks: Mapped[List["InterviewRisk"]] = relationship("InterviewRisk", back_populates="session", cascade="all, delete-orphan")
    improvements: Mapped[List["AnswerImprovement"]] = relationship("AnswerImprovement", back_populates="session", cascade="all, delete-orphan")


class AnalysisTask(Base):
    __tablename__ = "analysis_tasks"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False)
    task_type: Mapped[str] = mapped_column(String(50), nullable=False) # asr, parsing, risk, final_report
    progress: Mapped[int] = mapped_column(Integer, default=0) # 0-100
    status: Mapped[str] = mapped_column(String(50), default="pending") # pending, running, completed, failed
    error_message: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    session: Mapped["InterviewSession"] = relationship("InterviewSession", back_populates="tasks")


class InterviewTranscript(Base):
    """
    整个 session 的转写结果。ASR 完成后一次性写入，
    data 是 JSONB 数组，每个元素是一句：{start_time, end_time, speaker, content}。
    不再一行一句（避免数据爆炸），也不再依赖不可靠的 speaker 拆分作为结构化列。
    """
    __tablename__ = "interview_transcripts"

    session_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("interview_sessions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    data: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    session: Mapped["InterviewSession"] = relationship("InterviewSession", back_populates="transcript")


class TranscriptSection(Base):
    """
    语义分段（话题块）。一段对应面试中的一个主题（如「自我介绍」「Redis 追问」）。
    由 LLM 在 ASR 完成后对 InterviewTranscript.data 做聚类后写入。
    与 transcript 的关联在运行时通过 start_time/end_time 范围匹配（不在 DB 里建外键）。
    """
    __tablename__ = "transcript_sections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 0-based 排序，供前端时间线显示顺序
    section_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # 2-6 字中文标题（LLM 生成）
    title: Mapped[str] = mapped_column(String(64), nullable=False)
    # 话题标签：self_intro / project / tech / system_design / behavioral / other
    category: Mapped[str] = mapped_column(String(32), default="other", nullable=False)
    # 评价标签：良好 / 一般 / 风险
    tag: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)
    # LLM 生成的片段小评
    summary: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    advantages: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)
    shortcomings: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)
    review_points: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)
    optimization_advice: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    session: Mapped["InterviewSession"] = relationship("InterviewSession", back_populates="sections")


class InterviewQuestion(Base):
    __tablename__ = "interview_questions"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False)
    category: Mapped[str] = mapped_column(String(50), nullable=False) # self_intro, project, redis, mysql, behavioral, system_design
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False) # easy, medium, hard
    question: Mapped[str] = mapped_column(String, nullable=False)
    answer: Mapped[str] = mapped_column(String, nullable=False)
    
    session: Mapped["InterviewSession"] = relationship("InterviewSession", back_populates="questions")
    improvements: Mapped[List["AnswerImprovement"]] = relationship("AnswerImprovement", back_populates="question", cascade="all, delete-orphan")


class InterviewRisk(Base):
    __tablename__ = "interview_risks"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False)
    risk_type: Mapped[str] = mapped_column(String(50), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False) # high, medium, low
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    evidence: Mapped[str] = mapped_column(String, nullable=False)
    suggestion: Mapped[str] = mapped_column(String, nullable=False)
    occurrence_time: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    session: Mapped["InterviewSession"] = relationship("InterviewSession", back_populates="risks")


class AnswerImprovement(Base):
    __tablename__ = "answer_improvements"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False)
    question_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("interview_questions.id", ondelete="SET NULL"), nullable=True)
    original_answer: Mapped[str] = mapped_column(String, nullable=False)
    optimized_answer: Mapped[str] = mapped_column(String, nullable=False)
    
    session: Mapped["InterviewSession"] = relationship("InterviewSession", back_populates="improvements")
    question: Mapped[Optional["InterviewQuestion"]] = relationship("InterviewQuestion", back_populates="improvements")


class UploadedFile(Base):
    __tablename__ = "files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    cos_key: Mapped[str] = mapped_column(String, nullable=False)
    file_url: Mapped[str] = mapped_column(String, nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, default=0)
    file_type: Mapped[str] = mapped_column(String(50), nullable=False) # audio, resume

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    user: Mapped[Optional["User"]] = relationship("User", back_populates="files")
    resume_analyses: Mapped[List["ResumeAnalysis"]] = relationship(
        "ResumeAnalysis", back_populates="file", cascade="all, delete-orphan"
    )


class ResumeAnalysis(Base):
    """
    一次简历诊断任务的完整结果。
    result_json 是 LLM 完整输出（score/profile/work_experiences/risks/match_analysis
    /optimization_suggestions/keywords_analysis/ats_checks 等），
    冗余提取 score/optimized_score/ats_pass_rate 三个高频摘要字段方便列表展示。
    """
    __tablename__ = "resume_analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    file_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("files.id", ondelete="CASCADE"), nullable=False, index=True
    )
    score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    optimized_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    ats_pass_rate: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    result_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    user: Mapped[Optional["User"]] = relationship("User")
    file: Mapped["UploadedFile"] = relationship("UploadedFile", back_populates="resume_analyses")


class ProjectMemory(Base):
    """
    项目记忆库：从简历中由 AI 提取并持久化的项目经历。
    同一用户下项目名唯一（唯一约束）；重复上传简历时触发 version 累进更新。
    source_type: 'resume_analysis' | 'manual' | 'interview_extract'
    """
    __tablename__ = "project_memories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_name: Mapped[str] = mapped_column(String(128), nullable=False)
    summary: Mapped[str] = mapped_column(String, nullable=False)  # TEXT column
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    sub_tags: Mapped[list] = mapped_column(JSONB, default=list)
    tech_stack: Mapped[list] = mapped_column(JSONB, default=list)
    metrics: Mapped[dict] = mapped_column(JSONB, default=dict)
    role: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    team_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    duration: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    mastery_level: Mapped[int] = mapped_column(Integer, default=50)
    mention_count: Mapped[int] = mapped_column(Integer, default=0)
    last_mentioned_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True, comment="最近一次在面试中被提及的时间"
    )
    last_mentioned_session_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("interview_sessions.id", ondelete="SET NULL"),
        nullable=True,
        comment="最近一次提及来源的面试会话ID",
    )
    last_mentioned_summary: Mapped[Optional[str]] = mapped_column(
        String(128), nullable=True, comment="最近提及摘要，格式: 2026/06/21·中兴通讯后端开发工程师面试"
    )
    importance: Mapped[int] = mapped_column(Integer, default=50)
    source_type: Mapped[str] = mapped_column(String(20), default="resume_analysis")
    source_resume_analysis_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("resume_analyses.id", ondelete="SET NULL"), nullable=True
    )
    source_file_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("files.id", ondelete="SET NULL"), nullable=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    last_updated_by: Mapped[str] = mapped_column(String(20), default="ai")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "project_name", name="uq_user_project"),
    )


class ProjectTag(Base):
    """
    项目标签字典表：预置主分类标签（AI工程/数据工程/...）和辅助标签（核心项目/大流量/...）。
    前端标签选择器和一致性管理的数据源。
    """
    __tablename__ = "project_tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tag_name: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    tag_key: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    tag_type: Mapped[str] = mapped_column(String(16), default="category")  # 'category' | 'sub' | 'domain'
    color_class: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class InterviewLiveSession(Base):
    """
    实时语音面试会话（v1.2 设计）。
    与 InterviewSession 是 1:1 关系（PR4 创建归档 session 后回填 session_id）。
    interview_type + difficulty 决定 16 套人格/音色组合。
    status 状态机：created → ws_connecting → live → ending → ended → analyzing → completed | failed
    限流：partial unique index on user_id WHERE status IN active states。
    """
    __tablename__ = "interview_live_sessions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # PR4 创建 InterviewSession 后回填；PR1 阶段为 NULL
    session_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("interview_sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # 4 选 1 面试类型
    interview_type: Mapped[str] = mapped_column(String(32), nullable=False)
    # 4 选 1 难度（Lv1..Lv4；语义为「压力面占比」）
    difficulty: Mapped[str] = mapped_column(String(8), nullable=False)
    # 10 / 15 / 20 分钟
    duration_min: Mapped[int] = mapped_column(Integer, nullable=False)
    # 1..3 追问轮数
    followup_rounds: Mapped[int] = mapped_column(Integer, nullable=False)
    # 状态机字符串
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="created")
    # 实时统计（边讲边更新，PR2 起由 bridge 写入）
    duration_sec: Mapped[int] = mapped_column(Integer, default=0)
    # 候选人基础信息（便于报告页展示）
    target_role: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    job_level: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    company_style: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    job_description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # 选中的 voice_id 与 persona（PR3 写入）
    voice_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    persona_cn: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    
    # 评测报告数据
    ipi_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    offer_probability: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    summary_strengths: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)
    summary_weaknesses: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)
    summary_suggestions: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)
    executive_summary: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    analysis_result: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    transcript: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)
    # PR-N: 候选人在面试过程中提交的反馈（type: tech_question/voice/ux/other + content + ts）
    feedback: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)
    
    # 时间戳
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        # 限流：同用户同时只能有 1 个 active live session
        Index(
            "uq_live_active",
            "user_id",
            unique=True,
            postgresql_where=text(
                "status IN ('created','ws_connecting','live','ending') AND user_id IS NOT NULL"
            ),
        ),
    )

    # 关联：归档的 InterviewSession（PR4 回填后可用）
    session: Mapped[Optional["InterviewSession"]] = relationship("InterviewSession")


class UserLiveMinutes(Base):
    """
    PR6 定价：用实时面试总时长（按周/月聚合）做限额。
    - period_type: 'week' (ISO 周，如 '2026-W25') 或 'month' (如 '2026-06')
    - (user_id, period_type, period_key) 唯一约束
    - 每次 end 端点归档后 upsert 一行
    - Free 用户：0 分钟 / PRO：60 分钟 /月 / MAX：不限
    """
    __tablename__ = "user_live_minutes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    period_type: Mapped[str] = mapped_column(String(8), nullable=False)  # 'week' | 'month'
    period_key: Mapped[str] = mapped_column(String(16), nullable=False)  # '2026-W25' | '2026-06'
    total_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sessions_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("user_id", "period_type", "period_key", name="uq_user_live_minutes"),
    )


# ============================================================================
# AI 职业顾问（counselor）相关表
# ============================================================================

# Source type 枚举值（用于 user_analysis_embeddings.source_type 与 counselor_messages.citations）
COUNSELOR_SOURCE_TYPES = (
    "interview_summary",     # interview_sessions.analysis_result 切分后的面试总结
    "interview_section",     # transcript_sections 单个语义段
    "resume_analysis",       # resume_analyses.result_json 切分后的简历分析
    "project_memory",        # project_memories 单个项目
    "live_interview",        # interview_live_sessions.analysis_result 实时面试报告
)


class UserAnalysisEmbedding(Base):
    """
    用户历史分析片段的向量库（AI 职业顾问 RAG 召回用）。

    每条记录 = 一个语义完整的分析片段 + 它的 1536 维 embedding。
    source_type + source_id + chunk_index 唯一定位来源，支持后续溯源 / 删除 / 幂等 upsert。

    关键约束：
      - vector(1536) 使用 MiniMax embo-01 输出维度
      - HNSW 索引用 vector_cosine_ops（MiniMax 向量未归一化，必须用 cosine 距离）
      - 写入用 type=db，查询用 type=query（embo-01 非对称嵌入）
    """
    __tablename__ = "user_analysis_embeddings"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 来源类型：见 COUNSELOR_SOURCE_TYPES
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    # 来源 ID（如 interview_sessions.id / resume_analyses.id / project_memories.id）
    source_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # 片段在来源中的索引（一份分析可能切成多段，从 0 开始）
    chunk_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 片段标题（用于前端显示「引用自：xxx」）
    chunk_title: Mapped[str] = mapped_column(String(128), nullable=False)
    # 实际文本（喂给 embedding 的内容 + 给 LLM 看的引用原文）
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 元数据 JSONB（公司 / 时间 / 评分 / 分类等，召回时可作为过滤条件）
    meta: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    # 1536 维向量（MiniMax embo-01 输出维度）
    embedding = mapped_column(Vector(1536), nullable=False)
    # 写入时间
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        # 幂等 upsert 的关键约束
        UniqueConstraint("source_type", "source_id", "chunk_index", name="uq_source_chunk"),
        # HNSW 索引：单列（pgvector HNSW 不支持多列索引）
        # m=16, ef_construction=64 适合中小规模（单用户 <1k 向量，总量 <10w）
        # ops class 必须用 vector_cosine_ops，因为 MiniMax 向量未做 L2 归一化
        Index(
            "ix_user_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        # 按 (source_type, source_id) 查询所有 chunk 时用（如删除某场面试时）
        Index("ix_user_emb_source", "source_type", "source_id"),
    )
    # user_id 上的 btree 索引由 ForeignKey 自动创建（ix_user_analysis_embeddings_user_id）


class CounselorSession(Base):
    """
    AI 职业顾问的对话会话。

    summary / summary_upto_msg_id 字段用于长会话压缩：
    当 message_count > 阈值（如 10 轮）时，触发一次 LLM 总结前 N 轮对话，
    后续请求把 summary + 最近 K 轮原 message 作为上下文。
    """
    __tablename__ = "counselor_sessions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 首问自动生成的标题（用 LLM 抽取 6-12 字）
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    # 压缩后的历史摘要
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # summary 覆盖到的最后一条消息 id（summary 之后的消息以原始 messages 形式存在）
    summary_upto_msg_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True, comment="summary 覆盖到的最后一条消息 id"
    )
    # 消息总数（用于触发 summary 压缩的判断）
    message_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 会话状态：active (刚创建) → streaming (LLM 生成中) → completed / stopped / failed
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="active",
        comment="active, streaming, stopped, completed, failed",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    messages: Mapped[List["CounselorMessage"]] = relationship(
        "CounselorMessage", back_populates="session",
        cascade="all, delete-orphan", order_by="CounselorMessage.id",
    )


class CounselorMessage(Base):
    """
    顾问会话中的单条消息（一轮对话）。

    content: JSON 数组，包含 [{role, content}, ...]，一条记录存储一轮完整对话
    citations: LLM 输出中提到的 [cite:TYPE#ID#CHUNK] 标记解析后存入此处
    """
    __tablename__ = "counselor_messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("counselor_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 引用：[{source_type, source_id, chunk_index, chunk_title, snippet}, ...]
    citations: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    # 召回的 chunk 列表（context 注入的来源），用于前端调试面板展示
    recalled_chunks: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    # 流式是否完整结束（False = 异常中断，可用于排查）
    stream_completed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    session: Mapped["CounselorSession"] = relationship(
        "CounselorSession", back_populates="messages"
    )


class UserAdvisorInsight(Base):
    """
    用户AI顾问意见缓存表（总览面板四栏建议）。
    """
    __tablename__ = "user_advisor_insights"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    
    # 结构化存储 4 个维度的建议: {focus_areas: [], interview_trends: [], recommended_actions: [], career_suggestions: [], is_customized: bool}
    insights: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class KnowledgeCoreAbility(Base):
    """知识库 — 核心能力板块（每用户 4 个）"""
    __tablename__ = "knowledge_core_abilities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(32), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    generated_from_role: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    generated_from_years: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    generated_from_grade: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    sub_abilities: Mapped[List["KnowledgeSubAbility"]] = relationship(
        "KnowledgeSubAbility", back_populates="core_ability",
        cascade="all, delete-orphan", order_by="KnowledgeSubAbility.sort_order"
    )


class KnowledgeSubAbility(Base):
    """知识库 — 细化能力子卡片（每核心能力 5 个，每用户共 20 个）"""
    __tablename__ = "knowledge_sub_abilities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    core_ability_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("knowledge_core_abilities.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(32), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    question_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    core_ability: Mapped["KnowledgeCoreAbility"] = relationship(
        "KnowledgeCoreAbility", back_populates="sub_abilities"
    )

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_user_sub_ability_name"),
    )


class Feedback(Base):
    """用户提交的体验反馈列表"""
    __tablename__ = "feedbacks"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    author_name: Mapped[str] = mapped_column(String(50), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False) # 问题反馈, 功能建议, 体验优化, 其他
    module: Mapped[Optional[str]] = mapped_column(String(100), nullable=True) # 关联功能模块
    screenshot_url: Mapped[Optional[str]] = mapped_column(String, nullable=True) # 上传截图的 COS 地址
    upvotes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    
    comments: Mapped[List["FeedbackComment"]] = relationship(
        "FeedbackComment", back_populates="feedback", cascade="all, delete-orphan", order_by="desc(FeedbackComment.is_pinned), desc(FeedbackComment.created_at)"
    )
    votes: Mapped[List["FeedbackVote"]] = relationship(
        "FeedbackVote", back_populates="feedback", cascade="all, delete-orphan"
    )


class FeedbackComment(Base):
    """反馈的讨论评论"""
    __tablename__ = "feedback_comments"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    feedback_id: Mapped[int] = mapped_column(Integer, ForeignKey("feedbacks.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    author_name: Mapped[str] = mapped_column(String(100), nullable=False)
    author_avatar: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    
    feedback: Mapped["Feedback"] = relationship("Feedback", back_populates="comments")


class FeedbackVote(Base):
    """反馈的点赞记录"""
    __tablename__ = "feedback_votes"
    
    feedback_id: Mapped[int] = mapped_column(Integer, ForeignKey("feedbacks.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    
    feedback: Mapped["Feedback"] = relationship("Feedback", back_populates="votes")
