/**
 * ATLAS — 登录 / 注册弹窗
 * 支持：账号密码注册 / 登录
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Shield, LogIn, UserPlus, Eye, EyeOff, Loader2 } from "lucide-react";
import { useAtlas } from "@/contexts/AtlasContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type Mode = "login" | "register" | "forgot";

export default function LoginModal() {
  const { setShowLoginModal, setUser } = useAtlas();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  const utils = trpc.useUtils();

  const loginMut = trpc.auth.login.useMutation({
    onSuccess: async (data) => {
      await utils.auth.me.invalidate();
      setUser(data.user as any);
      setShowLoginModal(false);
      toast.success(`欢迎回来，${data.user.name || data.user.username}！`);
    },
    onError: (err) => {
      toast.error(err.message || "登录失败，请重试");
    },
  });

  const registerMut = trpc.auth.register.useMutation({
    onSuccess: async (data) => {
      await utils.auth.me.invalidate();
      setUser(data.user as any);
      setShowLoginModal(false);
      toast.success(`注册成功，欢迎使用 ATLAS！`);
    },
    onError: (err) => {
      toast.error(err.message || "注册失败，请重试");
    },
  });

  const resetPasswordMut = trpc.auth.resetPassword.useMutation({
    onSuccess: () => {
      toast.success("密码已重置，请登录");
      setMode("login");
      setPassword("");
      setConfirmPassword("");
    },
    onError: (err) => {
      toast.error(err.message || "重置失败，请重试");
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "forgot") {
      if (!username.trim()) { toast.error("请输入用户名"); return; }
      if (password.length < 6) { toast.error("新密码至少6位"); return; }
      if (password !== confirmPassword) { toast.error("两次密码不一致"); return; }
      setLoading(true);
      try {
        await resetPasswordMut.mutateAsync({ username: username.trim(), newPassword: password });
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!username.trim() || !password.trim()) {
      toast.error("请填写用户名和密码");
      return;
    }
    setLoading(true);
    try {
      if (mode === "login") {
        await loginMut.mutateAsync({ username: username.trim(), password });
      } else {
        if (password.length < 6) {
          toast.error("密码至少6 位");
          return;
        }
        await registerMut.mutateAsync({
          username: username.trim(),
          password,
          name: name.trim() || undefined,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    color: "var(--atlas-text)",
    padding: "10px 14px",
    fontSize: 14,
    width: "100%",
    outline: "none",
    transition: "border-color 0.2s",
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
          {/* Close */}
          <button
            onClick={() => setShowLoginModal(false)}
            className="absolute top-4 right-4 w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: "var(--atlas-text-3)" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
          >
            <X size={15} />
          </button>

          {/* Header */}
          <div className="px-8 pt-8 pb-5 text-center">
            <div className="flex items-center justify-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--atlas-accent)" }}>
                <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1L13 12H1L7 1Z" fill="white" fillOpacity="0.9" />
                </svg>
              </div>
              <span className="font-bold tracking-widest text-sm uppercase" style={{ color: "var(--atlas-text)", letterSpacing: "0.12em" }}>ATLAS</span>
            </div>
            <h2 className="text-xl font-bold mb-1" style={{ color: "var(--atlas-text)" }}>
              {mode === "login" ? "登录账号" : mode === "register" ? "注册账号" : "重置密码"}
            </h2>
            <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>
              {mode === "login" ? "输入账号和密码继续使用" : mode === "register" ? "创建账号，立即开始使用" : "输入用户名和新密码"}
            </p>
          </div>

          {/* Tab switcher — only show for login/register */}
          {mode !== "forgot" && (
            <div className="mx-8 mb-5 flex rounded-xl overflow-hidden p-1" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
              {(["login", "register"] as Mode[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className="flex-1 py-1.5 text-sm font-medium transition-all rounded-lg"
                  style={{
                    background: mode === m ? "var(--atlas-accent)" : "transparent",
                    color: mode === m ? "#fff" : "var(--atlas-text-3)",
                  }}
                >
                  {m === "login" ? "登录" : "注册"}
                </button>
              ))}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-8 pb-5 space-y-3">
            {/* Forgot password mode */}
            {mode === "forgot" && (
              <>
                <div>
                  <label className="block text-xs mb-1.5 font-medium" style={{ color: "var(--atlas-text-2)" }}>用户名</label>
                  <input
                    type="text"
                    placeholder="输入你的用户名"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                    style={inputStyle}
                    onFocus={e => (e.target as HTMLInputElement).style.borderColor = "var(--atlas-accent)"}
                    onBlur={e => (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.12)"}
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1.5 font-medium" style={{ color: "var(--atlas-text-2)" }}>新密码 <span style={{ color: "var(--atlas-text-3)" }}>（至少6位）</span></label>
                  <div className="relative">
                    <input
                      type={showPwd ? "text" : "password"}
                      placeholder="设置新密码"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                      style={{ ...inputStyle, paddingRight: 40 }}
                      onFocus={e => (e.target as HTMLInputElement).style.borderColor = "var(--atlas-accent)"}
                      onBlur={e => (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.12)"}
                    />
                    <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "var(--atlas-text-3)" }}>
                      {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs mb-1.5 font-medium" style={{ color: "var(--atlas-text-2)" }}>确认新密码</label>
                  <div className="relative">
                    <input
                      type={showConfirmPwd ? "text" : "password"}
                      placeholder="再次输入新密码"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                      style={{ ...inputStyle, paddingRight: 40, borderColor: confirmPassword && confirmPassword !== password ? "rgba(239,68,68,0.6)" : "rgba(255,255,255,0.12)" }}
                      onFocus={e => (e.target as HTMLInputElement).style.borderColor = confirmPassword !== password ? "rgba(239,68,68,0.6)" : "var(--atlas-accent)"}
                      onBlur={e => (e.target as HTMLInputElement).style.borderColor = confirmPassword && confirmPassword !== password ? "rgba(239,68,68,0.6)" : "rgba(255,255,255,0.12)"}
                    />
                    <button type="button" onClick={() => setShowConfirmPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "var(--atlas-text-3)" }}>
                      {showConfirmPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {confirmPassword && confirmPassword !== password && (
                    <p className="text-xs mt-1" style={{ color: "rgba(239,68,68,0.8)" }}>两次密码不一致</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all mt-1 disabled:opacity-60"
                  style={{ background: "var(--atlas-accent)", color: "#fff" }}
                >
                  {loading ? <><Loader2 size={15} className="animate-spin" /> 处理中...</> : "重置密码"}
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("login"); setPassword(""); setConfirmPassword(""); }}
                  className="w-full py-2 text-sm transition-colors"
                  style={{ color: "var(--atlas-text-3)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
                >
                  返回登录
                </button>
              </>
            )}
            {mode !== "forgot" && (
            <>
            {mode === "register" && (
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: "var(--atlas-text-2)" }}>
                  昵称 <span style={{ color: "var(--atlas-text-3)" }}>(选填)</span>
                </label>
                <input
                  type="text"
                  placeholder="您的显示名称"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  style={inputStyle}
                  onFocus={e => (e.target as HTMLInputElement).style.borderColor = "var(--atlas-accent)"}
                  onBlur={e => (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.12)"}
                />
              </div>
            )}

            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: "var(--atlas-text-2)" }}>用户名</label>
              <input
                type="text"
                placeholder="输入用户名（至少 3 位）"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
                required
                style={inputStyle}
                onFocus={e => (e.target as HTMLInputElement).style.borderColor = "var(--atlas-accent)"}
                onBlur={e => (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.12)"}
              />
            </div>

            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: "var(--atlas-text-2)" }}>
                密码{mode === "register" && <span style={{ color: "var(--atlas-text-3)" }}> (至少 6 位)</span>}
              </label>
              <div className="relative">
                <input
                  type={showPwd ? "text" : "password"}
                  placeholder={mode === "login" ? "输入密码" : "设置密码（至少 6 位）"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                  style={{ ...inputStyle, paddingRight: 40 }}
                  onFocus={e => (e.target as HTMLInputElement).style.borderColor = "var(--atlas-accent)"}
                  onBlur={e => (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.12)"}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--atlas-text-3)" }}
                >
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all mt-1 disabled:opacity-60"
              style={{ background: "var(--atlas-accent)", color: "#fff" }}
            >
              {loading
                ? <><Loader2 size={15} className="animate-spin" /> 处理中...</>
                : mode === "login"
                  ? <><LogIn size={15} /> 登录</>
                  : <><UserPlus size={15} /> 注册</>
              }
            </button>

            {/* Forgot password link — only on login mode */}
            {mode === "login" && (
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => { setMode("forgot"); setPassword(""); setConfirmPassword(""); }}
                  className="text-xs transition-colors"
                  style={{ color: "var(--atlas-text-3)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
                >
                  忘记密码？
                </button>
              </div>
            )}
            </>
            )}
          </form>

          {/* Security badge */}
          <div className="mx-8 mb-6 flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.15)" }}>
            <Shield size={12} style={{ color: "var(--atlas-success)" }} />
            <span className="text-xs" style={{ color: "var(--atlas-success)" }}>端对端加密 · 数据完全隔离 · 文件 1 小时后自动删除</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
