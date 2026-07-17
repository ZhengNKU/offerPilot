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

# 安装 Python 依赖（清华 PyPI 镜像）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 复制源码
COPY . .

# 创建上传和日志目录
RUN mkdir -p uploads logs

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
