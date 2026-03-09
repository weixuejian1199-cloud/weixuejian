/**
 * ATLAS IM WebSocket Server
 *
 * Handles:
 * - User authentication via JWT session token
 * - 1v1 direct messaging between users
 * - AI assistant conversations (via Qianwen or OpenClaw)
 * - OpenClaw plugin connection (Bearer token auth)
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, and, inArray, desc } from "drizzle-orm";
import {
  imConversations,
  imMessages,
  imParticipants,
  users,
} from "../../drizzle/schema";
import type { ImConversation, ImMessage, ImParticipant } from "../../drizzle/schema";
import { verifySessionToken } from "../_core/auth";
import { ENV } from "../_core/env";
import { nanoid } from "nanoid";
import { streamAIReply } from "./aiReply";

// ── DB ────────────────────────────────────────────────────────────────────────

function getDb() {
  return drizzle(process.env.DATABASE_URL!);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthedClient {
  ws: WebSocket;
  userId: number;
  userName: string;
  isOpenClaw: boolean;
}

interface WsMsgBase { type: string }
interface WsMsgPing extends WsMsgBase { type: "ping" }
interface WsMsgSend extends WsMsgBase {
  type: "send_message";
  conversationId: string;
  content: string;
  msgType?: "text" | "file";
  fileInfo?: Record<string, unknown>;
}
interface WsMsgGetMessages extends WsMsgBase {
  type: "get_messages";
  conversationId: string;
  limit?: number;
}
interface WsMsgGetConversations extends WsMsgBase { type: "get_conversations" }
interface WsMsgGetContacts extends WsMsgBase { type: "get_contacts" }
interface WsMsgCreateDirect extends WsMsgBase {
  type: "create_direct_conversation";
  targetUserId: number;
}
interface WsMsgGetAiConv extends WsMsgBase { type: "get_or_create_ai_conversation" }
interface WsMsgOpenClawReply extends WsMsgBase {
  type: "openclaw_reply";
  conversationId: string;
  content: string;
  streaming?: boolean;
  done?: boolean;
}

type WsMessage =
  | WsMsgPing
  | WsMsgSend
  | WsMsgGetMessages
  | WsMsgGetConversations
  | WsMsgGetContacts
  | WsMsgCreateDirect
  | WsMsgGetAiConv
  | WsMsgOpenClawReply;

// ── State ─────────────────────────────────────────────────────────────────────

const onlineUsers = new Map<number, AuthedClient>();
let openClawClient: WebSocket | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(ws: WebSocket, data: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastToConversation(
  conversationId: string,
  data: object,
  excludeUserId?: number
): void {
  if (!conversationId) return;
  const db = getDb();
  db.select()
    .from(imParticipants)
    .where(eq(imParticipants.conversationId, conversationId))
    .then((participants: ImParticipant[]) => {
      for (const p of participants) {
        if (p.userId === excludeUserId) continue;
        const client = onlineUsers.get(p.userId);
        if (client) send(client.ws, data);
      }
    })
    .catch(() => {});
}

async function getOrCreateDirectConversation(
  userA: number,
  userB: number
): Promise<string> {
  const db = getDb();
  const participantsA = await db
    .select({ conversationId: imParticipants.conversationId })
    .from(imParticipants)
    .where(eq(imParticipants.userId, userA));

  const convIdsA = participantsA.map((p: { conversationId: string }) => p.conversationId);

  if (convIdsA.length > 0) {
    const participantsB = await db
      .select({ conversationId: imParticipants.conversationId })
      .from(imParticipants)
      .where(
        and(
          eq(imParticipants.userId, userB),
          inArray(imParticipants.conversationId, convIdsA)
        )
      );

    if (participantsB.length > 0) {
      const conv = await db
        .select()
        .from(imConversations)
        .where(
          and(
            eq(imConversations.id, participantsB[0].conversationId),
            eq(imConversations.type, "direct")
          )
        )
        .limit(1);
      if (conv.length > 0) return conv[0].id;
    }
  }

  const convId = nanoid();
  await db.insert(imConversations).values({
    id: convId,
    type: "direct",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(imParticipants).values([
    { conversationId: convId, userId: userA, unreadCount: 0, createdAt: new Date() },
    { conversationId: convId, userId: userB, unreadCount: 0, createdAt: new Date() },
  ]);
  return convId;
}

async function getOrCreateAiConversation(userId: number): Promise<string> {
  const db = getDb();
  const existing = await db
    .select({ conversationId: imParticipants.conversationId })
    .from(imParticipants)
    .where(eq(imParticipants.userId, userId));

  if (existing.length > 0) {
    const convIds = existing.map((p: { conversationId: string }) => p.conversationId);
    const aiConv = await db
      .select()
      .from(imConversations)
      .where(
        and(
          eq(imConversations.type, "ai"),
          inArray(imConversations.id, convIds)
        )
      )
      .limit(1);
    if (aiConv.length > 0) return aiConv[0].id;
  }

  const convId = nanoid();
  await db.insert(imConversations).values({
    id: convId,
    type: "ai",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(imParticipants).values({
    conversationId: convId,
    userId,
    unreadCount: 0,
    createdAt: new Date(),
  });
  return convId;
}

async function saveMessage(params: {
  conversationId: string;
  senderId: number;
  senderName: string;
  content: string;
  type?: "text" | "file" | "ai_thinking";
  fileInfo?: Record<string, unknown> | null;
}): Promise<string> {
  const db = getDb();
  const msgId = nanoid();
  await db.insert(imMessages).values({
    id: msgId,
    conversationId: params.conversationId,
    senderId: params.senderId,
    senderName: params.senderName,
    type: params.type ?? "text",
    content: params.content,
    fileInfo: params.fileInfo ?? null,
    createdAt: new Date(),
  });
  await db
    .update(imConversations)
    .set({
      lastMessage: params.content.slice(0, 100),
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(imConversations.id, params.conversationId));
  return msgId;
}

// ── AI Reply ──────────────────────────────────────────────────────────────────

function triggerAiReply(
  conversationId: string,
  userId: number,
  userName: string,
  content: string
): void {
  if (openClawClient && openClawClient.readyState === WebSocket.OPEN) {
    send(openClawClient, {
      type: "user_message",
      conversationId,
      userId,
      userName,
      content,
    });
    return;
  }

  streamAIReply({
    conversationId,
    userId,
    content,
    onToken: (token: string) => {
      const userClient = onlineUsers.get(userId);
      if (userClient) {
        send(userClient.ws, { type: "ai_streaming", conversationId, token });
      }
    },
    onDone: async (fullReply: string) => {
      const aiMsgId = await saveMessage({
        conversationId,
        senderId: 0,
        senderName: "AI 助手",
        content: fullReply,
        type: "text",
      });
      const userClient = onlineUsers.get(userId);
      if (userClient) {
        send(userClient.ws, {
          type: "new_message",
          data: {
            id: aiMsgId,
            conversationId,
            senderId: 0,
            senderName: "AI 助手",
            type: "text",
            content: fullReply,
            fileInfo: null,
            createdAt: new Date().toISOString(),
          },
        });
        send(userClient.ws, { type: "ai_streaming_done", conversationId });
      }
    },
  });
}

// ── Message Handlers ──────────────────────────────────────────────────────────

async function handleMessage(client: AuthedClient, raw: string): Promise<void> {
  let msg: WsMessage;
  try {
    msg = JSON.parse(raw) as WsMessage;
  } catch {
    send(client.ws, { type: "error", message: "Invalid JSON" });
    return;
  }

  const db = getDb();

  switch (msg.type) {
    case "ping":
      send(client.ws, { type: "pong" });
      break;

    case "get_conversations": {
      const participations = await db
        .select({ conversationId: imParticipants.conversationId })
        .from(imParticipants)
        .where(eq(imParticipants.userId, client.userId));

      if (participations.length === 0) {
        send(client.ws, { type: "conversations", data: [] });
        break;
      }

      const convIds = participations.map((p: { conversationId: string }) => p.conversationId);
      const convs = await db
        .select()
        .from(imConversations)
        .where(inArray(imConversations.id, convIds))
        .orderBy(desc(imConversations.lastMessageAt));

      const enriched = await Promise.all(
        convs.map(async (conv: ImConversation) => {
          const parts = await db
            .select({
              userId: imParticipants.userId,
              unreadCount: imParticipants.unreadCount,
            })
            .from(imParticipants)
            .where(eq(imParticipants.conversationId, conv.id));

          const otherUserIds = parts
            .map((p: { userId: number; unreadCount: number }) => p.userId)
            .filter((id: number) => id !== client.userId);

          let otherUser: { id: number; name: string | null; username: string | null } | null = null;
          if (otherUserIds.length > 0) {
            const uRows = await db
              .select({ id: users.id, name: users.name, username: users.username })
              .from(users)
              .where(eq(users.id, otherUserIds[0]))
              .limit(1);
            otherUser = uRows[0] ?? null;
          }

          const myPart = parts.find((p: { userId: number; unreadCount: number }) => p.userId === client.userId);

          return {
            ...conv,
            otherUser,
            unreadCount: myPart?.unreadCount ?? 0,
            isAi: conv.type === "ai",
          };
        })
      );

      send(client.ws, { type: "conversations", data: enriched });
      break;
    }

    case "get_messages": {
      const { conversationId, limit = 50 } = msg;

      const part = await db
        .select()
        .from(imParticipants)
        .where(
          and(
            eq(imParticipants.conversationId, conversationId),
            eq(imParticipants.userId, client.userId)
          )
        )
        .limit(1);

      if (part.length === 0) {
        send(client.ws, { type: "error", message: "Not a participant" });
        break;
      }

      const messages = await db
        .select()
        .from(imMessages)
        .where(eq(imMessages.conversationId, conversationId))
        .orderBy(desc(imMessages.createdAt))
        .limit(limit);

      await db
        .update(imParticipants)
        .set({ unreadCount: 0 })
        .where(
          and(
            eq(imParticipants.conversationId, conversationId),
            eq(imParticipants.userId, client.userId)
          )
        );

      send(client.ws, {
        type: "messages",
        conversationId,
        data: messages.reverse(),
      });
      break;
    }

    case "get_contacts": {
      const allUsers = await db
        .select({
          id: users.id,
          name: users.name,
          username: users.username,
          role: users.role,
        })
        .from(users)
        .orderBy(users.name);

      const contacts = allUsers
        .filter((u: { id: number; name: string | null; username: string | null; role: string }) => u.id !== client.userId)
        .map((u: { id: number; name: string | null; username: string | null; role: string }) => ({
          ...u,
          isOnline: onlineUsers.has(u.id),
          displayName: u.name || u.username || `用户${u.id}`,
        }));

      send(client.ws, { type: "contacts", data: contacts });
      break;
    }

    case "create_direct_conversation": {
      const { targetUserId } = msg;
      const convId = await getOrCreateDirectConversation(client.userId, targetUserId);
      send(client.ws, { type: "conversation_created", conversationId: convId });
      break;
    }

    case "get_or_create_ai_conversation": {
      const convId = await getOrCreateAiConversation(client.userId);
      send(client.ws, { type: "ai_conversation_ready", conversationId: convId });
      break;
    }

    case "send_message": {
      const { conversationId, content, msgType = "text", fileInfo } = msg;

      const part = await db
        .select()
        .from(imParticipants)
        .where(
          and(
            eq(imParticipants.conversationId, conversationId),
            eq(imParticipants.userId, client.userId)
          )
        )
        .limit(1);

      if (part.length === 0) {
        send(client.ws, { type: "error", message: "Not a participant" });
        break;
      }

      const msgId = await saveMessage({
        conversationId,
        senderId: client.userId,
        senderName: client.userName,
        content,
        type: msgType,
        fileInfo: fileInfo ?? null,
      });

      const newMsg = {
        id: msgId,
        conversationId,
        senderId: client.userId,
        senderName: client.userName,
        type: msgType,
        content,
        fileInfo: fileInfo ?? null,
        createdAt: new Date().toISOString(),
      };

      broadcastToConversation(conversationId, { type: "new_message", data: newMsg });

      const conv = await db
        .select()
        .from(imConversations)
        .where(eq(imConversations.id, conversationId))
        .limit(1);

      if (conv[0]?.type === "ai") {
        triggerAiReply(conversationId, client.userId, client.userName, content);
      }
      break;
    }

    case "openclaw_reply": {
      if (!client.isOpenClaw) {
        send(client.ws, { type: "error", message: "Unauthorized" });
        break;
      }
      const { conversationId, content, streaming, done } = msg;

      const parts = await db
        .select()
        .from(imParticipants)
        .where(eq(imParticipants.conversationId, conversationId));

      const userParticipant = parts.find((p: ImParticipant) => p.userId !== 0);
      if (!userParticipant) break;

      const userClient = onlineUsers.get(userParticipant.userId);

      if (streaming && !done) {
        if (userClient) {
          send(userClient.ws, { type: "ai_streaming", conversationId, token: content });
        }
      } else if (done) {
        const aiMsgId = await saveMessage({
          conversationId,
          senderId: 0,
          senderName: "AI 助手",
          content,
          type: "text",
        });
        if (userClient) {
          send(userClient.ws, {
            type: "new_message",
            data: {
              id: aiMsgId,
              conversationId,
              senderId: 0,
              senderName: "AI 助手",
              type: "text",
              content,
              fileInfo: null,
              createdAt: new Date().toISOString(),
            },
          });
          send(userClient.ws, { type: "ai_streaming_done", conversationId });
        }
      }
      break;
    }

    default:
      send(client.ws, { type: "error", message: "Unknown message type" });
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function authenticate(
  req: IncomingMessage
): Promise<Omit<AuthedClient, "ws"> | null> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const token = url.searchParams.get("token") ?? "";

  // Check OpenClaw plugin token
  const openClawToken = ENV.openClawSessionKey;
  if (openClawToken && token === openClawToken) {
    return { userId: -1, userName: "OpenClaw", isOpenClaw: true };
  }

  // JWT session token for regular users
  try {
    const payload = await verifySessionToken(token);
    if (!payload || typeof payload.userId !== "number") return null;

    const db = getDb();
    const userRows = await db
      .select({ id: users.id, name: users.name, username: users.username })
      .from(users)
      .where(eq(users.id, payload.userId))
      .limit(1);

    if (userRows.length === 0) return null;
    const user = userRows[0];

    return {
      userId: user.id,
      userName: user.name || user.username || `用户${user.id}`,
      isOpenClaw: false,
    };
  } catch {
    return null;
  }
}

// ── Server Setup ──────────────────────────────────────────────────────────────

export function createImWsServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/api/ws/im" });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const authInfo = await authenticate(req);

    if (!authInfo) {
      ws.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
      ws.close(4001, "Unauthorized");
      return;
    }

    const client: AuthedClient = { ...authInfo, ws };

    if (client.isOpenClaw) {
      // 如果已有旧连接，先优雅关闭它，避免重连循环
      if (openClawClient && openClawClient.readyState === WebSocket.OPEN) {
        console.log("[IM] Closing previous OpenClaw connection, accepting new one");
        openClawClient.close(1000, "Replaced by new connection");
      }
      openClawClient = ws;
      console.log("[IM] OpenClaw plugin connected");

      ws.on("message", (data: Buffer) => {
        handleMessage(client, data.toString()).catch(console.error);
      });

      ws.on("close", () => {
        if (openClawClient === ws) openClawClient = null;
        console.log("[IM] OpenClaw plugin disconnected");
      });

      ws.send(JSON.stringify({ type: "connected", role: "openclaw" }));
      return;
    }

    onlineUsers.set(client.userId, client);
    console.log(`[IM] User ${client.userId} (${client.userName}) connected`);

    ws.on("message", (data: Buffer) => {
      handleMessage(client, data.toString()).catch(console.error);
    });

    ws.on("close", () => {
      onlineUsers.delete(client.userId);
      console.log(`[IM] User ${client.userId} disconnected`);
    });

    ws.on("error", (err: Error) => {
      console.error(`[IM] WebSocket error for user ${client.userId}:`, err.message);
    });

    ws.send(
      JSON.stringify({
        type: "connected",
        userId: client.userId,
        userName: client.userName,
      })
    );
  });

  console.log("[IM] WebSocket server ready at /api/ws/im");
  return wss;
}
