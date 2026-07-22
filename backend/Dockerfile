FROM python:3.12-slim

# 切到国内 apt 源（解决境外源超时/被墙）
RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources; \
    fi \
    && if [ -f /etc/apt/sources.list ]; then \
        sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list; \
    fi

WORKDIR /app

# 安装系统依赖（asyncpg 需要 libpq）
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev gcc \
    || apt-get install -y --no-install-recommends --fix-missing libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖（阿里云 PyPI 镜像）
  COPY requirements.txt .
  # 把构建依赖（setuptools / wheel）也下载到 /wheels，
  # 否则 --no-index 离线安装阶段，源码包（如 pdf2docx / pgvector）构建时会找不到 setuptools 而失败
  RUN pip download --no-cache-dir \
          -r requirements.txt \
          setuptools wheel \
          -d /wheels \
          -i https://mirrors.aliyun.com/pypi/simple/ \
          --extra-index-url https://pypi.tuna.tsinghua.edu.cn/simple \
          --trusted-host mirrors.aliyun.com \
          --trusted-host pypi.tuna.tsinghua.edu.cn
  # 从本地 wheels 安装（不再走网络），装完清掉 /wheels
  RUN pip install --no-cache-dir -r requirements.txt \
          --no-index --find-links=/wheels \
      && rm -rf /wheels

# 复制源码
COPY . .

# 创建上传和日志目录
RUN mkdir -p uploads logs

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
