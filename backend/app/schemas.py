from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional

class SendCodeRequest(BaseModel):
    type: str = Field(..., description="phone or email")
    target: str = Field(..., description="手机号或邮箱地址")

class RegisterStep1Request(BaseModel):
    reg_method: str = Field(..., description="phone or email")
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    verify_code: str
    username: str
    password: str

class UserProfileSchema(BaseModel):
    gender: str = "other"
    age: int
    job_status: str = "active"
    avatar_url: Optional[str] = None
    experience_years: Optional[str] = None
    experience_months: Optional[str] = None
    company_name: Optional[str] = None
    role_name: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    school: Optional[str] = None
    degree: Optional[str] = None
    has_experience: bool = True

class ExpectationsSchema(BaseModel):
    target_cities: List[str]
    target_company: Optional[str] = None
    target_role: Optional[str] = None
    target_grade: Optional[str] = "高级"
    target_salary_min: Optional[int] = None
    target_salary_max: Optional[int] = None

class RegisterCompleteRequest(BaseModel):
    account: RegisterStep1Request
    profile: UserProfileSchema
    expectations: ExpectationsSchema

class LoginRequest(BaseModel):
    login_type: str = Field(..., description="password or code")
    account: str = Field(..., description="用户名 / 手机号 / 邮箱")
    password: Optional[str] = None
    verify_code: Optional[str] = None

class ResetPasswordRequest(BaseModel):
    type: str = Field(..., description="phone or email")
    target: str = Field(..., description="绑定的手机号或邮箱")
    verify_code: str
    new_password: str

class SecurityUpdateRequest(BaseModel):
    update_type: str = Field(..., description="phone or email")
    value: str = Field(..., description="新手机号码或新邮箱地址")
    verify_code: str
    new_password: Optional[str] = None

class UserProfileResponse(BaseModel):
    name: str
    avatar: Optional[str] = None
    role: str
    company: str
    years: str
    status: str
    salary: str
    targetCompany: str
    targetRole: str
    targetGrade: str
    targetSalary: str
    gender: str
    age: str
    school: str
    degree: str
    hasExp: bool
    is_online: bool = False
    membership: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    targetCity: Optional[str] = None
    createdAt: Optional[str] = None
    matchRate: Optional[int] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserProfileResponse

class ProfileUpdateReq(BaseModel):
    username: Optional[str] = None
    gender: Optional[str] = None
    age: Optional[int] = None
    job_status: Optional[str] = None
    avatar_url: Optional[str] = None
    experience_years: Optional[str] = None
    experience_months: Optional[str] = None
    company_name: Optional[str] = None
    role_name: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    school: Optional[str] = None
    degree: Optional[str] = None
    has_experience: Optional[bool] = None
    
    target_cities: Optional[List[str]] = None
    target_company: Optional[str] = None
    target_role: Optional[str] = None
    target_grade: Optional[str] = None
    target_salary_min: Optional[int] = None
    target_salary_max: Optional[int] = None


# ── 项目记忆库 ──

class ProjectMemoryCreate(BaseModel):
    """手动新增项目记忆的请求体。AI 自动提取的走 services/project_memory_agent。"""
    project_name: str = Field(..., description="项目名称（最多128字）")
    summary: str = Field(..., description="项目简介（150-300字）")
    category: str = Field(..., description="主分类标签，如: AI工程 / 交易骨干")
    sub_tags: List[str] = Field(default_factory=list, description="辅助标签列表")
    tech_stack: List[str] = Field(default_factory=list, description="技术栈列表")
    metrics: dict = Field(default_factory=dict, description="量化指标，自由格式")
    role: Optional[str] = Field(None, description="担任角色")
    team_size: Optional[int] = Field(None, description="团队规模")
    duration: Optional[str] = Field(None, description="项目周期")


class ProjectMemoryUpdate(BaseModel):
    """手动编辑项目记忆的请求体。所有字段可选（只传要改的）。"""
    project_name: Optional[str] = Field(None, description="项目名称")
    summary: Optional[str] = Field(None, description="项目简介")
    description: Optional[str] = Field(None, description="详细描述")
    category: Optional[str] = Field(None, description="主分类标签")
    sub_tags: Optional[List[str]] = Field(None, description="辅助标签列表")
    tech_stack: Optional[List[str]] = Field(None, description="技术栈列表")
    metrics: Optional[dict] = Field(None, description="量化指标")
    role: Optional[str] = Field(None, description="担任角色")
    team_size: Optional[int] = Field(None, description="团队规模")
    duration: Optional[str] = Field(None, description="项目周期")
    mastery_level: Optional[int] = Field(None, ge=0, le=100, description="掌握度 0-100")
    importance: Optional[int] = Field(None, ge=0, le=100, description="重要度 0-100")


# ── 体验反馈中心 ──

class FeedbackCreate(BaseModel):
    title: str = Field(..., max_length=200, description="反馈标题")
    description: str = Field(..., max_length=300, description="反馈描述")
    type: str = Field(..., description="反馈类型：问题反馈、功能建议、体验优化、其他")
    module: Optional[str] = Field(None, description="关联功能模块")
    screenshot_url: Optional[str] = Field(None, description="上传截图的 COS 地址")


class CommentCreate(BaseModel):
    content: str = Field(..., max_length=300, description="评论内容")


class FeedbackCommentResponse(BaseModel):
    id: Optional[int] = None
    author: str
    avatar: Optional[str] = None
    content: str
    created_at: str
    is_pinned: bool = False


class FeedbackResponse(BaseModel):
    id: int
    title: str
    description: str
    author: str
    type: str
    module: Optional[str] = None
    screenshot_url: Optional[str] = None
    upvotes: int
    time: str
    commentsCount: int
    hasVoted: bool
    comments: List[FeedbackCommentResponse]


class FeedbackListResponse(BaseModel):
    items: List[FeedbackResponse]
    total: int
    page: int
    page_size: int


class FeaturedGuideOut(BaseModel):
    id: str
    title: str
    cover_img: str
    platform: str
    platform_badge_bg: str
    duration: Optional[str] = None
    url: str
    author: str
    author_avatar: str
    author_verified: bool = True
    category: str
    reads: int
    likes: int
    favorites: int

    class Config:
        from_attributes = True


class FeaturedGuidePageOut(BaseModel):
    items: List[FeaturedGuideOut]
    total: int
    page: int
    page_size: int
    total_pages: int

