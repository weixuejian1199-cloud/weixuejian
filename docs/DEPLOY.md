# ATLAS 智能报表系统 — 部署运维手册

**版本：** v3.1 | **更新日期：** 2026-03-16 | **维护：** Manus

---

## 一、服务器基本信息

| 项目 | 内容 |
|------|------|
| 云服务商 | 阿里云 ECS |
| 地域 | 华北 2（北京） |
| 公网 IP | `8.131.109.208` |
| 操作系统 | Ubuntu 24.04 64 位 |
| 规格 | 2 核 4GB |
| 登录用户名 | `root` |
| 项目目录 | `/root/atlas-report/` |
| 网站地址 | https://atlascore.cn |
| GitHub 仓库 | https://github.com/weixuejian1199-cloud/weixuejian |

---

## 二、连接服务器

### 方式一：阿里云 Workbench（推荐，无需安装工具）

1. 打开 [阿里云 ECS 控制台](https://ecs.console.aliyun.com/)
2. 找到实例 `launch-advisor-20260316` → 点「**远程连接**」
3. 选「**通过 Workbench 远程连接**」
4. 输入密码，点连接

### 方式二：SSH 工具（Termius / FinalShell / Xshell）

```
主机（Host）：8.131.109.208
端口（Port）：22
用户名：root
密钥：~/.openclaw/workspace/atlas-saas/secrets/atlas-key.pem
```

### 命令行 SSH

```bash
ssh -i /Users/weixuejian/.openclaw/workspace/atlas-saas/secrets/atlas-key.pem root@8.131.109.208
```

---

## 三、标准发布流程（手动）

> 每次推送新代码到 GitHub 后，按以下步骤操作。

### 第一步：进入项目目录

```bash
cd /root/atlas-report
```

### 第二步：拉取最新代码

```bash
git pull origin main
```

### 第三步：构建前端

```bash
npx vite build
```

### 第四步：构建后端

```bash
esbuild server/_core/index.ts \
  --platform=node \
  --packages=external \
  --bundle \
  --format=esm \
  --outdir=dist
```

### 第五步：重启服务

```bash
pm2 restart atlas
```

### 第六步：验证发布结果

```bash
# 查看服务状态
pm2 status

# 查看最新日志
pm2 logs atlas --lines 10 --nostream

# 测试本地响应
curl -o /dev/null -w "HTTP 状态码：%{http_code}\n" http://localhost:3000/
```

---

## 四、常用运维命令速查

### 服务管理

| 命令 | 作用 |
|------|------|
| `pm2 status` | 查看所有服务状态 |
| `pm2 restart atlas` | 重启 ATLAS 服务 |
| `pm2 stop atlas` | 停止 ATLAS 服务 |
| `pm2 start atlas` | 启动 ATLAS 服务 |
| `pm2 logs atlas` | 查看实时日志（Ctrl+C 退出） |
| `pm2 logs atlas --lines 20 --nostream` | 查看最近 20 行日志 |
| `pm2 monit` | 可视化监控界面 |

### 代码管理

| 命令 | 作用 |
|------|------|
| `git log --oneline -5` | 查看最近 5 个提交记录 |
| `git pull origin main` | 拉取 GitHub 最新代码 |
| `git status` | 查看本地代码变更状态 |
| `git reset --hard <commit>` | 回滚到指定版本 |

### 系统状态

| 命令 | 作用 |
|------|------|
| `df -h` | 查看磁盘使用情况 |
| `free -h` | 查看内存使用情况 |
| `top` | 查看 CPU/内存实时占用（q 退出） |
| `htop` | 增强版 top（需安装） |
| `systemctl status nginx` | 查看 Nginx 状态 |
| `systemctl reload nginx` | 重载 Nginx 配置 |
| `systemctl restart nginx` | 重启 Nginx |

---

## 五、Manus 自动发布流程（日常使用）

> 正常情况下，由 Manus 负责所有发布操作，无需手动操作。

**流程：**

1. **开发完成** → `git push` 推送到 GitHub
2. **通知 Manus** - 在对话中发送「部署最新代码」
3. **Manus 自动完成**：拉取 → 验证 → 测试 → 构建 → 部署 → 验证 → 汇报
4. **网站自动更新**

---

## 六、紧急故障处理

### 网站打不开

```bash
# 1. 检查服务状态
pm2 status

# 2. 如果状态不是 online，重启服务
pm2 restart atlas

# 3. 查看错误日志
pm2 logs atlas --lines 30 --nostream

# 4. 检查 Nginx
systemctl status nginx
systemctl restart nginx
```

### 发布后出现报错

```bash
# 回滚到上一个版本
cd /root/atlas-report
git log --oneline -5              # 查看提交记录
git reset --hard <commit_hash>    # 回滚到指定版本
npx vite build                     # 重新构建前端
esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
pm2 restart atlas                  # 重启服务
```

### 服务器无法连接

1. 检查阿里云 ECS 实例状态
2. 检查安全组规则（22 端口）
3. 通过阿里云 VNC 连接

---

## 七、环境变量配置

环境变量存储在服务器的 `/root/atlas-report/.env` 文件中。

```bash
# 查看当前环境变量
cat /root/atlas-report/.env

# 编辑环境变量
nano /root/atlas-report/.env
# 编辑完成后按 Ctrl+X → Y → Enter 保存

# 重启服务使其生效
pm2 restart atlas
```

**关键环境变量：**

| 变量名 | 说明 |
|--------|------|
| `DASHSCOPE_API_KEY` | 阿里百炼 AI Key |
| `DATABASE_URL` | MySQL 数据库连接 |
| `JWT_SECRET` | 登录 Token 密钥 |
| `OPENCLAW_API_KEY` | OpenClaw API Key（预留） |
| `SMTP_*` | 邮件配置（预留） |

---

## 八、HTTPS 证书

证书由 Let's Encrypt 免费提供，**已配置自动续期**。

- 证书路径：`/etc/letsencrypt/live/atlascore.cn/`
- 自动续期：到期前自动执行

如需手动续期：
```bash
certbot renew
systemctl reload nginx
```

---

## 九、监控与告警

### 服务监控

```bash
# 查看 PM2 服务状态
pm2 status

# 查看资源占用
pm2 monit
```

### 日志分析

```bash
# 搜索错误日志
pm2 logs atlas | grep -i error

# 查看特定时间段日志
pm2 logs atlas --since "2026-03-16 10:00:00"
```

---

## 十、备份策略

### 数据库备份

```bash
# 手动备份数据库
mysqldump -u root -p atlas_db > /root/backups/atlas_$(date +%Y%m%d_%H%M%S).sql

# 定期备份（添加到 crontab）
0 2 * * * mysqldump -u root -p atlas_db > /root/backups/atlas_$(date +\%Y\%m\%d_\%H\%M\%S).sql
```

### 配置文件备份

```bash
# 备份 .env 文件
cp /root/atlas-report/.env /root/backups/env_$(date +%Y%m%d_%H%M%S)
```

---

*本文档由 Manus 整理，AI 助手维护。*
