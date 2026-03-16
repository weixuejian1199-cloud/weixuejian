# ATLAS 智能报表系统

**AI 驱动的智能数据分析与报表生成平台**

---

## 🚀 快速开始

### 访问网站
https://atlascore.cn

### 本地开发
```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建生产版本
pnpm build
```

---

## 📋 项目简介

ATLAS 是一个智能报表系统，具备以下核心能力：

1. **文件上传** - 支持 Excel/CSV 文件上传
2. **自动解析** - AI 自动识别数据结构和业务场景
3. **智能分析** - 自动计算关键指标和统计口径
4. **报表生成** - 一键生成专业报表
5. **数据导出** - 支持全量数据导出（Excel 格式）

---

## 🏗️ 技术架构

### 前端
- **框架**：React + Vite
- **UI 库**：Radix UI + Tailwind CSS
- **状态管理**：React Query

### 后端
- **运行时**：Node.js + Express
- **数据库**：MySQL + Drizzle ORM
- **AI 集成**：阿里百炼（通义千问）
- **部署**：PM2 + Nginx

### 基础设施
- **云服务**：阿里云 ECS（北京）
- **存储**：对象存储 S3
- **HTTPS**：Let's Encrypt

---

## 📁 文档导航

| 文档 | 说明 |
|------|------|
| [核心信息](./docs/CORE.md) | **必读** - 服务器、密钥、GitHub 等关键信息 |
| [部署手册](./docs/DEPLOY.md) | 部署流程、运维命令、故障处理 |
| [开发规范](./docs/DEV.md) | 开发环境、代码规范、提交流程 |
| [API 文档](./docs/API.md) | 接口文档、请求示例 |
| [变更日志](./docs/CHANGELOG.md) | 版本历史记录 |
| [架构设计](./docs/ARCHITECTURE.md) | 系统架构、技术选型 |

---

## 🤖 项目团队

| 角色 | 职责 |
|------|------|
| **大魏** | 项目开发、架构设计、决策 |
| **AI 助手** | 代码审查、文档维护、问题分析 |
| **Manus** | 自动部署、运维监控 |

---

## 🔒 安全提醒

1. **密钥文件** 存储在 `secrets/` 目录，已加入 `.gitignore`
2. **禁止上传** 任何密钥、密码到 GitHub
3. **生产环境** 变量通过 SSH 管理

---

## 📊 当前状态

| 项目 | 状态 |
|------|------|
| **生产环境** | ✅ 运行中 (v3.1.0) |
| **服务器** | ✅ 阿里云 ECS (8.131.109.208) |
| **HTTPS 证书** | ✅ 有效 (至 2026-06-14) |
| **最近部署** | 2026-03-16 |

---

## 🛠️ 快速命令

### 部署
```bash
# 连接服务器
ssh -i secrets/atlas-key.pem root@8.131.109.208

# 部署最新代码
cd /root/atlas-report && git pull && npx vite build && esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist && pm2 restart atlas
```

### 查看日志
```bash
pm2 logs atlas --lines 50 --nostream
```

---

## 📝 开发规范

### Git 提交格式
```
feat: 新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式调整
refactor: 重构代码
test: 测试相关
chore: 构建/工具链相关
```

### 示例
```bash
git commit -m "fix: 修复数据导出截断问题"
git commit -m "feat: 添加多文件合并导出功能"
```

---

## 🔗 相关链接

- **GitHub 仓库**：https://github.com/weixuejian1199-cloud/weixuejian
- **生产环境**：https://atlascore.cn
- **阿里云控制台**：https://ecs.console.aliyun.com/

---

*ATLAS - 让数据分析更智能*
