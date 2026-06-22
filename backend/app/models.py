from datetime import datetime
from typing import List, Optional
from sqlalchemy import ForeignKey, String, Integer, Boolean, DateTime, func, ARRAY, Float, BigInteger, UniqueConstraint, Index, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
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
    
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    user: Mapped["User"] = relationship("User", back_populates="profile")


class InterviewSession(Base):
    __tablename__ = "interview_sessions"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    audio_url: Mapped[str] = mapped_column(String, nullable=False)
    duration: Mapped[int] = mapped_column(Integer, default=0)
    file_size: Mapped[int] = mapped_column(BigInteger, default=0)
    status: Mapped[str] = mapped_column(String(50), default="uploaded") # uploaded, processing, completed, failed
    job_description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    
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
