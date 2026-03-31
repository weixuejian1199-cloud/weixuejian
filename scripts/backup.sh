#!/usr/bin/env bash
# ============================================================
# 企业AI工作站 — PostgreSQL 全量备份脚本
# 用途：pg_dump 压缩备份 → 本地保留 → 上传阿里云 OSS
# 运行：bash scripts/backup.sh  或  在 Docker 容器内执行
# ============================================================
set -euo pipefail

# --------------------------------------------------
# 1. 配置（优先读环境变量，兜底默认值）
# --------------------------------------------------
# 数据库连接（Docker 内部走容器名，外部走 localhost）
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-enterprise_workstation}"
DB_USER="${DB_USER:-postgres}"
# PGPASSWORD 由环境变量传入，不要硬编码
export PGPASSWORD="${DB_PASSWORD:?ERROR: DB_PASSWORD 环境变量未设置}"

# 备份目录（宿主机挂载或容器内路径）
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
# OSS 配置
OSS_BUCKET="${OSS_BUCKET:-}"
OSS_ENDPOINT="${OSS_ENDPOINT:-oss-cn-beijing.aliyuncs.com}"
OSS_BACKUP_PREFIX="${OSS_BACKUP_PREFIX:-backups}"
# 企微 Webhook（Phase 2 接入，当前仅预留）
WECOM_WEBHOOK_URL="${WECOM_WEBHOOK_URL:-}"

# 保留策略
DAILY_RETENTION_DAYS="${DAILY_RETENTION_DAYS:-30}"
MONTHLY_RETENTION_DAYS="${MONTHLY_RETENTION_DAYS:-365}"

# --------------------------------------------------
# 2. 准备目录和文件名
# --------------------------------------------------
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAY_OF_MONTH=$(date +%d)

DAILY_DIR="${BACKUP_DIR}/daily"
MONTHLY_DIR="${BACKUP_DIR}/monthly"
mkdir -p "${DAILY_DIR}" "${MONTHLY_DIR}"

BACKUP_FILE="${DAILY_DIR}/${DATE}.dump"

# --------------------------------------------------
# 3. 企微告警函数（Phase 2 接入，当前空实现）
# --------------------------------------------------
notify_wecom() {
    local message="$1"
    local msg_type="${2:-info}"  # info / error

    if [[ -z "${WECOM_WEBHOOK_URL}" ]]; then
        echo "[NOTIFY] 企微 Webhook 未配置，跳过告警: ${message}"
        return 0
    fi

    # Phase 2: 取消注释以下代码启用企微通知
    # local color="info"
    # [[ "${msg_type}" == "error" ]] && color="warning"
    # curl -s -X POST "${WECOM_WEBHOOK_URL}" \
    #     -H "Content-Type: application/json" \
    #     -d "{
    #         \"msgtype\": \"markdown\",
    #         \"markdown\": {
    #             \"content\": \"### 数据库备份${msg_type == 'error' ? '失败' : '完成'}\n> ${message}\"
    #         }
    #     }"
    echo "[NOTIFY] 企微告警(${msg_type}): ${message}"
}

# --------------------------------------------------
# 4. 执行 pg_dump 全量备份
# --------------------------------------------------
echo "[BACKUP] 开始备份 ${DB_NAME} → ${BACKUP_FILE}"
echo "[BACKUP] 时间: $(date '+%Y-%m-%d %H:%M:%S')"

if ! pg_dump \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    -Fc \
    -Z 6 \
    -f "${BACKUP_FILE}"; then
    echo "[ERROR] pg_dump 失败！" >&2
    notify_wecom "pg_dump 备份失败 (${DB_NAME}@${DB_HOST})" "error"
    exit 1
fi

BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "[BACKUP] 备份完成: ${BACKUP_FILE} (${BACKUP_SIZE})"

# 验证备份文件有效性
if command -v pg_restore &> /dev/null; then
  if ! pg_restore -l "${BACKUP_FILE}" > /dev/null 2>&1; then
    echo "[ERROR] 备份文件损坏或无效: ${BACKUP_FILE}"
    exit 1
  fi
  echo "[BACKUP] 备份文件验证通过"
fi

# --------------------------------------------------
# 5. 月备份：每月1号额外复制一份到 monthly/
# --------------------------------------------------
if [[ "${DAY_OF_MONTH}" == "01" ]]; then
    MONTHLY_FILE="${MONTHLY_DIR}/${DATE}.dump"
    cp "${BACKUP_FILE}" "${MONTHLY_FILE}"
    echo "[BACKUP] 月备份已创建: ${MONTHLY_FILE}"
fi

# --------------------------------------------------
# 6. 上传到阿里云 OSS
# --------------------------------------------------
upload_to_oss() {
    if [[ -z "${OSS_BUCKET}" ]]; then
        echo "[OSS] OSS_BUCKET 未配置，跳过上传"
        return 0
    fi

    # 检查 ossutil 是否可用
    if ! command -v ossutil &> /dev/null; then
        echo "[OSS] ossutil 未安装，跳过上传。安装指南: https://help.aliyun.com/document_detail/120075.html" >&2
        notify_wecom "ossutil 未安装，OSS 上传跳过" "error"
        return 1
    fi

    local oss_daily_path="oss://${OSS_BUCKET}/${OSS_BACKUP_PREFIX}/daily/${DATE}.dump"
    echo "[OSS] 上传到 ${oss_daily_path}"

    if ! ossutil cp "${BACKUP_FILE}" "${oss_daily_path}" \
        -e "${OSS_ENDPOINT}" \
        --force; then
        echo "[ERROR] OSS 上传失败！" >&2
        notify_wecom "OSS 上传失败: ${oss_daily_path}" "error"
        return 1
    fi

    echo "[OSS] 上传成功"

    # 月备份也上传一份
    if [[ "${DAY_OF_MONTH}" == "01" ]]; then
        local oss_monthly_path="oss://${OSS_BUCKET}/${OSS_BACKUP_PREFIX}/monthly/${DATE}.dump"
        ossutil cp "${BACKUP_FILE}" "${oss_monthly_path}" \
            -e "${OSS_ENDPOINT}" \
            --force
        echo "[OSS] 月备份已上传: ${oss_monthly_path}"
    fi
}

if ! upload_to_oss; then
  echo "[WARN] OSS上传失败，本地备份已保存: ${BACKUP_FILE}"
fi

# --------------------------------------------------
# 7. 本地备份清理（保留策略）
# --------------------------------------------------
echo "[CLEANUP] 清理过期备份..."

# 日备份：保留 N 天
DAILY_DELETED=$(find "${DAILY_DIR}" -name "*.dump" -type f -mtime "+${DAILY_RETENTION_DAYS}" -print -delete | wc -l)
echo "[CLEANUP] 已删除 ${DAILY_DELETED} 个过期日备份（>${DAILY_RETENTION_DAYS}天）"

# 月备份：保留 N 天（默认365天=1年）
MONTHLY_DELETED=$(find "${MONTHLY_DIR}" -name "*.dump" -type f -mtime "+${MONTHLY_RETENTION_DAYS}" -print -delete | wc -l)
echo "[CLEANUP] 已删除 ${MONTHLY_DELETED} 个过期月备份（>${MONTHLY_RETENTION_DAYS}天）"

# --------------------------------------------------
# 8. 完成
# --------------------------------------------------
echo "[BACKUP] 全部完成 ✓"
echo "[BACKUP] 文件: ${BACKUP_FILE} (${BACKUP_SIZE})"
notify_wecom "备份成功: ${DB_NAME} (${BACKUP_SIZE}), 清理日备份${DAILY_DELETED}个/月备份${MONTHLY_DELETED}个" "info"

exit 0
