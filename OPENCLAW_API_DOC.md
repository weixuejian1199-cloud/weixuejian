# ATLAS ↔ OpenClaw 对接文档

> 版本：V14.4 HTTP API 方案（飞书机器人模式）
> 更新时间：2026-03-09

---

## 概述

ATLAS 与 OpenClaw（小虾米）的通信方式与飞书机器人完全一致：

- **小虾米 → Admin**：小虾米调用 ATLAS 提供的 HTTP 接口，把消息推送给 ATLAS
- **Admin → 小虾米**：Admin 在 ATLAS 发消息时，ATLAS 自动 HTTP POST 到小虾米提供的 Webhook URL

**不需要 WebSocket，不需要持续在线，被动响应即可。**

---

## 鉴权信息

| 项目 | 值 |
|------|-----|
| Bearer Token | `atlas_session_shrimp_20260308` |
| 鉴权方式 | HTTP Header: `Authorization: Bearer atlas_session_shrimp_20260308` |
| Base URL | `https://atlascore.cn` |

---

## 接口 1：小虾米发消息给 Admin

### `POST https://atlascore.cn/api/openclaw/send`

小虾米处理完用户请求后，调用此接口把回复推送给 ATLAS，显示在 Admin 的 IM 对话窗口。

**请求 Header：**
```
Authorization: Bearer atlas_session_shrimp_20260308
Content-Type: application/json
```

**请求 Body：**
```json
{
  "content": "这是小虾米的回复内容",
  "msgId": "可选，小虾米自己生成的消息ID"
}
```

**响应：**
```json
{
  "success": true,
  "msgId": "服务器生成的消息ID"
}
```

**curl 示例：**
```bash
curl -X POST https://atlascore.cn/api/openclaw/send \
  -H "Authorization: Bearer atlas_session_shrimp_20260308" \
  -H "Content-Type: application/json" \
  -d '{"content": "你好，我是小虾米，收到你的消息了"}'
```

---

## 接口 2：小虾米提供 Webhook URL（接收 Admin 消息）

小虾米需要提供一个 HTTP 接口，ATLAS 会在 Admin 发消息时 POST 到这个地址。

### 小虾米需要实现的接口

```
POST <小虾米的Webhook URL>
Authorization: Bearer atlas_session_shrimp_20260308
Content-Type: application/json
```

**ATLAS 推送的请求 Body：**
```json
{
  "type": "admin_message",
  "msgId": "消息唯一ID",
  "fromUserId": 1,
  "fromUserName": "Admin",
  "content": "Admin 发的消息内容",
  "timestamp": "2026-03-09T10:00:00.000Z"
}
```

**小虾米处理完后，调用接口 1 把回复发回 ATLAS。**

---

## 配置步骤

### 第一步：小虾米工程师提供 Webhook URL

小虾米工程师实现一个接收 Admin 消息的 HTTP 接口，并把 URL 告知 ATLAS 管理员。

### 第二步：ATLAS 管理员配置 Webhook URL

在 Manus 管理界面 → Settings → Secrets → 添加环境变量：

```
OPENCLAW_WEBHOOK_URL = https://小虾米的Webhook地址
```

### 第三步：验证

1. Admin 在 ATLAS IM → 小虾米对话窗口发一条消息
2. 小虾米的 Webhook 收到请求（`type: "admin_message"`）
3. 小虾米处理后调用 `POST /api/openclaw/send` 回复
4. Admin 在 ATLAS 看到回复（前端每 3s 轮询一次，自动显示）

---

## 完整流程图

```
Admin 在 ATLAS 发消息
    ↓
ATLAS 存库（im_messages 表）
    ↓
ATLAS POST 到小虾米 Webhook URL
    ↓
小虾米收到消息，AI 处理
    ↓
小虾米 POST /api/openclaw/send（带 Bearer Token）
    ↓
ATLAS 存库（im_messages 表）
    ↓
前端每 3s 轮询，Admin 看到回复
```

---

## 辅助接口

### 查询对话历史

```
GET https://atlascore.cn/api/openclaw/messages
```

需要 Admin 登录 cookie，仅供内部调试使用。支持增量拉取：
```
GET /api/openclaw/messages?after=2026-03-09T10:00:00.000Z
```

### 查看当前配置

```
GET https://atlascore.cn/api/openclaw/config
```

需要 Admin 登录 cookie。响应：
```json
{
  "webhookUrl": "https://小虾米的Webhook地址",
  "configured": true,
  "sendEndpoint": "POST /api/openclaw/send",
  "authHeader": "Authorization: Bearer atlas_session_shrimp_20260308"
}
```

---

## 错误码说明

| HTTP 状态码 | 含义 |
|------------|------|
| 200 | 成功 |
| 400 | 请求参数错误（如 content 为空） |
| 401 | Bearer Token 无效或未提供 |
| 403 | 需要管理员权限 |
| 500 | 服务器内部错误 |

---

*文档版本：v14.4 | 生成时间：2026-03-09*
