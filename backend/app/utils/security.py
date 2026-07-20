import bcrypt
import jwt
from datetime import datetime, timedelta, timezone
from typing import Optional
from app.config import settings

def get_password_hash(password: str) -> str:
    """
    对明文密码进行哈希加盐处理
    """
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")

def verify_password(plain_password: str, hashed_password: Optional[str]) -> bool:
    """
    比对明文密码与哈希密码。

    password_hash 为空时直接返回 False，避免 bcrypt 抛 TypeError。
    当前注册流程强制要求设置密码，但 schema 保留 nullable 以兼容历史数据。
    """
    if not hashed_password:
        return False
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    生成 JWT Access Token
    """
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

def verify_access_token(token: str) -> Optional[int]:
    """
    校验 JWT 并返回其中的 user_id (sub)
    """
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            return None
        return int(user_id)
    except (jwt.PyJWTError, ValueError, TypeError):
        return None
