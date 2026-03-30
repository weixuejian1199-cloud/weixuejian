#!/usr/bin/env bash
# ============================================================
# 企业AI工作站 — PostgreSQL 备份恢复脚本
# 用途：从本地文件或阿里云 OSS 拉取备份并恢复
# 运行：bash scripts/restore.sh [日期]
#   例：bash scripts/restore.sh 2026-03-30
#       bash scripts/restore.sh /path/to/specific.dump
# ============================================================
set -euo pipefail

# --------------------------------------------------
# 1. 配置
# --------------------------------------------------
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-enterprise_workstation}"
DB_USER="${DB_USER:-postgres}"
export PGPASSWORD="${DB_PASSWORD:?ERROR: DB_PASSWORD 环境变量未设置}"

BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
OSS_BUCKET="${OSS_BUCKET:-}"
OSS_ENDPOINT="${OSS_ENDPOINT:-oss-cn-beijing.aliyuncs.com}"
OSS_BACKUP_PREFIX="${OSS_BACKUP_PREFIX:-backups}"

# --------------------------------------------------
# 2. 参数解析
# --------------------------------------------------
usage() {
    echo "用法: $0 [日期|文件路径]"
    echo ""
    echo "参数:"
    echo "  日期       格式 YYYY-MM-DD，从本地或 OSS 查找对应备份"
    echo "  文件路径   直接指定 .dump 文件"
    echo ""
    echo "示例:"
    echo "  $0 2026-03-30          # 恢复3月30日的备份"
    echo "  $0 /data/backups/daily/2026-03-30.dump"
    echo ""
    echo "环境变量:"
    echo "  DB_PASSWORD    (必须) 数据库密码"
    echo "  DB_HOST        数据库主机 (默认: postgres)"
    echo "  DB_NAME        数据库名 (默认: enterprise_workstation)"
    echo "  OSS_BUCKET     OSS 存储桶 (为空则不从 OSS 拉取)"
    exit 1
}

if [[ $# -lt 1 ]]; then
    usage
fi

INPUT="$1"
RESTORE_FILE=""

# --------------------------------------------------
# 3. 定位备份文件
# --------------------------------------------------
if [[ -f "${INPUT}" ]]; then
    # 直接指定了文件路径
    RESTORE_FILE="${INPUT}"
    echo "[RESTORE] 使用指定文件: ${RESTORE_FILE}"

elif [[ "${INPUT}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    # 输入是日期，按优先级查找：本地日备份 → 本地月备份 → OSS
    TARGET_DATE="${INPUT}"
    LOCAL_DAILY="${BACKUP_DIR}/daily/${TARGET_DATE}.dump"
    LOCAL_MONTHLY="${BACKUP_DIR}/monthly/${TARGET_DATE}.dump"

    if [[ -f "${LOCAL_DAILY}" ]]; then
        RESTORE_FILE="${LOCAL_DAILY}"
        echo "[RESTORE] 找到本地日备份: ${RESTORE_FILE}"

    elif [[ -f "${LOCAL_MONTHLY}" ]]; then
        RESTORE_FILE="${LOCAL_MONTHLY}"
        echo "[RESTORE] 找到本地月备份: ${RESTORE_FILE}"

    elif [[ -n "${OSS_BUCKET}" ]]; then
        # 尝试从 OSS 下载
        if ! command -v ossutil &> /dev/null; then
            echo "[ERROR] 本地无备份且 ossutil 未安装，无法从 OSS 拉取" >&2
            exit 1
        fi

        OSS_DAILY="oss://${OSS_BUCKET}/${OSS_BACKUP_PREFIX}/daily/${TARGET_DATE}.dump"
        OSS_MONTHLY="oss://${OSS_BUCKET}/${OSS_BACKUP_PREFIX}/monthly/${TARGET_DATE}.dump"
        TMP_FILE="/tmp/restore_${TARGET_DATE}.dump"

        echo "[RESTORE] 本地无备份，尝试从 OSS 下载..."
        if ossutil cp "${OSS_DAILY}" "${TMP_FILE}" -e "${OSS_ENDPOINT}" --force 2>/dev/null; then
            RESTORE_FILE="${TMP_FILE}"
            echo "[RESTORE] 已从 OSS 下载日备份: ${OSS_DAILY}"
        elif ossutil cp "${OSS_MONTHLY}" "${TMP_FILE}" -e "${OSS_ENDPOINT}" --force 2>/dev/null; then
            RESTORE_FILE="${TMP_FILE}"
            echo "[RESTORE] 已从 OSS 下载月备份: ${OSS_MONTHLY}"
        else
            echo "[ERROR] OSS 上也找不到 ${TARGET_DATE} 的备份" >&2
            exit 1
        fi
    else
        echo "[ERROR] 找不到 ${TARGET_DATE} 的备份文件（本地无文件，OSS 未配置）" >&2
        exit 1
    fi
else
    echo "[ERROR] 无效参数: ${INPUT}" >&2
    echo "  请提供日期（YYYY-MM-DD）或 .dump 文件路径"
    exit 1
fi

# --------------------------------------------------
# 4. 安全确认（防误操作）
# --------------------------------------------------
FILE_SIZE=$(du -h "${RESTORE_FILE}" | cut -f1)
echo ""
echo "========================================"
echo "  !! 危险操作：数据库恢复 !!"
echo "========================================"
echo "  目标数据库: ${DB_NAME}@${DB_HOST}:${DB_PORT}"
echo "  备份文件:   ${RESTORE_FILE} (${FILE_SIZE})"
echo "  操作:       DROP 所有现有数据，从备份恢复"
echo "========================================"
echo ""

# 如果设置了 RESTORE_CONFIRM=yes 则跳过交互确认（用于自动化）
if [[ "${RESTORE_CONFIRM:-}" == "yes" ]]; then
    echo "[RESTORE] RESTORE_CONFIRM=yes，跳过交互确认"
else
    read -r -p "确认恢复？输入 YES 继续: " CONFIRM
    if [[ "${CONFIRM}" != "YES" ]]; then
        echo "[RESTORE] 已取消"
        exit 0
    fi
fi

# --------------------------------------------------
# 5. 执行恢复
# --------------------------------------------------
echo "[RESTORE] 开始恢复 ${DB_NAME}..."
echo "[RESTORE] 时间: $(date '+%Y-%m-%d %H:%M:%S')"

# 使用 pg_restore：--clean 先删除再创建，--if-exists 避免对象不存在报错
if ! pg_restore \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    -j 2 \
    "${RESTORE_FILE}"; then
    echo "[ERROR] pg_restore 失败！" >&2
    echo "[HINT] 如果是部分表报错，可能是因为备份版本与当前 schema 不一致" >&2
    exit 1
fi

echo "[RESTORE] 恢复完成 ✓"
echo "[RESTORE] 时间: $(date '+%Y-%m-%d %H:%M:%S')"

# 清理临时文件
if [[ "${RESTORE_FILE}" == /tmp/restore_*.dump ]]; then
    rm -f "${RESTORE_FILE}"
    echo "[RESTORE] 已清理临时文件"
fi

exit 0
