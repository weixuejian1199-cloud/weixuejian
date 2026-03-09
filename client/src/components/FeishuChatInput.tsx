/**
 * FeishuChatInput — 飞书风格聊天输入框
 *
 * 功能：
 * - 底部工具栏（Aa / 表情 / @ / 附件 / 全屏 / 发送）
 * - 文件上传（拖拽或点击附件图标）
 * - 文件预览（输入框上方显示文件缩略图/图标）
 * - 发送中 loading 状态
 * - 错误提示（发送失败时）
 * - Enter 发送，Shift+Enter 换行
 */

import { useRef, useState, useCallback, useEffect, lazy, Suspense } from "react";

const FullscreenEditorComponent = lazy(() => import("./FullscreenEditor"));
function FullscreenEditorLazy(props: Parameters<typeof import('./FullscreenEditor').default>[0]) {
  return (
    <Suspense fallback={null}>
      <FullscreenEditorComponent {...props} />
    </Suspense>
  );
}
import {
  Type,
  Smile,
  AtSign,
  Paperclip,
  Maximize2,
  Send,
  X,
  FileText,
  Image,
  FileSpreadsheet,
  File,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  url?: string;
  localUrl?: string; // for image preview
  uploading?: boolean;
  error?: boolean;
}

interface FeishuChatInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string, files?: UploadedFile[]) => void;
  placeholder?: string;
  disabled?: boolean;
  sending?: boolean;
  /** If provided, files will be uploaded via this function */
  onUploadFile?: (file: File) => Promise<UploadedFile>;
  /** Max file size in bytes (default 20MB) */
  maxFileSize?: number;
  /** Accepted file types (default all) */
  acceptedTypes?: string;
  className?: string;
  /** Recipient name shown in fullscreen editor placeholder */
  recipientName?: string;
  /** Called when fullscreen editor sends content */
  onFullscreenSend?: (text: string) => void;
}

// ── File icon helper ──────────────────────────────────────────────────────────

function FileIcon({ type, size = 16 }: { type: string; size?: number }) {
  if (type.startsWith("image/")) return <Image size={size} className="text-blue-400" />;
  if (type.includes("spreadsheet") || type.includes("excel") || type.endsWith(".xlsx") || type.endsWith(".csv"))
    return <FileSpreadsheet size={size} className="text-green-400" />;
  if (type.includes("pdf")) return <FileText size={size} className="text-red-400" />;
  return <File size={size} className="text-gray-400" />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function FeishuChatInput({
  value,
  onChange,
  onSend,
  placeholder = "发送消息，Enter 发送，Shift+Enter 换行",
  disabled = false,
  sending = false,
  onUploadFile,
  maxFileSize = 20 * 1024 * 1024,
  acceptedTypes = "*",
  className = "",
  recipientName = "",
  onFullscreenSend,
}: FeishuChatInputProps) {
  const [showFullscreen, setShowFullscreen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  // Handle file selection
  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const arr = Array.from(fileList);
      for (const file of arr) {
        if (file.size > maxFileSize) {
          toast.error(`文件 ${file.name} 超过 ${formatBytes(maxFileSize)} 限制`);
          continue;
        }
        const id = `file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const localUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        const pending: UploadedFile = {
          id,
          name: file.name,
          size: file.size,
          type: file.type,
          localUrl,
          uploading: !!onUploadFile,
        };
        setFiles(prev => [...prev, pending]);

        if (onUploadFile) {
          try {
            const uploaded = await onUploadFile(file);
            setFiles(prev =>
              prev.map(f => (f.id === id ? { ...uploaded, id, localUrl, uploading: false } : f))
            );
          } catch {
            setFiles(prev =>
              prev.map(f => (f.id === id ? { ...f, uploading: false, error: true } : f))
            );
            toast.error(`上传 ${file.name} 失败`);
          }
        }
      }
    },
    [onUploadFile, maxFileSize]
  );

  const removeFile = useCallback((id: string) => {
    setFiles(prev => {
      const f = prev.find(x => x.id === id);
      if (f?.localUrl) URL.revokeObjectURL(f.localUrl);
      return prev.filter(x => x.id !== id);
    });
  }, []);

  // Send
  const handleSend = useCallback(() => {
    const text = value.trim();
    if ((!text && files.length === 0) || disabled || sending) return;
    if (files.some(f => f.uploading)) {
      toast.warning("文件正在上传中，请稍候...");
      return;
    }
    onSend(text, files.length > 0 ? files : undefined);
    setFiles([]);
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, files, disabled, sending, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Drag & drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const canSend = (value.trim().length > 0 || files.length > 0) && !disabled && !sending;

  return (
    <div
      className={`flex-shrink-0 ${className}`}
      style={{ borderTop: "1px solid var(--atlas-border)", background: "var(--atlas-surface)" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center rounded-lg"
          style={{ background: "rgba(91,140,255,0.08)", border: "2px dashed var(--atlas-accent)" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--atlas-accent)" }}>
            松开鼠标上传文件
          </p>
        </div>
      )}

      {/* File previews */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {files.map(f => (
            <div
              key={f.id}
              className="relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs"
              style={{
                background: f.error
                  ? "rgba(239,68,68,0.08)"
                  : "var(--atlas-elevated)",
                border: `1px solid ${f.error ? "rgba(239,68,68,0.3)" : "var(--atlas-border)"}`,
                maxWidth: 200,
              }}
            >
              {f.type.startsWith("image/") && f.localUrl ? (
                <img
                  src={f.localUrl}
                  alt={f.name}
                  className="w-8 h-8 rounded object-cover flex-shrink-0"
                />
              ) : (
                <FileIcon type={f.type} size={18} />
              )}
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium" style={{ color: "var(--atlas-text)", maxWidth: 120 }}>
                  {f.name}
                </div>
                <div style={{ color: "var(--atlas-text-3)" }}>
                  {f.uploading ? (
                    <span className="flex items-center gap-1">
                      <Loader2 size={10} className="animate-spin" /> 上传中
                    </span>
                  ) : f.error ? (
                    <span style={{ color: "#ef4444" }}>上传失败</span>
                  ) : (
                    formatBytes(f.size)
                  )}
                </div>
              </div>
              <button
                onClick={() => removeFile(f.id)}
                className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center hover:bg-red-500/20 transition-colors"
                style={{ color: "var(--atlas-text-3)" }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="px-4 pt-2 pb-1">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="w-full resize-none bg-transparent outline-none text-sm leading-relaxed"
          style={{
            color: "var(--atlas-text)",
            minHeight: 36,
            maxHeight: 160,
            overflowY: "auto",
            opacity: disabled ? 0.5 : 1,
          }}
        />
      </div>

      {/* Toolbar */}
      <div
        className="flex items-center px-3 pb-2.5 gap-0.5"
        style={{ borderTop: isFocused ? "1px solid transparent" : "none" }}
      >
        {/* Left tools */}
        <div className="flex items-center gap-0.5 flex-1">
          <ToolButton
            icon={<Type size={15} />}
            title="文字格式"
            onClick={() => toast.info("文字格式（即将支持）")}
          />
          <ToolButton
            icon={<Smile size={15} />}
            title="表情"
            onClick={() => toast.info("表情（即将支持）")}
          />
          <ToolButton
            icon={<AtSign size={15} />}
            title="@提及"
            onClick={() => toast.info("@提及（即将支持）")}
          />
          <div className="w-px h-4 mx-1" style={{ background: "var(--atlas-border)" }} />
          <ToolButton
            icon={<Paperclip size={15} />}
            title="上传文件"
            onClick={() => fileInputRef.current?.click()}
          />
          <ToolButton
            icon={<Maximize2 size={15} />}
            title="全屏编辑"
            onClick={() => setShowFullscreen(true)}
          />
        </div>

        {/* Send button */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {sending && (
            <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
              发送中...
            </span>
          )}
          <button
            onClick={handleSend}
            disabled={!canSend}
            title="发送 (Enter)"
            className="flex items-center justify-center rounded-lg transition-all"
            style={{
              width: 32,
              height: 32,
              background: canSend ? "var(--atlas-accent)" : "var(--atlas-elevated)",
              color: canSend ? "#fff" : "var(--atlas-text-3)",
              border: `1px solid ${canSend ? "transparent" : "var(--atlas-border)"}`,
              cursor: canSend ? "pointer" : "not-allowed",
            }}
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>

      {/* Fullscreen editor */}
      {showFullscreen && (
        <FullscreenEditorLazy
          initialText={value}
          recipientName={recipientName}
          onClose={() => setShowFullscreen(false)}
          onSend={(_html, text) => {
            if (onFullscreenSend) {
              onFullscreenSend(text);
            } else {
              onSend(text);
            }
          }}
        />
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={acceptedTypes}
        className="hidden"
        onChange={e => {
          if (e.target.files) {
            handleFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />
    </div>
  );
}

// ── Tool button ────────────────────────────────────────────────────────────────

function ToolButton({
  icon,
  title,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
      style={{ color: "var(--atlas-text-3)" }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
        (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
        (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
      }}
    >
      {icon}
    </button>
  );
}
