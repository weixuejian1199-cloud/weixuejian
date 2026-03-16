# ATLAS 智能报表系统 - 项目核心信息

**版本：** v3.1 | **创建日期：** 2026-03-16 | **维护：** AI 助手团队

---

## 📍 快速访问（最重要！）

### 服务器信息
| 项目 | 内容 |
|------|------|
| **云服务商** | 阿里云 ECS |
| **地域** | 华北 2（北京） |
| **公网 IP** | `8.131.109.208` |
| **操作系统** | Ubuntu 24.04 64 位 |
| **规格** | 2 核 4GB |
| **登录用户** | `root` |
| **项目目录** | `/root/atlas-report/` |
| **网站地址** | https://atlascore.cn |

### 密钥位置
- **SSH 私钥**：`/Users/weixuejian/.openclaw/workspace/atlas-saas/secrets/atlas-key.pem`
- **权限**：`chmod 600`

### GitHub 仓库
- **仓库地址**：https://github.com/weixuejian1199-cloud/weixuejian
- **分支**：`main`
- **用途**：仅存放代码，不存放配置文件和密钥

---

## 🔧 常用命令

### 连接服务器
```bash
ssh -i /Users/weixuejian/.openclaw/workspace/atlas-saas/secrets/atlas-key.pem root@8.131.109.208
```

### 部署流程
```bash
# 1. 连接服务器
ssh -i /Users/weixuejian/.openclaw/workspace/atlas-saas/secrets/atlas-key.pem root@8.131.109.208

# 2. 进入项目目录
cd /root/atlas-report

# 3. 拉取最新代码
git pull origin main

# 4. 构建前端
npx vite build

# 5. 构建后端
esbuild server/_core/index.ts \
  --platform=node \
  --packages=external \
  --bundle \
  --format=esm \
  --outdir=dist

# 6. 重启服务
pm2 restart atlas

# 7. 验证
pm2 status
curl -o /dev/null -w "HTTP: %{http_code}\n" https://atlascore.cn/
```

### 查看日志
```bash
# 实时日志
pm2 logs atlas

# 最近 50 行
pm2 logs atlas --lines 50 --nostream
```

---

## 📁 本地文档结构

```
/Users/weixuejian/.openclaw/workspace/atlas-saas/
├── docs/                    # 项目文档
│   ├── CORE.md             # 本项目核心信息（本文件）
│   ├── DEPLOY.md           # 部署运维手册
│   ├── DEV.md              # 开发规范
│   ├── API.md              # API 文档
│   ├── CHANGELOG.md        # 变更日志
│   └── ARCHITECTURE.md     # 架构设计
├── secrets/                 # 密钥文件（.gitignore 保护）
│   ├── atlas-key.pem       # SSH 私钥
│   └── .env.production     # 生产环境变量
└── README.md               # 项目说明
```

---

## 🤖 协作团队

| 角色 | 职责 |
|------|------|
| **大魏** | 项目开发、架构设计、决策 |
| **AI 助手** | 代码审查、文档维护、问题分析、CHANGELOG |
| **Manus** | 自动部署、运维监控 |

---

## ⚠️ 安全约束

1. **禁止重启服务器** - 2026-03-16 约定（AI 助手承诺）
2. **密钥不上传 GitHub** - 仅本地存储
3. **配置修改前告知** - 需要用户确认
4. **生产环境变量** - 通过 SSH 管理，不落地

---

## 📊 系统状态检查

```bash
# 服务状态
pm2 status

# 系统资源
df -h
free -h
top

# Nginx 状态
systemctl status nginx

# HTTPS 证书
certbot certificates
```

---

## 🔗 相关文档

- [部署运维手册](./DEPLOY.md)
- [开发规范](./DEV.md)
- [API 文档](./API.md)
- [变更日志](./CHANGELOG.md)
- [架构设计](./ARCHITECTURE.md)

---

*本文档是 ATLAS 项目的核心信息入口，所有团队成员必须熟悉。*
