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
