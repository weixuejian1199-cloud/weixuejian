/**
 * ATLAS V4.0 — Login Modal
 * Clean auth modal with email/password + social login hints
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mail, Lock, Eye, EyeOff, Loader2, Shield } from "lucide-react";
import { useAtlas } from "@/contexts/AtlasContext";
import { toast } from "sonner";
import { nanoid } from "nanoid";

export default function LoginModal() {
  const { setShowLoginModal, setUser } = useAtlas();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast.error("请填写完整信息"); return; }
    setLoading(true);
    // Simulate auth — replace with real API call
    await new Promise(r => setTimeout(r, 900));
    setUser({
      id: nanoid(),
      name: name || email.split("@")[0],
      email,
      plan: "free",
    });
    setShowLoginModal(false);
    toast.success(`欢迎回来，${name || email.split("@")[0]}！`);
    setLoading(false);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
        onClick={e => { if (e.target === e.currentTarget) setShowLoginModal(false); }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ type: "spring", damping: 24, stiffness: 280 }}
          className="relative w-full max-w-sm mx-4 rounded-2xl overflow-hidden"
          style={{
            background: "var(--atlas-surface)",
            border: "1px solid var(--atlas-border-2)",
            boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
          }}
        >
          {/* Header */}
          <div className="px-6 pt-6 pb-4 flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: "var(--atlas-accent)" }}>
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path d="M7 1L13 12H1L7 1Z" fill="white" fillOpacity="0.9" />
                  </svg>
                </div>
                <span className="font-bold tracking-widest text-xs uppercase" style={{ color: "var(--atlas-text)", letterSpacing: "0.12em" }}>ATLAS</span>
              </div>
              <h2 className="text-lg font-semibold mt-2" style={{ color: "var(--atlas-text)" }}>
                {mode === "login" ? "登录账号" : "创建账号"}
              </h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--atlas-text-3)" }}>
                {mode === "login" ? "数据安全，仅限授权访问" : "开始使用 ATLAS 智能报表"}
              </p>
            </div>
            <button
              onClick={() => setShowLoginModal(false)}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
              style={{ color: "var(--atlas-text-3)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
            >
              <X size={15} />
            </button>
          </div>

          {/* Security badge */}
          <div className="mx-6 mb-4 flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.15)" }}>
            <Shield size={12} style={{ color: "var(--atlas-success)" }} />
            <span className="text-xs" style={{ color: "var(--atlas-success)" }}>端对端加密 · 数据完全隔离</span>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-3">
            {mode === "register" && (
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>姓名</label>
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="你的名字"
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-all"
                  style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border-2)", color: "var(--atlas-text)" }}
                  onFocus={e => (e.target as HTMLElement).style.borderColor = "rgba(91,140,255,0.5)"}
                  onBlur={e => (e.target as HTMLElement).style.borderColor = "var(--atlas-border-2)"}
                />
              </div>
            )}

            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>邮箱</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--atlas-text-3)" }} />
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm outline-none transition-all"
                  style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border-2)", color: "var(--atlas-text)" }}
                  onFocus={e => (e.target as HTMLElement).style.borderColor = "rgba(91,140,255,0.5)"}
                  onBlur={e => (e.target as HTMLElement).style.borderColor = "var(--atlas-border-2)"}
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>密码</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--atlas-text-3)" }} />
                <input
                  type={showPwd ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-9 py-2.5 rounded-lg text-sm outline-none transition-all"
                  style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border-2)", color: "var(--atlas-text)" }}
                  onFocus={e => (e.target as HTMLElement).style.borderColor = "rgba(91,140,255,0.5)"}
                  onBlur={e => (e.target as HTMLElement).style.borderColor = "var(--atlas-border-2)"}
                />
                <button type="button" onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--atlas-text-3)" }}>
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button
              type="submit" disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all mt-2"
              style={{ background: "var(--atlas-accent)", color: "#fff", opacity: loading ? 0.7 : 1 }}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              {mode === "login" ? "登录" : "创建账号"}
            </button>

            <div className="text-center pt-1">
              <button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}
                className="text-xs transition-colors"
                style={{ color: "var(--atlas-text-3)" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
              >
                {mode === "login" ? "没有账号？立即注册" : "已有账号？去登录"}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
