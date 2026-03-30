#!/bin/sh
set -e

echo "=== Enterprise Workstation Entrypoint ==="

# 生产环境：自动运行数据库迁移
if [ "$NODE_ENV" = "production" ]; then
  echo "Running database migrations..."
  npx prisma migrate deploy --schema=packages/backend/prisma/schema.prisma
  echo "Migrations complete."
fi

echo "Starting server..."
exec "$@"
