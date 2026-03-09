/**
 * FullscreenEditor — 飞书风格全屏编辑器
 *
 * 布局：
 * - 顶部格式工具栏（B / S / I / U / 有序列表 / 无序列表 / 引用 / 链接 / 代码块 + 右上角收起）
 * - 中间大面积编辑区（标题 + 正文，基于 Tiptap）
 * - 底部工具栏（表情 / @ / 剪刀 / 图片 / 发送 / 更多）
 */

import { useEffect, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Strikethrough,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Quote,
  Link2,
  Code2,
  Minimize2,
  Smile,
  AtSign,
  Scissors,
  Image,
  Send,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";

interface FullscreenEditorProps {
  /** Initial text content (plain text, will be set as paragraph) */
  initialText?: string;
  /** Recipient name shown in placeholder */
  recipientName?: string;
  onClose: () => void;
  onSend: (html: string, text: string) => void;
}

export default function FullscreenEditor({
  initialText = "",
  recipientName = "",
  onClose,
  onSend,
}: FullscreenEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({
        placeholder: recipientName ? `发送给 ${recipientName}` : "在这里输入内容...",
      }),
    ],
    content: initialText ? `<p>${initialText}</p>` : "",
    autofocus: "end",
  });

  // Cmd/Ctrl+Enter to send
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        handleSend();
      }
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const handleSend = useCallback(() => {
    if (!editor) return;
    const html = editor.getHTML();
    const text = editor.getText();
    if (!text.trim()) return;
    onSend(html, text);
    onClose();
  }, [editor, onSend, onClose]);

  if (!editor) return null;

  const ToolBtn = ({
    onClick,
    active,
    title,
    children,
  }: {
    onClick: () => void;
    active?: boolean;
    title: string;
    children: React.ReactNode;
  }) => (
    <button
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      title={title}
      className="w-8 h-8 rounded-md flex items-center justify-center transition-colors text-sm font-medium"
      style={{
        background: active ? "rgba(91,140,255,0.12)" : "transparent",
        color: active ? "var(--atlas-accent)" : "var(--atlas-text-2)",
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      {children}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "var(--atlas-surface)" }}
    >
      {/* ── Top format toolbar ── */}
      <div
        className="flex items-center gap-0.5 px-4 flex-shrink-0"
        style={{
          height: 48,
          borderBottom: "1px solid var(--atlas-border)",
          background: "var(--atlas-surface)",
        }}
      >
        <ToolBtn
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="加粗 (Ctrl+B)"
        >
          <Bold size={15} />
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive("strike")}
          title="删除线"
        >
          <Strikethrough size={15} />
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="斜体 (Ctrl+I)"
        >
          <Italic size={15} />
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          title="下划线 (Ctrl+U)"
        >
          <UnderlineIcon size={15} />
        </ToolBtn>

        <div className="w-px h-5 mx-1.5" style={{ background: "var(--atlas-border)" }} />

        <ToolBtn
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="有序列表"
        >
          <ListOrdered size={15} />
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="无序列表"
        >
          <List size={15} />
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive("blockquote")}
          title="引用"
        >
          <Quote size={15} />
        </ToolBtn>

        <div className="w-px h-5 mx-1.5" style={{ background: "var(--atlas-border)" }} />

        <ToolBtn
          onClick={() => {
            const url = window.prompt("输入链接 URL");
            if (url) editor.chain().focus().setLink({ href: url }).run();
          }}
          active={editor.isActive("link")}
          title="插入链接"
        >
          <Link2 size={15} />
        </ToolBtn>
        <ToolBtn
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive("code")}
          title="代码"
        >
          <Code2 size={15} />
        </ToolBtn>

        {/* Collapse button — right side */}
        <div className="ml-auto">
          <button
            onClick={onClose}
            title="收起全屏 (Esc)"
            className="w-8 h-8 rounded-md flex items-center justify-center transition-colors"
            style={{ color: "var(--atlas-text-3)" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
              (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
            }}
          >
            <Minimize2 size={15} />
          </button>
        </div>
      </div>

      {/* ── Editor area ── */}
      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="max-w-3xl mx-auto">
          {/* Title placeholder */}
          <div
            className="text-lg font-medium mb-4 pb-3"
            style={{
              color: "var(--atlas-text-3)",
              borderBottom: "1px solid var(--atlas-border)",
            }}
          >
            无标题
          </div>

          {/* Tiptap editor */}
          <EditorContent
            editor={editor}
            className="tiptap-fullscreen"
          />
        </div>
      </div>

      {/* ── Bottom toolbar ── */}
      <div
        className="flex items-center px-6 py-3 gap-2"
        style={{
          borderTop: "1px solid var(--atlas-border)",
          background: "var(--atlas-surface)",
        }}
      >
        {/* Left tools */}
        <div className="flex items-center gap-1 flex-1">
          <BottomToolBtn icon={<Smile size={16} />} title="表情" onClick={() => toast.info("表情（即将支持）")} />
          <BottomToolBtn icon={<AtSign size={16} />} title="@提及" onClick={() => toast.info("@提及（即将支持）")} />
          <BottomToolBtn
            icon={<Scissors size={16} />}
            title="剪切"
            onClick={() => document.execCommand("cut")}
          />
          <BottomToolBtn icon={<Image size={16} />} title="插入图片" onClick={() => toast.info("图片上传（即将支持）")} />
        </div>

        {/* Send */}
        <div className="flex items-center gap-1">
          <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
            Ctrl+Enter 发送
          </span>
          <button
            onClick={handleSend}
            disabled={!editor.getText().trim()}
            className="flex items-center gap-1.5 px-4 h-8 rounded-lg text-sm font-medium transition-all"
            style={{
              background: editor.getText().trim() ? "var(--atlas-accent)" : "var(--atlas-elevated)",
              color: editor.getText().trim() ? "#fff" : "var(--atlas-text-3)",
              border: `1px solid ${editor.getText().trim() ? "transparent" : "var(--atlas-border)"}`,
            }}
          >
            <Send size={13} />
            发送
          </button>
          <button
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{
              background: "var(--atlas-elevated)",
              color: "var(--atlas-text-3)",
              border: "1px solid var(--atlas-border)",
            }}
            title="更多选项"
            onClick={() => toast.info("更多选项（即将支持）")}
          >
            <ChevronDown size={14} />
          </button>
        </div>
      </div>

      {/* Tiptap styles */}
      <style>{`
        .tiptap-fullscreen .ProseMirror {
          outline: none;
          min-height: 300px;
          font-size: 15px;
          line-height: 1.7;
          color: var(--atlas-text);
        }
        .tiptap-fullscreen .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: var(--atlas-text-3);
          pointer-events: none;
          float: left;
          height: 0;
        }
        .tiptap-fullscreen .ProseMirror h1 { font-size: 1.5rem; font-weight: 700; margin: 1rem 0 0.5rem; }
        .tiptap-fullscreen .ProseMirror h2 { font-size: 1.25rem; font-weight: 600; margin: 0.75rem 0 0.5rem; }
        .tiptap-fullscreen .ProseMirror h3 { font-size: 1.1rem; font-weight: 600; margin: 0.5rem 0 0.25rem; }
        .tiptap-fullscreen .ProseMirror ul, .tiptap-fullscreen .ProseMirror ol { padding-left: 1.5rem; margin: 0.5rem 0; }
        .tiptap-fullscreen .ProseMirror li { margin: 0.2rem 0; }
        .tiptap-fullscreen .ProseMirror blockquote {
          border-left: 3px solid var(--atlas-accent);
          padding-left: 1rem;
          color: var(--atlas-text-2);
          margin: 0.5rem 0;
        }
        .tiptap-fullscreen .ProseMirror code {
          background: var(--atlas-elevated);
          border-radius: 4px;
          padding: 0.1em 0.3em;
          font-family: monospace;
          font-size: 0.9em;
        }
        .tiptap-fullscreen .ProseMirror a { color: var(--atlas-accent); text-decoration: underline; }
        .tiptap-fullscreen .ProseMirror strong { font-weight: 700; }
        .tiptap-fullscreen .ProseMirror em { font-style: italic; }
        .tiptap-fullscreen .ProseMirror s { text-decoration: line-through; }
        .tiptap-fullscreen .ProseMirror u { text-decoration: underline; }
      `}</style>
    </div>
  );
}

function BottomToolBtn({
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
      className="w-8 h-8 rounded-md flex items-center justify-center transition-colors"
      style={{ color: "var(--atlas-text-3)" }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
        (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
        (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
      }}
    >
      {icon}
    </button>
  );
}
