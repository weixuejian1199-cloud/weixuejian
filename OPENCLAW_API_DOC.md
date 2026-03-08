# ATLAS 管理员 API 对接文档

> 供 OpenClaw 接入 ATLAS 系统使用。所有接口均通过 Bearer Token 鉴权。

---

## 鉴权信息

| 项目 | 值 |
|------|-----|
| API Key | `atlas_admin_3384031b89e16989d665fcb4034e3ba416f52eb8fc209aa1` |
| 鉴权方式 | HTTP Header: `Authorization: Bearer <API_KEY>` |
| Base URL | `https://atlasrepo-cryfqh5q.manus.space/api/admin` |

所有请求必须携带 `Authorization` 头，否则返回 `401 Unauthorized`。

---

## 接口列表

### 1. 查询用户列表

**GET** `/api/admin/users`

查询所有注册用户，支持分页。

**Query 参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | number | 1 | 页码 |
| limit | number | 50 | 每页条数（最大 100） |

**请求示例：**
```bash
curl -H "Authorization: Bearer atlas_admin_3384031b89e16989d665fcb4034e3ba416f52eb8fc209aa1" \
  "https://atlasrepo-cryfqh5q.manus.space/api/admin/users?page=1&limit=20"
```

**返回示例：**
```json
{
  "data": [
    {
      "id": 1,
      "username": "user001",
      "name": "张三",
      "email": null,
      "role": "user",
      "plan": "free",
      "credits": 1000,
      "inviteCode": "ABC123",
      "createdAt": "2026-03-08T00:00:00.000Z",
      "lastSignedIn": "2026-03-08T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```

---

### 2. 修改用户角色

**PATCH** `/api/admin/users/:id/role`

将指定用户提升为管理员或降级为普通用户。

**路径参数：**

| 参数 | 说明 |
|------|------|
| id | 用户 ID（整数） |

**Body 参数（JSON）：**

| 参数 | 类型 | 说明 |
|------|------|------|
| role | string | `"admin"` 或 `"user"` |

**请求示例：**
```bash
curl -X PATCH \
  -H "Authorization: Bearer atlas_admin_3384031b89e16989d665fcb4034e3ba416f52eb8fc209aa1" \
  -H "Content-Type: application/json" \
  -d '{"role": "admin"}' \
  "https://atlasrepo-cryfqh5q.manus.space/api/admin/users/5/role"
```

**返回示例：**
```json
{
  "success": true,
  "user": {
    "id": 5,
    "username": "user005",
    "role": "admin"
  }
}
```

---

### 3. 查询用户反馈列表

**GET** `/api/admin/feedback`

查询所有用户的 👍/👎 消息反馈，按时间倒序排列。

**Query 参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | number | 1 | 页码 |
| limit | number | 50 | 每页条数（最大 100） |

**请求示例：**
```bash
curl -H "Authorization: Bearer atlas_admin_3384031b89e16989d665fcb4034e3ba416f52eb8fc209aa1" \
  "https://atlasrepo-cryfqh5q.manus.space/api/admin/feedback?limit=20"
```

**返回示例：**
```json
{
  "data": [
    {
      "id": "abc123",
      "userId": 3,
      "rating": -1,
      "messagePreview": "帮我计算哪些用户达标...",
      "comment": "AI 没有给出计算结果",
      "context": "main_workspace",
      "createdAt": "2026-03-08T09:15:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 8,
    "pages": 1
  }
}
```

> `rating` 字段：`1` 表示 👍（满意），`-1` 表示 👎（有问题）

---

### 4. 查询系统统计

**GET** `/api/admin/stats`

返回系统整体运行数据，包括今日新增、任务状态分布、反馈统计。

**请求示例：**
```bash
curl -H "Authorization: Bearer atlas_admin_3384031b89e16989d665fcb4034e3ba416f52eb8fc209aa1" \
  "https://atlasrepo-cryfqh5q.manus.space/api/admin/stats"
```

**返回示例：**
```json
{
  "totals": {
    "users": 150,
    "reports": 320,
    "sessions": 480,
    "tasks": 1200,
    "feedback": 45
  },
  "today": {
    "newTasks": 23,
    "newUsers": 5
  },
  "tasksByStatus": {
    "pending": 3,
    "processing": 1,
    "completed": 1180,
    "failed": 16
  },
  "feedbackBreakdown": {
    "thumbsUp": 37,
    "thumbsDown": 8
  }
}
```

---

### 5. 查询任务列表

**GET** `/api/admin/tasks`

查询所有用户的 AI 对话任务（包含用户消息、文件信息、AI 回复），按时间倒序排列。

**Query 参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | number | 1 | 页码 |
| limit | number | 50 | 每页条数（最大 100） |

**请求示例：**
```bash
curl -H "Authorization: Bearer atlas_admin_3384031b89e16989d665fcb4034e3ba416f52eb8fc209aa1" \
  "https://atlasrepo-cryfqh5q.manus.space/api/admin/tasks?limit=10"
```

**返回示例：**
```json
{
  "data": [
    {
      "id": "task_xyz",
      "userId": 3,
      "userMessage": "帮我计算各店铺销售排名",
      "fileUrls": ["https://..."],
      "filenames": ["sales_data.xlsx"],
      "status": "completed",
      "reply": "以下是各店铺销售排名...",
      "createdAt": "2026-03-08T09:00:00.000Z",
      "completedAt": "2026-03-08T09:00:45.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1200,
    "pages": 120
  }
}
```

---

### 6. 推送系统通知

**POST** `/api/admin/notify`

向系统 Owner（你）推送一条通知消息（通过 Telegram）。

**Body 参数（JSON）：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | 是 | 通知标题 |
| content | string | 是 | 通知内容 |
| userId | number | 否 | 指定用户 ID（仅作标记，不影响推送目标） |

**请求示例：**
```bash
curl -X POST \
  -H "Authorization: Bearer atlas_admin_3384031b89e16989d665fcb4034e3ba416f52eb8fc209aa1" \
  -H "Content-Type: application/json" \
  -d '{"title": "用户反馈汇报", "content": "今日有 3 条负面反馈，建议优化 AI 提示词"}' \
  "https://atlasrepo-cryfqh5q.manus.space/api/admin/notify"
```

**返回示例：**
```json
{
  "success": true,
  "message": "Notification sent"
}
```

---

## Webhook 推送（实时反馈通知）

当用户点击 👎（有问题）后，ATLAS 会自动向 `OPENCLAW_WEBHOOK_URL` 推送一条 POST 请求。

**推送格式：**
```json
{
  "event": "user_feedback",
  "feedbackId": "abc123",
  "rating": -1,
  "messagePreview": "帮我计算哪些用户达标...",
  "comment": "AI 没有给出计算结果",
  "userId": 3,
  "timestamp": "2026-03-08T09:15:00.000Z"
}
```

**配置方式：** 将 OpenClaw 的 Webhook 接收地址设置为环境变量 `OPENCLAW_WEBHOOK_URL`，ATLAS 即可自动推送。

---

## 错误码说明

| HTTP 状态码 | 含义 |
|------------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 401 | API Key 无效或未提供 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |
| 503 | 数据库暂时不可用 |

---

## 推荐使用方式（OpenClaw 工作流）

OpenClaw 可按以下频率调用接口，实现实时监控：

每 5 分钟调用 `/api/admin/stats` 获取系统概览，发现异常（如任务失败率上升）时主动通知。

每 30 分钟调用 `/api/admin/feedback?limit=20` 获取最新反馈，分析用户痛点。

每天早上 9 点调用 `/api/admin/tasks?limit=50` 获取昨日任务，生成日报推送给 Owner。

收到 Webhook 推送的负面反馈时，立即分析并通过 `/api/admin/notify` 推送处理建议。

---

*文档版本：v1.0 | 生成时间：2026-03-08*
