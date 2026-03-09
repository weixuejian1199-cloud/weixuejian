/**
 * ATLAS IM — Instant Messaging Page
 *
 * Layout:
 *   Left panel  — AI assistant entry + contacts list (online status)
 *   Right panel — message thread + input box
 *
 * Transport: native WebSocket at /ws/im
 * Auth:      JWT token fetched via trpc.im.getWsToken
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Send, Loader2, Circle, MessageSquare, Search, Zap } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAtlas } from "@/contexts/AtlasContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import FeishuChatInput, { UploadedFile } from "@/components/FeishuChatInput";
import { useTypewriter } from "@/hooks/useTypewriter";

// ── Types ─────────────────────────────────────────────────────────────────────

interface IMMessage {
  id: string;
  conversationId: string;
  senderId: number;
  senderName: string;
  type: "text" | "file" | "ai_thinking";
  content: string;
  fileInfo?: Record<string, unknown> | null;
  createdAt: string;
}

interface IMConversation {
  id: string;
  type: "direct" | "ai";
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  otherUser?: { id: number; name: string | null; username: string | null } | null;
  unreadCount: number;
  isAi: boolean;
}

interface Contact {
  id: number;
  name: string | null;
  username: string | null;
  role: string;
  isOnline: boolean;
  displayName: string;
}

// ── Bot types ─────────────────────────────────────────────────────────────────

interface BotInfo {
  id: string;
  name: string;
  description: string | null;
  avatar: string | null;
  enabled: number;
  webhookUrl: string | null;
}

interface BotMessage {
  id: string;
  role: "user" | "bot";
  content: string;
  createdAt: string;
}

// ── WebSocket hook ─────────────────────────────────────────────────────────────

function useImWebSocket(token: string | null, onOpenClawReply?: (msg: { id: string; role: "assistant"; content: string; createdAt: string }) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [conversations, setConversations] = useState<IMConversation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<Record<string, IMMessage[]>>({});
  const [streamingTokens, setStreamingTokens] = useState<Record<string, string>>({});
  const [currentAgentType, setCurrentAgentType] = useState<Record<string, string>>({});
  const pingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(3000); // start at 3s
  const destroyed = useRef(false);
  const activeConvIdRef = useRef<string | null>(null);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const connect = useCallback((tok: string) => {
    if (destroyed.current) return;
    const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/ws/im?token=${encodeURIComponent(tok)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (destroyed.current) { ws.close(); return; }
      setConnected(true);
      setReconnecting(false);
      reconnectDelay.current = 3000; // reset backoff on success
      ws.send(JSON.stringify({ type: "get_conversations" }));
      ws.send(JSON.stringify({ type: "get_contacts" }));
      // Reload active conversation messages after reconnect
      if (activeConvIdRef.current) {
        ws.send(JSON.stringify({ type: "get_messages", conversationId: activeConvIdRef.current }));
      }
      // Keepalive ping every 25s (Cloudflare 100s timeout)
      pingInterval.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 25000);
    };

    ws.onclose = (e) => {
      setConnected(false);
      if (pingInterval.current) clearInterval(pingInterval.current);
      if (destroyed.current) return;
      // Don't reconnect on intentional close (code 1000)
      if (e.code === 1000) return;
      setReconnecting(true);
      const delay = reconnectDelay.current;
      reconnectDelay.current = Math.min(delay * 2, 30000); // exponential backoff, max 30s
      reconnectTimer.current = setTimeout(() => connect(tok), delay);
    };

    ws.onerror = () => {
      setConnected(false);
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);
        switch (msg.type) {
          case "conversations":
            setConversations(msg.data ?? []);
            break;
          case "contacts":
            setContacts(msg.data ?? []);
            break;
          case "messages":
            setMessages(prev => ({
              ...prev,
              [msg.conversationId]: msg.data ?? [],
            }));
            break;
          case "new_message":
            setMessages(prev => {
              const convMsgs = prev[msg.data.conversationId] ?? [];
              // Deduplicate by id
              if (convMsgs.some(m => m.id === msg.data.id)) return prev;
              return {
                ...prev,
                [msg.data.conversationId]: [...convMsgs, msg.data],
              };
            });
            setConversations(prev =>
              prev.map(c =>
                c.id === msg.data.conversationId
                  ? { ...c, lastMessage: msg.data.content, lastMessageAt: msg.data.createdAt }
                  : c
              )
            );
            break;
          case "ai_streaming":
            setStreamingTokens(prev => ({
              ...prev,
              [msg.conversationId]: (prev[msg.conversationId] ?? "") + msg.token,
            }));
            break;
          case "ai_streaming_done":
            setStreamingTokens(prev => {
              const next = { ...prev };
              delete next[msg.conversationId];
              return next;
            });
            break;
          case "conversation_created":
          case "ai_conversation_ready":
            ws.send(JSON.stringify({ type: "get_conversations" }));
            break;
          case "openclaw_im_reply":
            onOpenClawReply?.({
              id: msg.id ?? Date.now().toString(),
              role: "assistant" as const,
              content: msg.content,
              createdAt: msg.createdAt ?? new Date().toISOString(),
            });
            break;
          case "message_recalled":
            setMessages(prev => {
              const convMsgs = prev[msg.conversationId] ?? [];
              return {
                ...prev,
                [msg.conversationId]: convMsgs.map(m =>
                  m.id === msg.messageId
                    ? { ...m, content: "[消息已撤回]", type: "recalled" as const }
                    : m
                ),
              };
            });
            break;
          case "agent_type":
            setCurrentAgentType(prev => ({ ...prev, [msg.conversationId]: msg.agentType }));
            break;
          case "error":
            console.error("[IM WS]", msg.message);
            if (msg.message === "超过2分钟，无法撤回") {
              import("sonner").then(({ toast }) => toast.error("超过2分钟，无法撤回"));
            }
            break;
        }
      } catch {
        // ignore parse errors
      }
    };
  }, [onOpenClawReply]);

  useEffect(() => {
    if (!token) return;
    destroyed.current = false;
    connect(token);
    return () => {
      destroyed.current = true;
      if (pingInterval.current) clearInterval(pingInterval.current);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close(1000, "component unmount");
    };
  }, [token, connect]);

  return { connected, reconnecting, conversations, contacts, messages, streamingTokens, currentAgentType, send, setConversations, activeConvIdRef, wsRef };
}

// ── Avatar ─────────────────────────────────────────────────────────────────────

function Avatar({ name, isAi, isOpenClaw, size = 32 }: { name: string; isAi?: boolean; isOpenClaw?: boolean; size?: number }) {
  if (isOpenClaw) {
    return (
      <div
        className="rounded-full flex items-center justify-center flex-shrink-0 flex-shrink-0"
        style={{
          width: size,
          height: size,
          background: "linear-gradient(135deg, #f97316 0%, #f59e0b 100%)",
          color: "#fff",
          boxShadow: "0 0 0 2px rgba(249,115,22,0.2)",
        }}
      >
        <Zap size={size * 0.5} fill="currentColor" />
      </div>
    );
  }
  if (isAi) {
    return (
      <div
        className="rounded-full flex items-center justify-center flex-shrink-0"
        style={{ width: size, height: size, background: "var(--atlas-accent)", color: "#fff" }}
      >
        <Bot size={size * 0.5} />
      </div>
    );
  }
  const initials = name.slice(0, 2).toUpperCase();
  const hue = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className="rounded-full flex items-center justify-center flex-shrink-0 text-white font-semibold"
      style={{ width: size, height: size, background: `hsl(${hue},55%,45%)`, fontSize: size * 0.35 }}
    >
      {initials}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

// ── OpenClaw 小虾米 conversation state ───────────────────────────────────────
// 小虾米对话使用特殊 conversationId "openclaw-direct"
const OPENCLAW_CONV_ID = "openclaw-direct";

export default function IMPage() {
  const { user } = useAtlas();
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  // 小虾米对话记录：初始化时从数据库加载，新消息实时追加
  const [openClawMessages, setOpenClawMessages] = useState<Array<{id: string; role: "user" | "assistant"; content: string; createdAt: string}>>([]);
  const [openClawHistoryLoaded, setOpenClawHistoryLoaded] = useState(false);
  const [openClawInput, setOpenClawInput] = useState("");
  const [openClawOnline, setOpenClawOnline] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isAdminUser = user?.role === "admin";

   // ── Bot state ──────────────────────────────────────────────────────────
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const [botMessages, setBotMessages] = useState<Record<string, BotMessage[]>>({});
  const [botInput, setBotInput] = useState("");
  const botPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const botLastMsgRef = useRef<Record<string, string>>({});

  // Fetch WS token
  const { data: tokenData } = trpc.im.getWsToken.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: false,
  });

  // ── 加载机器人列表（tRPC）──────────────────────────────────────────────────
  const { data: botListData } = trpc.bots.list.useQuery(undefined, {
    enabled: isAdminUser,
    refetchOnWindowFocus: false,
  });
  const botList = (botListData as BotInfo[] | undefined) ?? [];

  // ── 机器人消息轮询 ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeBotId) {
      if (botPollRef.current) clearInterval(botPollRef.current);
      return;
    }
    // 首次加载历史消息
    fetch(`/api/trpc/bots.getMessages?batch=1&input=${encodeURIComponent(JSON.stringify({"0":{"json":{"botId":activeBotId}}}))}`, { credentials: "include" })
      .then(r => r.json())
      .then((data: [{result: {data: {json: BotMessage[]}}}]) => {
        const msgs = data?.[0]?.result?.data?.json || [];
        setBotMessages(prev => ({ ...prev, [activeBotId]: msgs }));
        if (msgs.length > 0) botLastMsgRef.current[activeBotId] = msgs[msgs.length - 1].createdAt;
      })
      .catch(() => {});
    // 每 3s 轮询新消息
    if (botPollRef.current) clearInterval(botPollRef.current);
    botPollRef.current = setInterval(() => {
      const after = botLastMsgRef.current[activeBotId];
      const sinceParam = after ? new Date(after).getTime() : undefined;
      const input = JSON.stringify({"0":{"json":{"botId":activeBotId, ...(sinceParam ? {"since":sinceParam} : {})}}});
      fetch(`/api/trpc/bots.getMessages?batch=1&input=${encodeURIComponent(input)}`, { credentials: "include" })
        .then(r => r.json())
        .then((data: [{result: {data: {json: BotMessage[]}}}]) => {
          const newMsgs = data?.[0]?.result?.data?.json || [];
          if (newMsgs.length > 0) {
            setBotMessages(prev => {
              const existing = prev[activeBotId] || [];
              const existingIds = new Set(existing.map(m => m.id));
              const filtered = newMsgs.filter((m: BotMessage) => !existingIds.has(m.id));
              if (filtered.length === 0) return prev;
              botLastMsgRef.current[activeBotId] = filtered[filtered.length - 1].createdAt;
              return { ...prev, [activeBotId]: [...existing, ...filtered] };
            });
          }
        })
        .catch(() => {});
    }, 3000);
    return () => { if (botPollRef.current) clearInterval(botPollRef.current); };
  }, [activeBotId]);

  // ── HTTP 轮询：加载小虾米历史消息 + 每 3s 增量拉取新消息 ──────────────────
  const lastMsgTimeRef = useRef<string | null>(null);

  // 初始加载历史消息
  useEffect(() => {
    if (!isAdminUser) return;
    fetch("/api/openclaw/messages", { credentials: "include" })
      .then(r => r.json())
      .then((data: { messages: Array<{id: string; role: "user"|"assistant"; content: string; senderName: string|null; createdAt: string}> }) => {
        if (data.messages?.length > 0) {
          setOpenClawMessages(data.messages);
          lastMsgTimeRef.current = data.messages[data.messages.length - 1].createdAt;
        }
        setOpenClawHistoryLoaded(true);
      })
      .catch(() => setOpenClawHistoryLoaded(true));
  }, [isAdminUser]);

  // 每 3s 轮询新消息（仅当小虾米对话窗口激活时）
  useEffect(() => {
    if (!isAdminUser) return;
    const poll = setInterval(() => {
      const afterParam = lastMsgTimeRef.current
        ? `?after=${encodeURIComponent(lastMsgTimeRef.current)}`
        : "";
      fetch(`/api/openclaw/messages${afterParam}`, { credentials: "include" })
        .then(r => r.json())
        .then((data: { messages: Array<{id: string; role: "user"|"assistant"; content: string; senderName: string|null; createdAt: string}> }) => {
          if (data.messages?.length > 0) {
            setOpenClawMessages(prev => {
              const existingIds = new Set(prev.map(m => m.id));
              const newMsgs = data.messages.filter(m => !existingIds.has(m.id));
              if (newMsgs.length === 0) return prev;
              lastMsgTimeRef.current = newMsgs[newMsgs.length - 1].createdAt;
              return [...prev, ...newMsgs];
            });
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(poll);
  }, [isAdminUser]);

  // 小虾米「在线」状态：只要 Webhook URL 已配置就视为可用
  useEffect(() => {
    if (!isAdminUser) return;
    fetch("/api/openclaw/config", { credentials: "include" })
      .then(r => r.json())
      .then((data: { configured: boolean }) => setOpenClawOnline(data.configured ?? false))
      .catch(() => {});
  }, [isAdminUser]);

  const { connected, reconnecting, conversations, contacts, messages, streamingTokens, currentAgentType, send, setConversations, activeConvIdRef, wsRef } = useImWebSocket(
    tokenData?.token ?? null,
    (msg) => {
      setOpenClawMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    }
  );

  // Sync activeConvId to ref so reconnect can reload messages
  useEffect(() => {
    activeConvIdRef.current = activeConvId;
  }, [activeConvId, activeConvIdRef]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingTokens, activeConvId]);

  // Load messages when switching conversation
  useEffect(() => {
    if (activeConvId) {
      send({ type: "get_messages", conversationId: activeConvId });
    }
  }, [activeConvId, send]);

  const handleSelectAi = useCallback(() => {
    send({ type: "get_or_create_ai_conversation" });
    // Wait for conversation_created event, then select it
    // We'll handle this by watching conversations
  }, [send]);

  // Auto-select AI conversation when it appears
  useEffect(() => {
    if (!activeConvId) {
      const aiConv = conversations.find(c => c.isAi);
      if (aiConv) setActiveConvId(aiConv.id);
    }
  }, [conversations, activeConvId]);

  // On first connect, open AI conversation
  useEffect(() => {
    if (connected && conversations.length === 0) {
      send({ type: "get_or_create_ai_conversation" });
    }
  }, [connected, conversations.length, send]);

  // tRPC bot mutations
  const sendBotMsg = trpc.bots.sendMessage.useMutation({
    onError: () => toast.error("发送失败，请重试"),
  });

  const handleSelectContact = useCallback(
    (contactId: number) => {
      send({ type: "create_direct_conversation", targetUserId: contactId });
      // conversation_created → get_conversations → find the new one
    },
    [send]
  );

  // When a new direct conversation is created, auto-select it
  useEffect(() => {
    if (activeConvId) return; // already selected
    const direct = conversations.find(c => !c.isAi);
    if (direct) setActiveConvId(direct.id);
  }, [conversations, activeConvId]);

  const [isSending, setIsSending] = useState(false);

  const handleSend = useCallback((textOverride?: string) => {
    const text = (textOverride ?? inputText).trim();
    if (!text || !activeConvId) return;
    if (!connected) {
      toast.error("连接已断开，正在重连中，请稍后重试");
      return;
    }
    setIsSending(true);
    send({ type: "send_message", conversationId: activeConvId, content: text });
    if (!textOverride) setInputText("");
    // Timeout: if no new_message received within 8s, show retry toast
    const timeout = setTimeout(() => {
      setIsSending(false);
      toast.error("发送超时，请检查网络后重试", {
        action: {
          label: "重试",
          onClick: () => handleSend(text),
        },
      });
    }, 8000);
    // Clear timeout when message arrives
    const unsub = () => clearTimeout(timeout);
    // Listen for new_message to cancel timeout
    const origOnMessage = wsRef.current?.onmessage;
    if (wsRef.current) {
      const ws = wsRef.current;
      const prevHandler = ws.onmessage;
      ws.onmessage = (e: MessageEvent) => {
        try {
          const m = JSON.parse(e.data as string);
          if (m.type === "new_message" && m.data?.conversationId === activeConvId) {
            clearTimeout(timeout);
            setIsSending(false);
            ws.onmessage = prevHandler;
          }
        } catch {}
        if (prevHandler) prevHandler.call(ws, e);
      };
    }
    void origOnMessage;
    void unsub;
  }, [inputText, activeConvId, send, connected]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const activeConv = conversations.find(c => c.id === activeConvId);
  const isOpenClawActive = activeConvId === OPENCLAW_CONV_ID;
  const isBotActive = activeBotId !== null;
  const currentMessages = (activeConvId && !isOpenClawActive) ? (messages[activeConvId] ?? []) : [];
  const streamingText = (activeConvId && !isOpenClawActive) ? (streamingTokens[activeConvId] ?? "") : "";
  const myUserId = user ? parseInt(user.id) : -1;

  const filteredContacts = contacts.filter(c =>
    !contactSearch || c.displayName.toLowerCase().includes(contactSearch.toLowerCase())
  );

  // ── Conversation display name ──────────────────────────────────────────────
  const getConvName = (conv: IMConversation) => {
    if (conv.isAi) return "AI 助手";
    return conv.otherUser?.name || conv.otherUser?.username || "未知用户";
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--atlas-bg)" }}>
      {/* Reconnecting banner */}
      {reconnecting && (
        <div
          className="flex items-center justify-center gap-2 py-1.5 text-xs font-medium flex-shrink-0"
          style={{ background: "#f59e0b", color: "#fff" }}
        >
          <Loader2 size={12} className="animate-spin" />
          连接已断开，正在重新连接...
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Panel ── */}
        <div
        className="flex flex-col flex-shrink-0 overflow-hidden"
        style={{
          width: 260,
          borderRight: "1px solid var(--atlas-border)",
          background: "var(--atlas-surface)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-4 flex-shrink-0"
          style={{ height: 52, borderBottom: "1px solid var(--atlas-border)" }}
        >
          <MessageSquare size={15} style={{ color: "var(--atlas-accent)" }} />
          <span className="font-semibold text-sm" style={{ color: "var(--atlas-text)" }}>
            消息
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Circle
              size={7}
              fill={connected ? "#34D399" : reconnecting ? "#f59e0b" : "#6B7280"}
              style={{ color: connected ? "#34D399" : reconnecting ? "#f59e0b" : "#6B7280" }}
            />
            <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
              {connected ? "在线" : reconnecting ? "重连中..." : "连接中"}
            </span>
          </div>
        </div>

        {/* AI Assistant entry */}
        <div className="px-2 pt-2 flex-shrink-0">
          <button
            onClick={() => {
              setActiveBotId(null);
              const aiConv = conversations.find(c => c.isAi);
              if (aiConv) {
                setActiveConvId(aiConv.id);
              } else {
                handleSelectAi();
              }
            }}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2 transition-all"
            style={{
              background:
                activeConv?.isAi ? "var(--atlas-nav-active-bg)" : "transparent",
              color: activeConv?.isAi ? "var(--atlas-accent)" : "var(--atlas-text-2)",
            }}
            onMouseEnter={e => {
              if (!activeConv?.isAi) {
                (e.currentTarget as HTMLElement).style.background = "var(--atlas-nav-hover-bg)";
              }
            }}
            onMouseLeave={e => {
              if (!activeConv?.isAi) {
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }
            }}
          >
            <Avatar name="AI" isAi size={28} />
            <div className="flex-1 min-w-0 text-left">
              <div className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>
                AI 助手
              </div>
              <div className="text-xs truncate" style={{ color: "var(--atlas-text-3)" }}>
                {conversations.find(c => c.isAi)?.lastMessage ?? "随时可以问我"}
              </div>
            </div>
          </button>
        </div>

        {/* OpenClaw 小虾米 System Contact — 仅 admin 可见 */}
        {user?.role === "admin" && <div className="px-2 pt-1 flex-shrink-0">
          <button
            onClick={() => { setActiveBotId(null); setActiveConvId(OPENCLAW_CONV_ID); }}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2 transition-all relative"
            style={{
              background:
                activeConvId === OPENCLAW_CONV_ID ? "rgba(249,115,22,0.12)" : "transparent",
              color: activeConvId === OPENCLAW_CONV_ID ? "#f97316" : "var(--atlas-text-2)",
              border: activeConvId === OPENCLAW_CONV_ID ? "1px solid rgba(249,115,22,0.25)" : "1px solid transparent",
            }}
            onMouseEnter={e => {
              if (activeConvId !== OPENCLAW_CONV_ID) {
                (e.currentTarget as HTMLElement).style.background = "var(--atlas-nav-hover-bg)";
              }
            }}
            onMouseLeave={e => {
              if (activeConvId !== OPENCLAW_CONV_ID) {
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }
            }}
          >
            <Avatar name="小虾米" isOpenClaw size={28} />
            <div className="flex-1 min-w-0 text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>
                  小虾米
                </span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
                  style={{ background: "rgba(249,115,22,0.15)", color: "#f97316", fontSize: 10 }}
                >
                  监控
                </span>
              </div>
              <div className="text-xs truncate" style={{ color: "var(--atlas-text-3)" }}>
                {openClawOnline ? "✦ 已连接 · 正在监控" : "未连接 · 点击查看状态"}
              </div>
            </div>
            {openClawOnline && (
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: "#34D399" }}
              />
            )}
          </button>
        </div>}

        {/* 机器人列表 — 仅 admin 可见 */}
        {isAdminUser && botList.length > 0 && (
          <div className="px-2 pt-1 flex-shrink-0">
            <div className="px-3 py-1">
              <span className="text-xs font-medium" style={{ color: "var(--atlas-text-3)" }}>机器人</span>
            </div>
            {botList.filter(b => b.enabled).map(bot => (
              <button
                key={bot.id}
                onClick={() => { setActiveBotId(bot.id); setActiveConvId(null); }}
                className="w-full flex items-center gap-3 rounded-lg px-3 py-2 transition-all"
                style={{
                  background: activeBotId === bot.id ? "rgba(91,140,255,0.12)" : "transparent",
                  border: activeBotId === bot.id ? "1px solid rgba(91,140,255,0.25)" : "1px solid transparent",
                }}
                onMouseEnter={e => {
                  if (activeBotId !== bot.id) (e.currentTarget as HTMLElement).style.background = "var(--atlas-nav-hover-bg)";
                }}
                onMouseLeave={e => {
                  if (activeBotId !== bot.id) (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-base flex-shrink-0" style={{ background: "rgba(91,140,255,0.1)" }}>
                  {bot.avatar || "🤖"}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>{bot.name}</div>
                  <div className="text-xs truncate" style={{ color: "var(--atlas-text-3)" }}>
                    {bot.webhookUrl ? "✓ 已配置" : "⚠ 未配置 Webhook"}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Divider */}
        <div className="px-4 py-2 flex-shrink-0">
          <div className="text-xs font-medium" style={{ color: "var(--atlas-text-3)" }}>
            同事
          </div>
        </div>

        {/* Contact search */}
        <div className="px-2 pb-1 flex-shrink-0">
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: "var(--atlas-text-3)" }}
            />
            <input
              value={contactSearch}
              onChange={e => setContactSearch(e.target.value)}
              placeholder="搜索同事..."
              className="w-full rounded-md text-xs pl-7 pr-3 py-1.5 outline-none"
              style={{
                background: "var(--atlas-elevated)",
                border: "1px solid var(--atlas-border)",
                color: "var(--atlas-text)",
              }}
            />
          </div>
        </div>

        {/* Contacts list */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {filteredContacts.length === 0 && (
            <div className="text-xs text-center py-4" style={{ color: "var(--atlas-text-3)" }}>
              {contacts.length === 0 ? "暂无其他用户" : "未找到匹配用户"}
            </div>
          )}
          {filteredContacts.map(contact => {
            const existingConv = conversations.find(
              c => !c.isAi && c.otherUser?.id === contact.id
            );
            const isActive = existingConv?.id === activeConvId;
            return (
              <button
                key={contact.id}
                onClick={() => {
                  setActiveBotId(null);
                  if (existingConv) {
                    setActiveConvId(existingConv.id);
                  } else {
                    handleSelectContact(contact.id);
                  }
                }}
                className="w-full flex items-center gap-3 rounded-lg px-3 py-2 transition-all"
                style={{
                  background: isActive ? "var(--atlas-nav-active-bg)" : "transparent",
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.background = "var(--atlas-nav-hover-bg)";
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                  }
                }}
              >
                <div className="relative flex-shrink-0">
                  <Avatar name={contact.displayName} size={28} />
                  <span
                    className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                    style={{
                      background: contact.isOnline ? "#34D399" : "#6B7280",
                      borderColor: "var(--atlas-surface)",
                    }}
                  />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-sm truncate" style={{ color: "var(--atlas-text)" }}>
                    {contact.displayName}
                  </div>
                  {existingConv?.lastMessage && (
                    <div className="text-xs truncate" style={{ color: "var(--atlas-text-3)" }}>
                      {existingConv.lastMessage}
                    </div>
                  )}
                </div>
                {existingConv && existingConv.unreadCount > 0 && (
                  <span
                    className="text-xs font-bold rounded-full px-1.5 py-0.5 flex-shrink-0"
                    style={{ background: "var(--atlas-accent)", color: "#fff", fontSize: 10 }}
                  >
                    {existingConv.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {isBotActive && activeBotId ? (
          // 机器人对话面板
          <BotChatPanel
            bot={botList.find(b => b.id === activeBotId)!}
            messages={botMessages[activeBotId] || []}
            inputText={botInput}
            setInputText={setBotInput}
            onSend={(text) => {
              const botId = activeBotId;
              const localMsg: BotMessage = {
                id: `local-${Date.now()}`,
                role: "user",
                content: text,
                createdAt: new Date().toISOString(),
              };
              setBotMessages(prev => ({ ...prev, [botId]: [...(prev[botId] || []), localMsg] }));
              setBotInput("");
              sendBotMsg.mutate({ botId, content: text }, {
                onSuccess: (data) => {
                  setBotMessages(prev => ({
                    ...prev,
                    [botId]: (prev[botId] || []).map(m => m.id === localMsg.id ? { ...m, id: data.msgId } : m),
                  }));
                },
              });
            }}
          />
        ) : !activeConvId ? (
          // Empty state
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <MessageSquare size={40} style={{ color: "var(--atlas-text-3)", opacity: 0.4 }} />
            <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>
              选择一个联系人开始聊天
            </p>
          </div>
        ) : isOpenClawActive ? (
          // 小虾米对话面板
          <OpenClawPanel
            messages={openClawMessages}
            inputText={openClawInput}
            setInputText={setOpenClawInput}
            isOnline={openClawOnline}
            onSend={(text) => {
              // 1. 本地先显示
              const localMsg = {
                id: `local-${Date.now()}`,
                role: "user" as const,
                content: text,
                createdAt: new Date().toISOString(),
              };
              setOpenClawMessages(prev => [...prev, localMsg]);
              setOpenClawInput("");
              // 2. HTTP POST 到后端，后端存库并推送 Webhook
              fetch("/api/openclaw/admin/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ content: text }),
              })
                .then(r => r.json())
                .then((data: { success: boolean; msgId: string; webhookStatus: string }) => {
                  // 用服务器返回的真实 msgId 替换本地临时 ID
                  setOpenClawMessages(prev =>
                    prev.map(m => m.id === localMsg.id ? { ...m, id: data.msgId } : m)
                  );
                  if (data.webhookStatus === "no_webhook_configured") {
                    toast.warning("小虾米 Webhook 未配置，消息已存库但未推送");
                  }
                })
                .catch(() => toast.error("发送失败，请重试"));
            }}
          />
        ) : (
          <>
            {/* Chat header */}
            <div
              className="flex items-center gap-3 px-5 flex-shrink-0"
              style={{
                height: 52,
                borderBottom: "1px solid var(--atlas-border)",
                background: "var(--atlas-surface)",
              }}
            >
              {activeConv && (
                <>
                  <Avatar
                    name={activeConv.isAi ? "AI" : getConvName(activeConv)}
                    isAi={activeConv.isAi}
                    size={30}
                  />
                  <div>
                    <div className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>
                      {activeConv.isAi ? "AI 助手" : getConvName(activeConv)}
                    </div>
                    {activeConv.isAi && (
                      <div className="text-xs flex items-center gap-1.5" style={{ color: "var(--atlas-text-3)" }}>
                        {(() => {
                          const agent = currentAgentType[activeConvId ?? ""];
                          const agentLabels: Record<string, { label: string; color: string }> = {
                            data_analysis: { label: "数据分析", color: "#3b82f6" },
                            hr: { label: "HR 助手", color: "#8b5cf6" },
                            quality_monitor: { label: "质量监控", color: "#f59e0b" },
                            general: { label: "通用助手", color: "#10b981" },
                          };
                          const info = agent ? agentLabels[agent] : null;
                          return info ? (
                            <span
                              className="px-1.5 py-0.5 rounded text-xs font-medium"
                              style={{ background: `${info.color}20`, color: info.color }}
                            >
                              {info.label}
                            </span>
                          ) : null;
                        })()}
                        由千问 AI 驱动 · 接入 OpenClaw 后升级
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {currentMessages.length === 0 && !streamingText && (
                <div className="flex flex-col items-center justify-center h-full gap-2">
                  {activeConv?.isAi ? (
                    <>
                      <Avatar name="AI" isAi size={48} />
                      <p className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>
                        你好！我是 ATLAS AI 助手
                      </p>
                      <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
                        可以问我数据分析、报表生成、业务问题等
                      </p>
                    </>
                  ) : (
                    <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>
                      发送第一条消息开始对话
                    </p>
                  )}
                </div>
              )}

              <AnimatePresence initial={false}>
                {currentMessages.map(msg => {
                  const isMe = msg.senderId === myUserId;
                  const isAiMsg = msg.senderId === 0;
                  const isRecalled = (msg as {type?: string}).type === "recalled" || msg.content === "[消息已撤回]";
                  const sentAt = new Date(msg.createdAt).getTime();
                  const canRecall = isMe && !isRecalled && Date.now() - sentAt < 2 * 60 * 1000;

                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                      className={`flex gap-3 group ${isMe ? "flex-row-reverse" : "flex-row"}`}
                    >
                      {!isMe && (
                        <Avatar
                          name={isAiMsg ? "AI" : msg.senderName}
                          isAi={isAiMsg}
                          size={30}
                        />
                      )}
                      <div className="relative max-w-[70%]">
                        {isRecalled ? (
                          <div
                            className="rounded-2xl px-4 py-2.5 text-sm italic"
                            style={{ color: "var(--atlas-text-3)", background: "var(--atlas-elevated)" }}
                          >
                            消息已撤回
                          </div>
                        ) : (
                          <>
                            <div
                              className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                                isMe ? "rounded-tr-sm" : "rounded-tl-sm"
                              }`}
                              style={{
                                background: isMe
                                  ? "var(--atlas-accent)"
                                  : "var(--atlas-elevated)",
                                color: isMe ? "#fff" : "var(--atlas-text)",
                              }}
                            >
                              {isAiMsg ? (
                                <div className="prose prose-sm max-w-none dark:prose-invert">
                                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                                </div>
                              ) : (
                                <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
                              )}
                              <div
                                className="text-xs mt-1 opacity-60"
                                style={{ textAlign: isMe ? "right" : "left" }}
                              >
                                {new Date(msg.createdAt).toLocaleTimeString("zh-CN", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </div>
                            </div>
                            {/* Action buttons on hover */}
                            <div
                              className="absolute -bottom-5 opacity-0 group-hover:opacity-100 transition-all duration-150 flex items-center gap-1"
                              style={{ [isMe ? "left" : "right"]: 4, zIndex: 10 }}
                            >
                              {/* Copy button */}
                              <button
                                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shadow-sm"
                                style={{ background: "#1a1a1a", color: "#fff", border: "1px solid rgba(255,255,255,0.1)" }}
                                onClick={() => {
                                  navigator.clipboard.writeText(msg.content)
                                    .then(() => toast.success("已复制"))
                                    .catch(() => toast.error("复制失败"));
                                }}
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </svg>
                                复制
                              </button>
                              {/* Recall button (own messages within 2min) */}
                              {canRecall && (
                                <button
                                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shadow-sm"
                                  style={{ background: "rgba(239,68,68,0.85)", color: "#fff", border: "1px solid rgba(255,255,255,0.1)" }}
                                  onClick={() => {
                                    send({ type: "recall_message", messageId: msg.id, conversationId: msg.conversationId });
                                  }}
                                >
                                  撤回
                                </button>
                              )}
                            </div>
                          </>
                        )}
                        {/* Suggested actions for AI messages */}
                        {isAiMsg && !isRecalled && (() => {
                          const fileInfo = (msg as {fileInfo?: {suggestedActions?: string[]}}).fileInfo;
                          const actions = fileInfo?.suggestedActions;
                          if (!actions || actions.length === 0) return null;
                          return (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {actions.map((action: string) => (
                                <button
                                  key={action}
                                  className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                                  style={{
                                    background: "var(--atlas-elevated)",
                                    border: "1px solid var(--atlas-border)",
                                    color: "var(--atlas-accent)",
                                  }}
                                  onMouseEnter={e => {
                                    (e.currentTarget as HTMLElement).style.background = "var(--atlas-accent)";
                                    (e.currentTarget as HTMLElement).style.color = "#fff";
                                  }}
                                  onMouseLeave={e => {
                                    (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
                                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
                                  }}
                                  onClick={() => {
                                    setInputText(action);
                                    handleSend(action);
                                  }}
                                >
                                  {action}
                                </button>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                      {isMe && (
                        <Avatar name={user?.name ?? "我"} size={30} />
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {/* Streaming AI response */}
              {streamingText && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3"
                >
                  <Avatar name="AI" isAi size={30} />
                  <div
                    className="max-w-[70%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed"
                    style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text)" }}
                  >
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <ReactMarkdown>{streamingText}</ReactMarkdown>
                    </div>
                    <Loader2 size={12} className="animate-spin mt-1 opacity-50" />
                  </div>
                </motion.div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input box — Feishu style */}
            <FeishuChatInput
              value={inputText}
              onChange={setInputText}
              onSend={() => handleSend()}
              disabled={!connected}
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            />
          </>
        )}
        </div>
      </div>
    </div>
  );
}

// ── OpenClaw 小虾米对话面板 ─────────────────────────────────────────────────────

interface OpenClawPanelProps {
  messages: Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string }>;
  inputText: string;
  setInputText: (v: string) => void;
  isOnline: boolean;
  onSend: (text: string) => void;
}

function OpenClawPanel({ messages, inputText, setInputText, isOnline, onSend }: OpenClawPanelProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (inputText.trim()) onSend(inputText.trim());
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 flex-shrink-0"
        style={{
          height: 52,
          borderBottom: "1px solid var(--atlas-border)",
          background: "var(--atlas-surface)",
        }}
      >
        <Avatar name="小虾米" isOpenClaw size={30} />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>
              小虾米
            </span>
            <span
              className="text-xs px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(249,115,22,0.15)", color: "#f97316", fontSize: 10 }}
            >
              质量监控
            </span>
          </div>
          <div className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
            {isOnline ? "❖ Webhook 已配置 · 消息可正常收发" : "未配置 Webhook URL · 请在设置页配置"}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <Avatar name="小虾米" isOpenClaw size={56} />
            <div className="text-center">
              <p className="text-sm font-medium mb-1" style={{ color: "var(--atlas-text)" }}>
                小虾米 · 智能质量监控
              </p>
              <p className="text-xs max-w-xs text-center" style={{ color: "var(--atlas-text-3)" }}>
                小虾米会实时监控 Qwen 对用户数据的处理过程，发现误解或错误时主动介入纠正
              </p>
            </div>
            <div
              className="rounded-xl p-4 max-w-sm w-full"
              style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}
            >
              <div className="text-xs font-medium mb-2" style={{ color: "var(--atlas-text-2)" }}>
                监控能力
              </div>
              <div className="space-y-2">
                {[
                  { icon: "👁", text: "Level 1：被动监控，接收所有用户输入和 Qwen 输出" },
                  { icon: "💬", text: "Level 2：异步介入，在 Qwen 回复后补充或纠正" },
                  { icon: "⚡", text: "Level 3：实时接管，中断 Qwen 流式输出（规划中）" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-sm flex-shrink-0">{item.icon}</span>
                    <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
            {!isOnline && (
              <div
                className="rounded-lg px-4 py-3 max-w-sm w-full"
                style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.2)" }}
              >
                <p className="text-xs" style={{ color: "#f97316" }}>
                  ⚠️ 小虾米 Webhook 未配置。请在设置页配置 OPENCLAW_WEBHOOK_URL 环境变量，或联系小虾米工程师提供 Webhook 地址。
                </p>
              </div>
            )}
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map(msg => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
              className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              {msg.role === "assistant" && <Avatar name="小虾米" isOpenClaw size={30} />}
              <div
                className={`max-w-[70%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user" ? "rounded-tr-sm" : "rounded-tl-sm"
                }`}
                style={{
                  background: msg.role === "user" ? "var(--atlas-accent)" : "var(--atlas-elevated)",
                  color: msg.role === "user" ? "#fff" : "var(--atlas-text)",
                }}
              >
                <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
                <div
                  className="text-xs mt-1 opacity-60"
                  style={{ textAlign: msg.role === "user" ? "right" : "left" }}
                >
                  {new Date(msg.createdAt).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        <div ref={endRef} />
      </div>

      {/* Input — Feishu style */}
      <FeishuChatInput
        value={inputText}
        onChange={setInputText}
        onSend={(text) => { if (text.trim()) onSend(text.trim()); }}
        placeholder="给小虾米发消息..."
        disabled={!isOnline}
      />
    </div>
  );
}

// ── BotChatPanel ─────────────────────────────────────────────────────────────

interface BotChatPanelProps {
  bot: BotInfo;
  messages: BotMessage[];
  inputText: string;
  setInputText: (v: string) => void;
  onSend: (text: string) => void;
}

function BotChatPanel({ bot, messages, inputText, setInputText, onSend }: BotChatPanelProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (inputText.trim()) onSend(inputText.trim());
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 flex-shrink-0"
        style={{ height: 52, borderBottom: "1px solid var(--atlas-border)", background: "var(--atlas-surface)" }}
      >
        <div className="w-8 h-8 rounded-xl flex items-center justify-center text-lg" style={{ background: "rgba(91,140,255,0.12)" }}>
          {bot?.avatar || "🤖"}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>{bot?.name}</span>
            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ background: "rgba(91,140,255,0.12)", color: "var(--atlas-accent)", fontSize: 10 }}>
              机器人
            </span>
          </div>
          <div className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
            {bot?.webhookUrl ? "✓ Webhook 已配置 · 消息可正常收发" : "⚠ 未配置 Webhook URL · 请在设置→集成中配置"}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl" style={{ background: "rgba(91,140,255,0.1)" }}>
              {bot?.avatar || "🤖"}
            </div>
            <div className="text-center">
              <p className="text-sm font-medium mb-1" style={{ color: "var(--atlas-text)" }}>{bot?.name}</p>
              <p className="text-xs max-w-xs" style={{ color: "var(--atlas-text-3)" }}>
                {bot?.description || "发送消息开始对话"}
              </p>
            </div>
          </div>
        )}
        {messages.map(msg => {
          const isUser = msg.role === "user";
          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
            >
              {!isUser && (
                <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0" style={{ background: "rgba(91,140,255,0.12)" }}>
                  {bot?.avatar || "🤖"}
                </div>
              )}
              <div
                className={`max-w-[70%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${isUser ? "rounded-tr-sm" : "rounded-tl-sm"}`}
                style={{ background: isUser ? "var(--atlas-accent)" : "var(--atlas-elevated)", color: isUser ? "#fff" : "var(--atlas-text)" }}
              >
                <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
                <div className="text-xs mt-1 opacity-60" style={{ textAlign: isUser ? "right" : "left" }}>
                  {new Date(msg.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </motion.div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Input — Feishu style */}
      <FeishuChatInput
        value={inputText}
        onChange={setInputText}
        onSend={(text) => { if (text.trim()) onSend(text.trim()); }}
        placeholder={`给 ${bot?.name || "机器人"} 发消息...`}
      />
    </div>
  );
}