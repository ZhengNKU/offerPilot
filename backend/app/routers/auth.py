import random
import asyncio
import logging
from datetime import timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
import redis.asyncio as aioredis
from redis.exceptions import RedisError

from app import models, schemas
from app.config import settings
from app.services.match_scorer import (
    compute_match_rate_from_profile,
    compute_match_rate_from_profile_llm,
    trigger_match_rate_regen,
)
from app.database import get_db, get_redis
from app.utils.security import (
    get_password_hash,
    verify_password,
    create_access_token,
    verify_access_token
)
from app.utils.sms import sms_helper
from app.utils.email import email_helper

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
security = HTTPBearer()
security_optional = HTTPBearer(auto_error=False)


async def _is_token_blacklisted(redis_client: aioredis.Redis, token: str) -> bool:
    """检查 token 是否在 Redis 黑名单。Redis 故障时降级放行（fail-open）。

    黑名单是次级防御（主防御是 JWT 签名校验），不应因为 Redis 鉴权/连接
    异常而把整个请求变成 500。生产曾因 REDIS_URL 凭据偶发被服务端拒绝，
    导致所有需要登录的接口间歇性 500。
    """
    try:
        return bool(await redis_client.get(f"auth:blacklist:{token}"))
    except RedisError as e:
        logger.warning(
            "[auth] 黑名单检查失败，降级放行 token=%s... err=%r",
            token[:8], e,
        )
        return False


def _session_key(user_id: int) -> str:
    """单点登录：每个用户当前唯一活跃 token 的 Redis key。"""
    return f"auth:session:{user_id}"


def _is_multi_session_exempt(username: str | None) -> bool:
    """判断用户名是否在单点登录豁免名单内（例如 admin）。

    名单来自 settings.MULTI_SESSION_EXEMPT_USERNAMES（逗号分隔，大小写不敏感）。
    这些账号再次签发 token 时**不会**挤掉前一会话 —— 用于调试/客服等场景。
    """
    if not username:
        return False
    exempt_list = {
        name.strip().lower()
        for name in settings.MULTI_SESSION_EXEMPT_USERNAMES.split(",")
        if name.strip()
    }
    return username.lower() in exempt_list


async def _revoke_token(
    redis_client: aioredis.Redis,
    token: str,
    reason: str,
    ttl_seconds: int | None = None,
) -> None:
    """把 token 写入黑名单，TTL 默认与 access token 有效期一致。

    Redis 故障时降级日志告警但不再 raise，避免挤下线逻辑把登录流程拖死。
    """
    seconds = ttl_seconds or settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    try:
        await redis_client.setex(f"auth:blacklist:{token}", seconds, reason)
    except RedisError as e:
        logger.warning(
            "[auth] 写入黑名单失败 token=%s... reason=%s err=%r",
            token[:8], reason, e,
        )


async def enforce_single_session(
    redis_client: aioredis.Redis,
    user_id: int,
    new_token: str,
) -> None:
    """单点登录策略：用户再次签发 token 时，把上一次还活着的 token 挤下线。

    实现方式：
      1. Redis 维护 `auth:session:{user_id} -> token`，TTL 与 access token 有效期一致
      2. 签发新 token 前 GET 旧值；若旧值与新 token 不同 → 写入黑名单
      3. SET 新值覆盖

    同样的账号第二次登录时，老设备下次任何带旧 token 的请求（HTTP 或 WS）
    都会被 `_is_token_blacklisted` 挡掉，自动 401 / WS close。

    Redis 故障时降级：不做挤下线（fail-open），但登录仍然成功。这是
    与黑名单检查一致的降级策略 —— 单点登录是体验优化，不应让 Redis 抖动
    把登录流程拖死。
    """
    try:
        session_key = _session_key(user_id)
        old_token = await redis_client.get(session_key)
    except RedisError as e:
        logger.warning(
            "[auth] 单点登录检查失败，跳过挤下线 user_id=%s err=%r",
            user_id, e,
        )
        return

    if old_token and old_token != new_token:
        await _revoke_token(redis_client, old_token, reason="evicted_by_new_login")
        logger.info(
            "[auth] 单点登录挤下线 user_id=%s old_token=%s... → new_token=%s...",
            user_id, (old_token or "")[:8], new_token[:8],
        )

    try:
        await redis_client.setex(
            session_key,
            settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            new_token,
        )
    except RedisError as e:
        logger.warning(
            "[auth] 单点登录 session 写入失败 user_id=%s err=%r",
            user_id, e,
        )


async def clear_single_session(
    redis_client: aioredis.Redis,
    user_id: int,
) -> None:
    """主动退出时清除 session 映射（logout / delete-account）。

    同样 fail-open：失败仅告警，不抛出。
    """
    try:
        await redis_client.delete(_session_key(user_id))
    except RedisError as e:
        logger.warning(
            "[auth] 清除单点登录 session 失败 user_id=%s err=%r",
            user_id, e,
        )

# Helper function to format UserProfile to Frontend expected structure
def format_user_profile(user: models.User) -> schemas.UserProfileResponse:
    p = user.profile
    # 防御性兜底：脏数据 / 种子账号导致 profile 为 None 时，用一组合理默认值构造响应，
    # 避免登录等接口因 AttributeError 直接 500（曾导致 admin 账号无法登录）。
    if p is None:
        return schemas.UserProfileResponse(
            name=user.username,
            avatar=None,
            role="系统管理员" if user.username == "admin" else "用户",
            company="暂无公司",
            years="应届0个月",
            status="在职",
            salary="0K - 0K",
            targetCompany="大厂公司 (目标)",
            targetRole="高级工程师",
            targetGrade="高级",
            targetSalary="0K - 0K",
            gender="male",
            age="0",
            school="暂无学校",
            degree="本科",
            hasExp=False,
            is_online=user.is_online,
            membership=user.membership,
            phone=user.phone,
            email=user.email,
            targetCity=None,
            createdAt=user.created_at.isoformat() if user.created_at else None,
            matchRate=None,
        )
    return schemas.UserProfileResponse(
        name=user.username,
        avatar=p.avatar_url,
        role=p.role_name or "",
        company=p.company_name or "",
        years=f"{p.experience_years or '在校'}{p.experience_months or '0个月'}",
        status="在职" if p.job_status == "active" else "离职" if p.job_status == "resigned" else "应届生" if p.job_status == "fresh_grad" else "在校生",
        salary=f"{p.salary_min}K - {p.salary_max}K" if (p.salary_min is not None and p.salary_max is not None and (p.salary_min > 0 or p.salary_max > 0)) else "",
        targetCompany=p.target_company or "",
        targetRole=p.target_role or "",
        targetGrade=p.target_grade or "",
        targetSalary=f"{p.target_salary_min}K - {p.target_salary_max}K" if (p.target_salary_min and p.target_salary_max) else "",
        gender=p.gender,
        age=str(p.age),
        school=p.school or "暂无学校",
        degree=p.degree or "本科",
        hasExp=p.has_experience,
        is_online=user.is_online,
        membership=user.membership,
        phone=user.phone,
        email=user.email,
        targetCity="、".join(p.target_cities) if p.target_cities else None,
        createdAt=user.created_at.isoformat() if user.created_at else None,
        matchRate=p.match_rate,
    )

# FastAPI dependency to fetch logged-in user details
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis)
) -> models.User:
    token = credentials.credentials
    # Check if token is blacklisted (Redis 故障时降级放行，详见 _is_token_blacklisted)
    if await _is_token_blacklisted(redis_client, token):
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

    if await _is_token_blacklisted(redis_client, token):
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
    # 内测版本：拒接手机验证码（仅保留邮箱验证码通道）
    if req.type == "phone":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="内测期间暂不支持短信注册，请使用邮箱注册",
        )

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

    # 内测版本：phone 分支已被顶部 raise 拦截，下面只保留 email 分支
    # 调用邮件发送工具发送真实邮件
    if req.type == "email":
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
    # 内测版本：拒接手机注册（仅保留邮箱注册通道）
    if req.reg_method == "phone":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="内测期间暂不支持手机号注册，请使用邮箱注册",
        )

    # Check username unique
    result = await db.execute(select(models.User).where(models.User.username == req.username))
    if result.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名已存在"
        )

    # Check email unique and verify code
    target = str(req.email) if req.email else None
    if not target:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邮箱字段不能为空"
        )

    # Unique check (only email branch left after phone-reject above)
    email_res = await db.execute(select(models.User).where(models.User.email == target))
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
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    redis_client: aioredis.Redis = Depends(get_redis)
):
    # 内测版本：拒接手机注册（仅保留邮箱注册通道）
    if req.account.reg_method == "phone":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="内测期间暂不支持手机号注册，请使用邮箱注册",
        )

    # Verify code again in transaction context
    acc = req.account
    target = str(acc.email) if acc.email else None
    if not target:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邮箱字段不能为空"
        )

    saved_code = await redis_client.get(f"auth:code:{target}")
    if not saved_code or saved_code != acc.verify_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="注册验证码无效或已过期，请重新验证"
        )
        
    # Check existence
    if acc.username.lower() == "admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="账户名已被占用"
        )

    exist_check = await db.execute(
        select(models.User).where(
            (models.User.username == acc.username) |
            ((models.User.email == str(acc.email)) & (models.User.email.is_not(None)))
        )
    )
    if exist_check.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="账户名或邮箱已被占用"
        )

    # Insert user in transaction
    hashed_pwd = get_password_hash(acc.password)
    new_user = models.User(
        username=acc.username,
        password_hash=hashed_pwd,
        email=str(acc.email) if acc.email else None,
        is_online=True,
        membership="test",  # 内测版本：所有新注册用户默认 test 档
    )
    db.add(new_user)
    await db.flush() # Flush to get new_user.id
    
    # Save UserProfile details
    prof = req.profile
    exp = req.expectations
    if len(exp.target_cities) > 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="最多只能选择三个目标城市"
        )
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

    # 计算初始匹配度
    try:
        new_profile.match_rate = compute_match_rate_from_profile(new_profile)
    except Exception as e:
        logging.warning(f"match_rate compute failed on register: {e}")

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

    # 注册即视为首次登录，同样要走一遍单点登录登记（虽然不可能有旧 token，
    # 但保持所有"签发 token 后"的逻辑统一在一处）
    # 豁免名单账号（如 admin）跳过，不挤下线
    if not _is_multi_session_exempt(new_user.username):
        await enforce_single_session(redis_client, new_user.id, token)

    # 异步为新注册用户生成基于目标岗位的行业基准建议
    if new_profile and new_profile.target_role:
        generating_insights = {"status": "generating", "target_role": new_profile.target_role, "is_customized": False}
        insight = models.UserAdvisorInsight(
            user_id=new_user.id,
            insights=generating_insights
        )
        db.add(insight)
        await db.commit()

        from app.services.advisor_generator import trigger_general_advisor_insights
        background_tasks.add_task(
            trigger_general_advisor_insights,
            new_user.id,
            new_profile.target_role,
        )

        # 异步生成知识库能力卡片
        from app.services.knowledge_ability_service import trigger_knowledge_generation
        background_tasks.add_task(
            trigger_knowledge_generation,
            new_user.id,
        )

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
    # 内测版本：拒接验证码登录（保留 password 登录通道）
    if req.login_type == "code":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="内测期间暂不支持验证码登录，请使用邮箱 + 密码登录",
        )

    user = None
    if req.login_type == "password":
        # 内测版本：仅支持 username / email 登录（phone 已禁）
        result = await db.execute(
            select(models.User)
            .options(selectinload(models.User.profile))
            .where(
                (models.User.username == req.account) |
                (models.User.email == req.account)
            )
        )
        user = result.scalars().first()
        if not user or not verify_password(req.password or "", user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="用户名或密码错误"
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="未知的登录方式"
        )

    user.is_online = True
    await db.commit()

    token = create_access_token(data={"sub": str(user.id)})

    # 单点登录：挤掉该用户此前还活着的旧会话（其他设备登录被自动踢下线）
    # 但豁免名单（默认 admin）允许多端同时在线，方便日常后台多端调试
    if not _is_multi_session_exempt(user.username):
        await enforce_single_session(redis_client, user.id, token)

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
    # 1. 写入 token 黑名单：当前 token 不能继续使用
    await _revoke_token(redis_client, token, reason="logout")
    # 2. 清除单点登录 session：避免下一次登录时被错误地当成"旧设备"挤下线
    await clear_single_session(redis_client, current_user.id)

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
    # 内测版本：拒接手机号找回密码（仅保留邮箱找回）
    if req.type == "phone":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="内测期间暂不支持手机号找回密码，请使用邮箱找回密码",
        )

    # Verify code
    saved_code = await redis_client.get(f"auth:code:{req.target}")
    if not saved_code or saved_code != req.verify_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码无效或已过期"
        )

    # Find user by email (phone branch already rejected above)
    result = await db.execute(select(models.User).where(models.User.email == req.target))
    user = result.scalars().first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_440_TEMPLATE_MISMATCH,
            detail="未找到该邮箱关联的账号"
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
    # 内测版本：拒接换绑手机号（仅保留换绑邮箱）
    if req.update_type == "phone":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="内测期间暂不支持换绑手机号，请使用邮箱找回密码",
        )

    # Verify code
    saved_code = await redis_client.get(f"auth:code:{req.value}")
    if not saved_code or saved_code != req.verify_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码无效或已过期"
        )

    # Check value conflicts (email only after phone-reject above)
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

    # Block token（TTL 与 ACCESS_TOKEN_EXPIRE_MINUTES 保持一致，理由同 /logout）
    token = credentials.credentials
    await _revoke_token(redis_client, token, reason="account_deleted")
    # 同时清理单点登录 session，防止已被删除的 user_id 残留 Redis 记录
    await clear_single_session(redis_client, current_user.id)

    return {"message": "账户及关联所有分析报告已彻底注销且清除成功"}


@router.get("/me", response_model=schemas.UserProfileResponse)
async def get_me(
    current_user: models.User = Depends(get_current_user)
):
    return format_user_profile(current_user)


@router.get("/match-rate")
async def get_match_rate(
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    force_rules: bool = False,
):
    """
    实时计算并返回当前用户的求职目标匹配度。

    前端在「职业驾驶舱」页面加载、编辑个人职业资料成功后、
    求职目标编辑成功后调用此接口，获取最新的匹配度分数。

    Query:
        force_rules (bool): 强制走规则算法（不走 LLM）。
            用途：前端轮询 30s 超时后的兜底，避免用户长时间看到 loading。
    """
    p = current_user.profile
    if not p:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="用户档案不存在"
        )
    try:
        if force_rules:
            # 前端主动要求兜底（轮询超时场景）：跳过 LLM，直接规则算法
            rate = compute_match_rate_from_profile(p)
            p.match_rate = rate
            p.match_rate_pending = False
            await db.commit()
            logging.info(f"[match-rate] force_rules=true, rate={rate}")
        elif p.match_rate is None and not p.match_rate_pending:
            # 首次进入（match_rate 从未生成过且无后台任务在跑）→ 主动调 LLM 生成一次
            # 注意：这是唯一会触发主动重算的场景，避免前端轮询死循环
            try:
                rate = await asyncio.wait_for(
                    compute_match_rate_from_profile_llm(p),
                    timeout=25.0,
                )
            except asyncio.TimeoutError:
                logging.warning("[match-rate] LLM timeout 25s, fallback to rules")
                rate = None
            if rate is None:
                rate = compute_match_rate_from_profile(p)
            p.match_rate = rate
            await db.commit()
            logging.info(f"[match-rate] first-time generation, rate={rate}")
        else:
            # pending=true（后台异步任务还在跑）或 match_rate 已有值
            # → 只读不重算，避免前端轮询触发死循环
            rate = p.match_rate
            if p.match_rate_pending:
                logging.info(f"[match-rate] pending=true, return cached rate={rate}")
            else:
                logging.info(f"[match-rate] cache hit, rate={rate}")
    except Exception as e:
        logging.error(f"match_rate compute failed: {e}")
        rate = p.match_rate  # fallback to cached value
    return {"matchRate": rate, "pending": bool(p.match_rate_pending)}


@router.put("/profile/update", response_model=schemas.UserProfileResponse)
async def profile_update(
    req: schemas.ProfileUpdateReq,
    background_tasks: BackgroundTasks,
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
    if req.role_name is not None: p.role_name = req.role_name  # empty string clears
    if req.salary_min is not None: p.salary_min = req.salary_min if req.salary_min > 0 else None
    if req.salary_max is not None: p.salary_max = req.salary_max if req.salary_max > 0 else None
    if req.school is not None: p.school = req.school
    if req.degree is not None: p.degree = req.degree
    if req.has_experience is not None: p.has_experience = req.has_experience
    
    # 校验目标薪资范围
    target_min = req.target_salary_min if req.target_salary_min is not None else p.target_salary_min
    target_max = req.target_salary_max if req.target_salary_max is not None else p.target_salary_max
    if target_min is not None and target_max is not None and target_min > target_max:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="最低薪资不能高于最高薪资"
        )

    if req.target_cities is not None:
        if len(req.target_cities) > 3:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="最多只能选择三个目标城市"
            )
        p.target_cities = req.target_cities
    role_changed = req.target_role is not None and req.target_role != p.target_role
    if req.target_company is not None: p.target_company = req.target_company
    if req.target_role is not None: p.target_role = req.target_role
    if req.target_grade is not None: p.target_grade = req.target_grade
    if req.target_salary_min is not None:
        p.target_salary_min = req.target_salary_min if req.target_salary_min > 0 else None
    if req.target_salary_max is not None:
        p.target_salary_max = req.target_salary_max if req.target_salary_max > 0 else None

    # 重新计算求职目标匹配度（职业档案或求职目标变更后自动触发）
    # 改为异步：标记 match_rate_pending=True + 用 asyncio.create_task 把 LLM 丢到后台，
    # 接口立即返回。前端轮询 /match-rate 直到 pending=false。
    try:
        trigger_match_rate_regen(p)
    except RuntimeError:
        # 没有 running loop（理论上不会发生）→ 退化为同步
        logging.warning("[profile_update] no event loop, fall back to sync match_rate")
        try:
            new_rate = await compute_match_rate_from_profile_llm(p)
            if new_rate is None:
                new_rate = compute_match_rate_from_profile(p)
            p.match_rate = new_rate
            p.match_rate_pending = False
        except Exception as e:
            logging.warning(f"match_rate compute failed on profile update: {e}")
            p.match_rate = None

    await db.commit()
    await db.refresh(current_user)

    # 如果修改了目标岗位，重置缓存记录状态为 "generating"，并异步更新新的行业通用意见建议
    if role_changed and p.target_role:
        stmt = select(models.UserAdvisorInsight).where(models.UserAdvisorInsight.user_id == current_user.id)
        result = await db.execute(stmt)
        insight = result.scalars().first()
        generating_insights = {"status": "generating", "target_role": p.target_role, "is_customized": False}
        if insight:
            insight.insights = generating_insights
        else:
            insight = models.UserAdvisorInsight(
                user_id=current_user.id,
                insights=generating_insights
            )
            db.add(insight)
        await db.commit()

        from app.services.advisor_generator import trigger_general_advisor_insights
        background_tasks.add_task(
            trigger_general_advisor_insights,
            current_user.id,
            p.target_role,
        )

        # 目标岗位变更时，异步重新生成知识库能力卡片
        from app.services.knowledge_ability_service import trigger_knowledge_generation
        background_tasks.add_task(
            trigger_knowledge_generation,
            current_user.id,
        )

    return format_user_profile(current_user)
