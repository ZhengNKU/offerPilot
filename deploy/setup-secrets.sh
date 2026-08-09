#!/usr/bin/env bash
# =============================================================================
# setup-secrets.sh — 一次性把第三方 API key 写入 deploy/secrets/<name>
# =============================================================================
#
# 用法:
#   ./setup-secrets.sh                   # 交互式:prompt 每个 key(已有则跳过)
#   ./setup-secrets.sh --force           # 强制重写所有 key(覆盖)
#   ./setup-secrets.sh --only <name>     # 只写/更新单个 key(可多次调用)
#   ./setup-secrets.sh --check           # 只检查 secrets 是否都到位(不写入)
#   ./setup-secrets.sh --show-names      # 列出需要的所有 key 名称(给运维交接用)
#
# 安全:
#   - read -s 不回显输入到终端
#   - 写入时只显示文件名,绝不打印 key 值
#   - chmod 600 限制只 owner 可读
#   - 目录 chmod 700 限制只 owner 可遍历
#
# 与 deploy/docker-compose.yml 的 secrets: 块严格对齐(8 项)。
# 若需要新增 key,先改 docker-compose.yml + backend/app/config.py,
# 再把 "<file>:<description>" 加到下面 SECRETS 数组。
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_DIR="${SCRIPT_DIR}/secrets"

# ── 8 个敏感 key,格式: <file>:<description> ──
# 注意:这里是「文件名:用途描述」,**不是「文件名:值」**。
# 值通过运行时 read -s prompt 写入,文件本身不含任何明文 key,
# 可以放心 commit(本文件已被 .gitignore 双重保险)。
SECRETS=(
    "deepseek_api_key:DeepSeek API Key (sk-开头)"
    "dashscope_api_key:阿里百炼 API Key (sk-开头)"
    "dashscope_workspace_id:阿里百炼 WorkspaceId (ws-开头,北京地域)"
    "tencent_secret_id:腾讯云 SecretId (AKID开头)"
    "tencent_secret_key:腾讯云 SecretKey"
    "tencent_sms_app_id:腾讯云短信 AppId (未开通可留空)"
    "volc_streaming_asr_api_key:火山引擎·短语音识别·流式 sauc 的 Access Key（控制台「语音技术→短语音识别」产品下开通获取，UUID 格式；与 volc_realtime_api_key 不是同一把 key，不通用）"
    "volc_realtime_api_key:火山引擎·实时语音大模型 dialog 的 Access Key（控制台「语音技术→实时语音大模型」产品下开通获取，UUID 格式；与 volc_streaming_asr_api_key 不是同一把 key，不通用）"
    "jwt_secret:JWT 签名密钥 (openssl rand -hex 64 输出,≥32 字节熵)"
)

# ── 参数解析 ──
MODE="default"        # default | force | check | show-names
ONLY_NAME=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --force)          MODE="force"; shift ;;
        --check)          MODE="check"; shift ;;
        --show-names)     MODE="show-names"; shift ;;
        --only)           MODE="only"; ONLY_NAME="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,28p' "$0"
            exit 0
            ;;
        *)
            echo "未知参数: $1" >&2
            echo "执行 $0 --help 查看用法" >&2
            exit 2
            ;;
    esac
done

# ── --show-names: 只输出文件名清单 ──
if [[ "$MODE" == "show-names" ]]; then
    for entry in "${SECRETS[@]}"; do
        echo "${entry%%:*}"
    done
    exit 0
fi

# ── --check: 校验所有 key 文件是否存在(空文件也算 OK,容许有意留空的字段)──
if [[ "$MODE" == "check" ]]; then
    missing=()
    empty=()
    for entry in "${SECRETS[@]}"; do
        name="${entry%%:*}"
        path="${SECRETS_DIR}/${name}"
        if [[ ! -e "$path" ]]; then
            missing+=("$name")
        elif [[ ! -s "$path" ]]; then
            empty+=("$name")
        fi
    done
    if [[ ${#missing[@]} -eq 0 && ${#empty[@]} -eq 0 ]]; then
        echo "✅ 全部 ${#SECRETS[@]} 个 secret 都有值"
    else
        [[ ${#missing[@]} -gt 0 ]] && echo "❌ 缺少 ${#missing[@]} 个 secret 文件:" && \
            for n in "${missing[@]}"; do echo "   - $n"; done
        [[ ${#empty[@]} -gt 0 ]] && echo "⚠️  ${#empty[@]} 个 secret 文件存在但为空(走 config.py 默认):" && \
            for n in "${empty[@]}"; do echo "   - $n"; done
    fi
    ls -la "$SECRETS_DIR"
    # 只要有缺失就 exit 1,空文件不阻塞(可能是故意留空)
    [[ ${#missing[@]} -eq 0 ]] && exit 0 || exit 1
fi

# ── 确保 secrets 目录存在 + 权限 ──
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

# ── 单文件写入函数(幂等,既有值且非 --force 时跳过)──
write_secret() {
    local name="$1"
    local desc="$2"
    local path="${SECRETS_DIR}/${name}"

    if [[ -s "$path" && "$MODE" != "force" ]]; then
        echo "   跳过(已有值,需覆盖请用 --force)"
        return 0
    fi

    echo
    echo "── ${name} ──"
    echo "   用途: ${desc}"
    # 一次性读取:空值也接受(会建空文件,docker compose 需要文件存在)
    # 不再 retry — 一次 Enter 就确定,避免误触
    local val=""
    read -r -s -p "   请输入(不回显,留空 = 写空文件): " val
    echo
    # 空值也照写,Docker 容器里 secrets.py 会读到空字符串,
    # pydantic-settings 走 config.py 默认值。比"不写文件"安全
    # ——后者会导致 docker compose 启动时报 bind source not exist。

    printf '%s' "$val" > "$path"
    chmod 600 "$path"
    if [[ -z "$val" ]]; then
        echo "   ✅ 已写入空文件(走 config.py 默认值,权限 600)"
    else
        echo "   ✅ 已写入(权限 600)"
    fi
}

# ── --only: 只写单个 ──
if [[ "$MODE" == "only" ]]; then
    found=0
    for entry in "${SECRETS[@]}"; do
        if [[ "${entry%%:*}" == "$ONLY_NAME" ]]; then
            # --only 模式强制重写(因为是显式指定)
            path="${SECRETS_DIR}/${ONLY_NAME}"
            [[ -s "$path" ]] && echo "⚠️  覆盖已有值: ${ONLY_NAME}"
            MODE="force"
            write_secret "$ONLY_NAME" "${entry#*:}"
            found=1
            break
        fi
    done
    if [[ $found -eq 0 ]]; then
        echo "❌ 未知 key: $ONLY_NAME" >&2
        echo "可用列表:" >&2
        for entry in "${SECRETS[@]}"; do
            echo "   ${entry%%:*}" >&2
        done
        exit 1
    fi
    exit 0
fi

# ── 默认模式:遍历所有 key,空的或 --force 才写 ──
echo "将处理 ${#SECRETS[@]} 个敏感 key"
echo "已有值的会被跳过,需要全部重写请加 --force"
echo "────────────────────────────────────────"
for entry in "${SECRETS[@]}"; do
    write_secret "${entry%%:*}" "${entry#*:}"
done

# ── 收尾校验 ──
echo
echo "────────────────────────────────────────"
echo "📋 写入结果:"
ls -la "$SECRETS_DIR" | tail -n +2
echo
"$0" --check
