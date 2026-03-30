# ============================================================
# 企业AI工作站 Makefile — 常用命令快捷入口
# ============================================================

.PHONY: dev dev-down build test lint format db-migrate db-seed logs ps clean

# --- 开发环境 ---

dev: ## 启动开发环境 (backend + postgres + redis, 热重载)
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

dev-down: ## 停止开发环境
	docker compose -f docker-compose.yml -f docker-compose.dev.yml down

dev-bg: ## 后台启动开发环境
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d

# --- 构建与测试 ---

build: ## 构建生产镜像
	docker compose build backend

test: ## 运行测试
	pnpm test

lint: ## 运行 ESLint
	pnpm lint

format: ## 格式化代码
	pnpm format

# --- 数据库 ---

db-migrate: ## 运行 Prisma migration
	pnpm db:migrate

db-seed: ## 运行数据库 seed
	pnpm db:seed

db-studio: ## 打开 Prisma Studio (数据库可视化)
	pnpm --filter backend exec prisma studio

# --- Bridge ---

bridge-start: ## 启动飞书 Bridge (tmux)
	./deploy/bridge/start.sh start

bridge-stop: ## 停止飞书 Bridge
	./deploy/bridge/start.sh stop

bridge-restart: ## 重启飞书 Bridge
	./deploy/bridge/start.sh restart

bridge-status: ## 查看 Bridge 状态
	./deploy/bridge/start.sh status

bridge-logs: ## 查看 Bridge 日志
	./deploy/bridge/start.sh logs

# --- 日志与状态 ---

logs: ## 查看所有容器日志
	docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f

logs-backend: ## 仅查看 backend 日志
	docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f backend

ps: ## 查看容器状态
	docker compose -f docker-compose.yml -f docker-compose.dev.yml ps

# --- 清理 ---

clean: ## 停止容器并删除 volumes (危险: 会清空数据库!)
	docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v

# --- 帮助 ---

help: ## 显示帮助
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
