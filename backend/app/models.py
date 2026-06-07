from datetime import datetime
from typing import List, Optional
from sqlalchemy import ForeignKey, String, Integer, Boolean, DateTime, func, ARRAY, Float, BigInteger
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
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
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
    
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
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
    
    # Aggregated report score fields
    ipi_score: Mapped[int] = mapped_column(Integer, default=0)
    offer_probability: Mapped[int] = mapped_column(Integer, default=0)
    summary_strengths: Mapped[List[str]] = mapped_column(ARRAY(String), default=list)
    summary_weaknesses: Mapped[List[str]] = mapped_column(ARRAY(String), default=list)
    summary_suggestions: Mapped[List[str]] = mapped_column(ARRAY(String), default=list)
    executive_summary: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    user: Mapped[Optional["User"]] = relationship("User", back_populates="sessions")
    tasks: Mapped[List["AnalysisTask"]] = relationship("AnalysisTask", back_populates="session", cascade="all, delete-orphan")
    segments: Mapped[List["TranscriptSegment"]] = relationship("TranscriptSegment", back_populates="session", cascade="all, delete-orphan")
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
    
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    
    session: Mapped["InterviewSession"] = relationship("InterviewSession", back_populates="tasks")


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False)
    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)
    speaker: Mapped[str] = mapped_column(String(20), nullable=False) # Interviewer / Candidate
    content: Mapped[str] = mapped_column(String, nullable=False)
    
    session: Mapped["InterviewSession"] = relationship("InterviewSession", back_populates="segments")


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
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    user: Mapped[Optional["User"]] = relationship("User", back_populates="files")
