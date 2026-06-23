import random
from datetime import timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
import redis.asyncio as aioredis

from app import models, schemas
from app.database import get_db, get_redis
from app.utils.security import (
    get_password_hash,
    verify_password,
    create_access_token,
    verify_access_token
)
from app.utils.sms import sms_helper
from app.utils.email import email_helper

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
security = HTTPBearer()
security_optional = HTTPBearer(auto_error=False)

# Helper function to format UserProfile to Frontend expected structure
def format_user_profile(user: models.User) -> schemas.UserProfileResponse:
    p = user.profile
    return schemas.UserProfileResponse(
        name=user.username,
        avatar=p.avatar_url,
        role=f"{p.role_name or '后端开发工程师'} · {p.target_grade or '高级'}",
        company=p.company_name or "暂无公司",
        years=f"{p.experience_years or '在校/应届'}{p.experience_months or '0个月'}",
        status="在职" if p.job_status == "active" else "离职" if p.job_status == "resigned" else "在校生",
        salary=f"{p.salary_min or 0}K - {p.salary_max or 0}K",
        targetCompany=p.target_company or "大厂公司 (目标)",
        targetRole=p.target_role or "高级工程师",
        targetGrade=p.target_grade or "高级",
        targetSalary=f"{p.target_salary_min or 0}K - {p.target_salary_max or 0}K",
        gender=p.gender,
        age=str(p.age),
        school=p.school or "暂无学校",
        degree=p.degree or "本科",
        hasExp=p.has_experience,
        is_online=user.is_online,
        membership=user.membership,
        phone=user.phone,
        email=user.email,
        targetCity=p.target_cities[0] if p.target_cities else None,
        createdAt=user.created_at.isoformat() if user.created_at else None
    )

# FastAPI dependency to fetch logged-in user details
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis)
) -> models.User:
    token = credentials.credentials
    # Check if token is blacklisted
    is_blacklisted = await redis_client.get(f"auth:blacklist:{token}")
    if is_blacklisted:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token已废弃，请重新登录"
        )
        
    user_id = verify_access_token(token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="会话无效或已过期"
        )
        
    result = await db.execute(
        select(models.User)
        .options(selectinload(models.User.profile))
        .where(models.User.id == user_id)
    )
    user = result.scalars().first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户账户不存在"
        )
    return user


# FastAPI dependency to fetch logged-in user details optionally (returns None for guests)
async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional),
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis)
) -> Optional[models.User]:
    if not credentials or not credentials.credentials:
        return None
    token = credentials.credentials
    
    is_blacklisted = await redis_client.get(f"auth:blacklist:{token}")
    if is_blacklisted:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token已废弃，请重新登录"
        )
        
    user_id = verify_access_token(token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="会话无效或已过期"
        )
        
    result = await db.execute(
        select(models.User)
        .options(selectinload(models.User.profile))
        .where(models.User.id == user_id)
    )
    user = result.scalars().first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户账户不存在"
        )
    return user


@router.post("/send-code")
async def send_code(
    req: schemas.SendCodeRequest,
    redis_client: aioredis.Redis = Depends(get_redis)
):
    target = req.target
    
    # 频率控制: 1分钟限制一次
    limit_key = f"auth:limit:{target}"
    is_limited = await redis_client.get(limit_key)
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="发送验证码频繁，请 60s 后重试"
        )
        
    # 生成 6 位随机验证码
    code = f"{random.randint(100000, 999999)}"
    
    if req.type == "phone":
        # 调用腾讯云短信助手接口发送短信
        success = sms_helper.send_verification_code(phone=target, code=code)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="验证码短信发送失败，请稍后重试"
            )
    elif req.type == "email":
        # 调用邮件发送工具发送真实邮件
        success = email_helper.send_verification_code(email=target, code=code)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="验证码邮件发送失败，请稍后重试"
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不支持的验证码发送类型"
        )
        
    # 存入 Redis，验证码 5分钟有效 (300秒)
    await redis_client.setex(f"auth:code:{target}", 300, code)
    # 存入限流标志，1分钟有效 (60秒)
    await redis_client.setex(limit_key, 60, "1")
    
    return {"message": "验证码已成功发送"}


@router.post("/register/step1")
async def register_step1(
    req: schemas.RegisterStep1Request,
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis)
):
    # Check username unique
    result = await db.execute(select(models.User).where(models.User.username == req.username))
    if result.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名已存在"
        )
        
    # Check phone or email unique and verify code
    target = req.phone if req.reg_method == "phone" else str(req.email)
    if not target:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="手机号或邮箱字段不能为空"
        )
        
    # Unique check
    if req.reg_method == "phone":
        phone_res = await db.execute(select(models.User).where(models.User.phone == req.phone))
        if phone_res.scalars().first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="该手机号已被注册"
            )
    else:
        email_res = await db.execute(select(models.User).where(models.User.email == str(req.email)))
        if email_res.scalars().first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="该邮箱地址已被注册"
            )
            
    # Verify code matches Redis value
    saved_code = await redis_client.get(f"auth:code:{target}")
    if not saved_code or saved_code != req.verify_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码无效或已过期"
        )
        
    return {"message": "第一步验证通过，可进入后续档案填写"}


@router.post("/register/complete", response_model=schemas.TokenResponse)
async def register_complete(
    req: schemas.RegisterCompleteRequest,
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis)
):
    # Verify code again in transaction context
    acc = req.account
    target = acc.phone if acc.reg_method == "phone" else str(acc.email)
    
    saved_code = await redis_client.get(f"auth:code:{target}")
    if not saved_code or saved_code != acc.verify_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="注册验证码无效或已过期，请重新验证"
        )
        
    # Check existence
    exist_check = await db.execute(
        select(models.User).where(
            (models.User.username == acc.username) | 
            ((models.User.phone == acc.phone) & (models.User.phone.is_not(None))) |
            ((models.User.email == str(acc.email)) & (models.User.email.is_not(None)))
        )
    )
    if exist_check.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="账户名、手机号或邮箱已被占用"
        )

    # Insert user in transaction
    hashed_pwd = get_password_hash(acc.password)
    new_user = models.User(
        username=acc.username,
        password_hash=hashed_pwd,
        phone=acc.phone,
        email=str(acc.email) if acc.email else None,
        is_online=True
    )
    db.add(new_user)
    await db.flush() # Flush to get new_user.id
    
    # Save UserProfile details
    prof = req.profile
    exp = req.expectations
    new_profile = models.UserProfile(
        user_id=new_user.id,
        gender=prof.gender,
        age=prof.age,
        job_status=prof.job_status,
        avatar_url=prof.avatar_url,
        experience_years=prof.experience_years,
        experience_months=prof.experience_months,
        company_name=prof.company_name,
        role_name=prof.role_name,
        salary_min=prof.salary_min,
        salary_max=prof.salary_max,
        school=prof.school,
        degree=prof.degree,
        has_experience=prof.has_experience,
        target_cities=exp.target_cities,
        target_company=exp.target_company,
        target_role=exp.target_role,
        target_grade=exp.target_grade,
        target_salary_min=exp.target_salary_min,
        target_salary_max=exp.target_salary_max
    )
    db.add(new_profile)
    
    from sqlalchemy.exc import IntegrityError
    try:
        await db.commit() # Commit transaction
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该账户、手机号或邮箱已被注册占用，请直接登录"
        )
    
    # Refresh to load relationships
    await db.refresh(new_user)
    result = await db.execute(
        select(models.User).options(selectinload(models.User.profile)).where(models.User.id == new_user.id)
    )
    new_user = result.scalars().first()

    # Clear code
    await redis_client.delete(f"auth:code:{target}")
    
    # Generate token
    token = create_access_token(data={"sub": str(new_user.id)})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": format_user_profile(new_user)
    }


@router.post("/login", response_model=schemas.TokenResponse)
async def login(
    req: schemas.LoginRequest,
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis)
):
    user = None
    if req.login_type == "password":
        # Lookup user by username, phone, or email
        result = await db.execute(
            select(models.User)
            .options(selectinload(models.User.profile))
            .where(
                (models.User.username == req.account) |
                (models.User.phone == req.account) |
                (models.User.email == req.account)
            )
        )
        user = result.scalars().first()
        if not user or not verify_password(req.password or "", user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="用户名或密码错误"
            )
    elif req.login_type == "code":
        # Code login: verifies target code from Redis
        saved_code = await redis_client.get(f"auth:code:{req.account}")
        if not saved_code or saved_code != req.verify_code:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="验证码无效或已过期"
            )
            
        result = await db.execute(
            select(models.User)
            .options(selectinload(models.User.profile))
            .where(
                (models.User.phone == req.account) |
                (models.User.email == req.account)
            )
        )
        user = result.scalars().first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="绑定该号码的账户不存在，请先注册"
            )
        # Clear code
        await redis_client.delete(f"auth:code:{req.account}")
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="未知的登录方式"
        )
        
    user.is_online = True
    await db.commit()
    
    token = create_access_token(data={"sub": str(user.id)})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": format_user_profile(user)
    }


@router.post("/logout")
async def logout(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis),
    current_user: models.User = Depends(get_current_user)
):
    token = credentials.credentials
    # Put token to blacklist with 24 hours expiry (matches Access Token expiry)
    await redis_client.setex(f"auth:blacklist:{token}", 86400, "revoked")
    
    # Set user online status to False
    current_user.is_online = False
    await db.commit()
    
    return {"message": "已成功安全退出登录"}


@router.post("/reset-password")
async def reset_password(
    req: schemas.ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis)
):
    # Verify code
    saved_code = await redis_client.get(f"auth:code:{req.target}")
    if not saved_code or saved_code != req.verify_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码无效或已过期"
        )
        
    # Find user
    field = models.User.phone if req.type == "phone" else models.User.email
    result = await db.execute(select(models.User).where(field == req.target))
    user = result.scalars().first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_440_TEMPLATE_MISMATCH,
            detail="未找到该号码关联的账号"
        )
        
    # Update password
    user.password_hash = get_password_hash(req.new_password)
    await db.commit()
    await redis_client.delete(f"auth:code:{req.target}")
    
    return {"message": "密码重置成功，请重新登录"}


@router.put("/security/update")
async def security_update(
    req: schemas.SecurityUpdateRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis)
):
    # Verify code
    saved_code = await redis_client.get(f"auth:code:{req.value}")
    if not saved_code or saved_code != req.verify_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码无效或已过期"
        )
        
    # Check value conflicts
    if req.update_type == "phone":
        conflict = await db.execute(
            select(models.User).where((models.User.phone == req.value) & (models.User.id != current_user.id))
        )
        if conflict.scalars().first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该手机号已被其他账号绑定")
        current_user.phone = req.value
    else:
        conflict = await db.execute(
            select(models.User).where((models.User.email == req.value) & (models.User.id != current_user.id))
        )
        if conflict.scalars().first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该邮箱已被其他账号绑定")
        current_user.email = req.value
        
    # Update password if provided
    if req.new_password and len(req.new_password.strip()) >= 8:
        current_user.password_hash = get_password_hash(req.new_password)
        
    await db.commit()
    await redis_client.delete(f"auth:code:{req.value}")
    
    return {"message": "账户安全信息已成功更新"}


@router.delete("/delete-account")
async def delete_account(
    current_user: models.User = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis)
):
    # Cascade delete is handled by relationship cascade option, deleting Profile
    await db.delete(current_user)
    await db.commit()
    
    # Block token
    token = credentials.credentials
    await redis_client.setex(f"auth:blacklist:{token}", 86400, "revoked")
    
    return {"message": "账户及关联所有分析报告已彻底注销且清除成功"}


@router.get("/me", response_model=schemas.UserProfileResponse)
async def get_me(
    current_user: models.User = Depends(get_current_user)
):
    return format_user_profile(current_user)


@router.put("/profile/update", response_model=schemas.UserProfileResponse)
async def profile_update(
    req: schemas.ProfileUpdateReq,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    p = current_user.profile
    if not p:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户档案不存在"
        )
        
    if req.username is not None and req.username != current_user.username:
        # Check username uniqueness
        conflict = await db.execute(select(models.User).where(models.User.username == req.username))
        if conflict.scalars().first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="该用户名已存在"
            )
        current_user.username = req.username
        
    # Update fields if provided in request
    if req.gender is not None: p.gender = req.gender
    if req.age is not None: p.age = req.age
    if req.job_status is not None: p.job_status = req.job_status
    if req.avatar_url is not None: p.avatar_url = req.avatar_url
    if req.experience_years is not None: p.experience_years = req.experience_years
    if req.experience_months is not None: p.experience_months = req.experience_months
    if req.company_name is not None: p.company_name = req.company_name
    if req.role_name is not None: p.role_name = req.role_name
    if req.salary_min is not None: p.salary_min = req.salary_min
    if req.salary_max is not None: p.salary_max = req.salary_max
    if req.school is not None: p.school = req.school
    if req.degree is not None: p.degree = req.degree
    if req.has_experience is not None: p.has_experience = req.has_experience
    
    if req.target_cities is not None: p.target_cities = req.target_cities
    if req.target_company is not None: p.target_company = req.target_company
    if req.target_role is not None: p.target_role = req.target_role
    if req.target_grade is not None: p.target_grade = req.target_grade
    if req.target_salary_min is not None: p.target_salary_min = req.target_salary_min
    if req.target_salary_max is not None: p.target_salary_max = req.target_salary_max
    
    await db.commit()
    await db.refresh(current_user)
    return format_user_profile(current_user)
