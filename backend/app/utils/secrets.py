"""Docker secrets 装载器。

服务器部署时,docker-compose.yml 用 `secrets:` 把敏感 key 文件挂到
容器内 /run/secrets/<name>。本模块在启动期扫描该目录,把每个文件名
转成 ENV 变量名(upper, - → _),文件内容注入到 os.environ。

行为契约:
  - 目录不存在(本地开发)→ 静默 no-op,return 0
  - 文件为空 / 文件是目录 → 跳过
  - 强制覆盖 os.environ 中同名变量(确保 secrets 优先于 .env)
  - 必须在 from app.config import settings 之前调用,
    否则 pydantic-settings 已经把 .env 里的空值 cache 进 settings 了

使用:
  # backend/app/main.py 顶部
  from app.utils.secrets import load_docker_secrets
  load_docker_secrets()
"""
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

# Docker Compose 默认 secrets 挂载点
_DOCKER_SECRETS_DIR = "/run/secrets"


def load_docker_secrets(secret_dir: str = _DOCKER_SECRETS_DIR) -> int:
    """扫描 secret_dir 下所有文件,注入到 os.environ。

    Args:
        secret_dir: 装载点路径。Docker 容器内固定是 /run/secrets,
                    测试时可改成别的临时目录。

    Returns:
        成功装载的 secret 数量。
    """
    p = Path(secret_dir)
    if not p.is_dir():
        # 本地开发或未挂载 secrets,直接静默返回
        return 0

    loaded = 0
    for f in sorted(p.iterdir()):
        if not f.is_file() or f.stat().st_size == 0:
            continue
        # 文件名 → ENV 变量名: lowercase-with-dashes → UPPERCASE_WITH_UNDERSCORES
        env_name = f.name.upper().replace("-", "_")
        try:
            value = f.read_text(encoding="utf-8").strip()
        except OSError as e:
            logger.warning("[secrets] 读取 %s 失败: %s", f.name, e)
            continue
        if not value:
            continue
        os.environ[env_name] = value  # 强制覆盖,确保 secrets 优先于 .env
        loaded += 1

    logger.info(
        "[secrets] 从 %s 装载 %d 项敏感 key(强制覆盖 .env 同名变量)",
        secret_dir, loaded,
    )
    return loaded
