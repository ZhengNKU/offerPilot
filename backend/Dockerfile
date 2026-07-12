FROM python:3.12-slim

WORKDIR /app

# 安装系统依赖（asyncpg 需要 libpq）
RUN apt update && apt install -y --no-install-recommends libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制源码
COPY . .

# 创建上传和日志目录
RUN mkdir -p uploads logs

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
