#!/bin/bash
# ===========================================
#  offerPilot 服务器换包脚本
#  用法: bash swap.sh <backend|frontend|all>
#
#  依赖: /data/offerPilot/packages/ 下的 .tar 镜像包
# ===========================================
set -o errexit
set -o nounset
set -o pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SERVICE="${1:-}"
PACKAGES_DIR="/data/offerPilot/packages"
DEPLOY_DIR="/data/offerPilot/deploy"

usage() {
    echo "用法: bash swap.sh <backend|frontend|all>"
    exit 1
}

# 参数校验
if [[ -z "$SERVICE" ]]; then
    echo -e "${RED}错误: 缺少参数${NC}"
    usage
fi
if [[ "$SERVICE" != "backend" && "$SERVICE" != "frontend" && "$SERVICE" != "all" ]]; then
    echo -e "${RED}错误: 无效参数 '$SERVICE'${NC}"
    usage
fi

echo ""
echo -e "${CYAN}========================================"
echo "  offerPilot 服务器换包"
echo "  目标: $SERVICE"
echo "========================================${NC}"
echo ""

# 切换目录
if [[ ! -d "$DEPLOY_DIR" ]]; then
    echo -e "${RED}错误: 部署目录不存在 $DEPLOY_DIR${NC}"
    exit 1
fi
cd "$DEPLOY_DIR"

# ── 读取项目版本号(env.public 是新的部署配置源,backend/.env 已废弃)──
if [[ ! -f ./env.public ]]; then
    echo -e "${RED}错误: 缺少 ./env.public(部署配置入口)${NC}"
    exit 1
fi
PROJECT_VERSION=$(grep '^PROJECT_VERSION=' ./env.public | cut -d'=' -f2)
if [[ -z "$PROJECT_VERSION" ]]; then
    echo -e "${RED}错误: 未在 ./env.public 中找到 PROJECT_VERSION${NC}"
    exit 1
fi
export PROJECT_VERSION
echo -e "${CYAN}项目版本: $PROJECT_VERSION${NC}"
echo ""

# ── Sanity check:secrets 目录就绪(backend 启动会读,缺 JWT_SECRET 会直接挂)──
if [[ "$SERVICE" == "backend" || "$SERVICE" == "all" ]]; then
    if [[ -x ./setup-secrets.sh ]]; then
        echo -e "${YELLOW}[0/3] 校验 ./secrets 目录...${NC}"
        if ! ./setup-secrets.sh --check; then
            echo ""
            echo -e "${RED}错误: secrets 校验失败,见上方输出${NC}"
            echo -e "${YELLOW}请运行 ./setup-secrets.sh(交互式)或 ./setup-secrets.sh --only <name> 补齐缺失项后重试${NC}"
            exit 1
        fi
        echo ""
    else
        echo -e "${YELLOW}警告: 找不到 ./setup-secrets.sh,跳过 secrets 校验(本地部署?)${NC}"
        echo ""
    fi
fi

# ── 加载并替换 ──
swap_backend() {
    local tar_file="$PACKAGES_DIR/backend.tar"
    if [[ ! -f "$tar_file" ]]; then
        echo -e "${RED}错误: 找不到 $tar_file${NC}"
        exit 1
    fi

    echo -e "${YELLOW}[1/3] 加载 backend 镜像...${NC}"
    local loaded=$(docker load -i "$tar_file" | tee /dev/stderr | grep 'Loaded image' | sed 's/.*: //')
    if [[ -n "$loaded" && "$loaded" != "offerpilot-backend:$PROJECT_VERSION" ]]; then
        echo -e "${YELLOW}       → retag $loaded → offerpilot-backend:$PROJECT_VERSION${NC}"
        docker tag "$loaded" "offerpilot-backend:$PROJECT_VERSION"
    fi

    echo -e "${YELLOW}[2/3] 重启 backend 容器...${NC}"
    docker compose up -d backend

    echo -e "${YELLOW}[3/3] 清理旧镜像...${NC}"
    docker image prune -f

    echo -e "${GREEN}backend 换包完成！${NC}"
}

swap_frontend() {
    local tar_file="$PACKAGES_DIR/frontend.tar"
    if [[ ! -f "$tar_file" ]]; then
        echo -e "${RED}错误: 找不到 $tar_file${NC}"
        exit 1
    fi

    echo -e "${YELLOW}[1/3] 加载 frontend 镜像...${NC}"
    local loaded=$(docker load -i "$tar_file" | tee /dev/stderr | grep 'Loaded image' | sed 's/.*: //')
    if [[ -n "$loaded" && "$loaded" != "offerpilot-frontend:$PROJECT_VERSION" ]]; then
        echo -e "${YELLOW}       → retag $loaded → offerpilot-frontend:$PROJECT_VERSION${NC}"
        docker tag "$loaded" "offerpilot-frontend:$PROJECT_VERSION"
    fi

    echo -e "${YELLOW}[2/3] 重启 frontend 容器...${NC}"
    docker compose up -d frontend

    echo -e "${YELLOW}[3/3] 清理旧镜像...${NC}"
    docker image prune -f

    echo -e "${GREEN}frontend 换包完成！${NC}"
}

case "$SERVICE" in
    backend)
        swap_backend
        ;;
    frontend)
        swap_frontend
        ;;
    all)
        swap_backend
        echo ""
        swap_frontend
        ;;
esac

# ── 最终状态 ──
echo ""
echo -e "${CYAN}========================================"
echo "  容器状态"
echo "========================================${NC}"
docker compose ps

echo ""
echo -e "${GREEN}换包完成 ✓${NC}"
