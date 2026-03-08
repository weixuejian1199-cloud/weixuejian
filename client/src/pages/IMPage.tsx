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
import { Bot, User, Send, Loader2, Circle, MessageSquare, Search, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAtlas } from "@/contexts/AtlasContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

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

// ── WebSocket hook ─────────────────────────────────────────────────────────────

function useImWebSocket(token: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [conversations, setConversations] = useState<IMConversation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<Record<string, IMMessage[]>>({});
  const [streamingTokens, setStreamingTokens] = useState<Record<string, string>>({});
  const pingInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    if (!token) return;

    const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/im?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Load initial data
      ws.send(JSON.stringify({ type: "get_conversations" }));
      ws.send(JSON.stringify({ type: "get_contacts" }));
      // Keepalive ping every 25s
      pingInterval.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 25000);
    };

    ws.onclose = () => {
      setConnected(false);
      if (pingInterval.current) clearInterval(pingInterval.current);
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
          case "error":
            console.error("[IM WS]", msg.message);
            break;
        }
      } catch {
        // ignore parse errors
      }
    };

    return () => {
      if (pingInterval.current) clearInterval(pingInterval.current);
      ws.close();
    };
  }, [token]);

  return { connected, conversations, contacts, messages, streamingTokens, send, setConversations };
}

// ── Avatar ─────────────────────────────────────────────────────────────────────

function Avatar({ name, isAi, size = 32 }: { name: string; isAi?: boolean; size?: number }) {
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

export default function IMPage() {
  const { user } = useAtlas();
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch WS token
  const { data: tokenData } = trpc.im.getWsToken.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: false,
  });

  const { connected, conversations, contacts, messages, streamingTokens, send } =
    useImWebSocket(tokenData?.token ?? null);

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

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || !activeConvId) return;
    send({ type: "send_message", conversationId: activeConvId, content: text });
    setInputText("");
  }, [inputText, activeConvId, send]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const activeConv = conversations.find(c => c.id === activeConvId);
  const currentMessages = activeConvId ? (messages[activeConvId] ?? []) : [];
  const streamingText = activeConvId ? (streamingTokens[activeConvId] ?? "") : "";
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
    <div className="flex h-full overflow-hidden" style={{ background: "var(--atlas-bg)" }}>
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
              fill={connected ? "#34D399" : "#6B7280"}
              style={{ color: connected ? "#34D399" : "#6B7280" }}
            />
            <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
              {connected ? "在线" : "连接中"}
            </span>
          </div>
        </div>

        {/* AI Assistant entry */}
        <div className="px-2 pt-2 flex-shrink-0">
          <button
            onClick={() => {
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
        {!activeConvId ? (
          // Empty state
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <MessageSquare size={40} style={{ color: "var(--atlas-text-3)", opacity: 0.4 }} />
            <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>
              选择一个联系人开始聊天
            </p>
          </div>
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
                      <div className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
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
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                      className={`flex gap-3 ${isMe ? "flex-row-reverse" : "flex-row"}`}
                    >
                      {!isMe && (
                        <Avatar
                          name={isAiMsg ? "AI" : msg.senderName}
                          isAi={isAiMsg}
                          size={30}
                        />
                      )}
                      <div
                        className={`max-w-[70%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
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

            {/* Input box */}
            <div
              className="flex-shrink-0 px-4 py-3"
              style={{ borderTop: "1px solid var(--atlas-border)", background: "var(--atlas-surface)" }}
            >
              <div
                className="flex items-end gap-2 rounded-xl px-3 py-2"
                style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}
              >
                <textarea
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                  rows={1}
                  className="flex-1 resize-none bg-transparent outline-none text-sm py-1"
                  style={{
                    color: "var(--atlas-text)",
                    maxHeight: 120,
                    overflowY: "auto",
                  }}
                  onInput={e => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={!inputText.trim() || !connected}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-all flex-shrink-0 mb-0.5"
                  style={{
                    background: inputText.trim() && connected ? "var(--atlas-accent)" : "var(--atlas-border)",
                    color: inputText.trim() && connected ? "#fff" : "var(--atlas-text-3)",
                  }}
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
