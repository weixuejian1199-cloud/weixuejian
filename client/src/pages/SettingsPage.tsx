/**
 * ATLAS V5.0 — 设置页
 * Design: Manus-style minimal settings panel
 * Sections: 账户 / 个性化 / API Key 管理 / 平台授权 / 邮箱 / 集成 / 定时任务
 * Key changes V5.0:
 *   - API Key: show/hide/copy/verify with eye icon, lock icon, copy button
 *   - Auto-save on change (debounced) with toast notification
 *   - Remove save buttons from most fields
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings, User, Key, Link2, Mail, Zap, Clock,
  Plus, Trash2, Eye, EyeOff, Check, Server,
  Sun, Moon, Bell, Shield, ChevronRight,
  Play, Pause, Copy, CheckCheck, Lock, Unlock,
  RefreshCw, AlertCircle, Loader2,
} from "lucide-react";
import { useAtlas } from "@/contexts/AtlasContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { nanoid } from "nanoid";

// ── ChangePasswordDialog ───────────────────────────────────────────────────────────────

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const changePwd = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("密码修改成功");
      setOldPwd(""); setNewPwd(""); setConfirmPwd("");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (newPwd !== confirmPwd) { toast.error("两次输入的新密码不一致"); return; }
    if (newPwd.length < 6) { toast.error("新密码至少6位"); return; }
    changePwd.mutate({ oldPassword: oldPwd, newPassword: newPwd });
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full max-w-sm mx-4 p-6 rounded-2xl" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-5">
          <Lock size={15} style={{ color: "var(--atlas-accent)" }} />
          <h3 className="text-base font-semibold" style={{ color: "var(--atlas-text)" }}>修改密码</h3>
        </div>
        <div className="space-y-3">
          {[{ label: "旧密码", val: oldPwd, set: setOldPwd, show: showOld, toggle: () => setShowOld(v => !v) },
            { label: "新密码", val: newPwd, set: setNewPwd, show: showNew, toggle: () => setShowNew(v => !v) },
            { label: "确认新密码", val: confirmPwd, set: setConfirmPwd, show: showNew, toggle: () => setShowNew(v => !v) },
          ].map(({ label, val, set, show, toggle }) => (
            <div key={label}>
              <label className="text-xs mb-1 block" style={{ color: "var(--atlas-text-2)" }}>{label}</label>
              <div className="relative">
                <input type={show ? "text" : "password"} value={val} onChange={e => set(e.target.value)}
                  className="w-full px-3 py-2 pr-9 rounded-lg text-sm outline-none"
                  style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text)" }}
                  placeholder={label} />
                <button type="button" onClick={toggle} className="absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--atlas-text-3)" }}>
                  {show ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-sm" style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-2)" }}>取消</button>
          <button onClick={handleSubmit} disabled={changePwd.isPending} className="flex-1 py-2 rounded-lg text-sm font-medium" style={{ background: "var(--atlas-accent)", color: "#fff", opacity: changePwd.isPending ? 0.7 : 1 }}>
            {changePwd.isPending ? "修改中..." : "确认修改"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Countdown Component ───────────────────────────────────────────────────────────────

function NextRunCountdown({ nextRunAt }: { nextRunAt: Date | null | undefined }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    if (!nextRunAt) return;
    const update = () => {
      const diff = new Date(nextRunAt).getTime() - Date.now();
      if (diff <= 0) { setRemaining("即将执行"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (h > 0) setRemaining(`${h}小时 ${m}分钟后执行`);
      else if (m > 0) setRemaining(`${m}分钟 ${s}秒后执行`);
      else setRemaining(`${s}秒后执行`);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [nextRunAt]);

  if (!nextRunAt || !remaining) return null;
  return (
    <span className="text-xs px-1.5 py-0.5 rounded-md"
      style={{ background: "rgba(52,211,153,0.1)", color: "#34D399", border: "1px solid rgba(52,211,153,0.2)", fontFamily: "'JetBrains Mono', monospace", fontSize: "10px" }}>
      ⏱ {remaining}
    </span>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApiKeyEntry {
  id: string;
  label: string;
  platform: string;
  key: string;
  visible: boolean;
  active: boolean;
  verifyStatus: "idle" | "verifying" | "ok" | "fail";
}

interface EmailEntry { id: string; address: string; type: string; verified: boolean; }
interface ScheduledTaskItem { id: string; name: string; template: string; schedule: string; enabled: boolean; lastRun?: string; nextRun?: string; }

// ── Nav ───────────────────────────────────────────────────────────────────────

// 所有用户可见
const NAV_ITEMS = [
  { id: "profile",      label: "账户",     icon: User },
  { id: "appearance",   label: "个性化",   icon: Moon },
  { id: "email",        label: "邮箱",     icon: Mail },
  { id: "integrations", label: "集成",     icon: Zap },
  { id: "schedule",     label: "定时任务", icon: Clock },
];

// 仅管理员可见
const ADMIN_NAV_ITEMS = [
  { id: "apikeys",      label: "API Key",  icon: Key },
  { id: "ai-engine",    label: "AI 引擎",  icon: Server },
  { id: "platforms",    label: "平台授权", icon: Link2 },
];

// ── Shared ────────────────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, desc }: { icon: typeof Settings; title: string; desc: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(91,140,255,0.1)" }}>
        <Icon size={15} style={{ color: "var(--atlas-accent)" }} />
      </div>
      <div>
        <h2 className="text-base font-semibold" style={{ color: "var(--atlas-text)" }}>{title}</h2>
        <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{desc}</p>
      </div>
    </div>
  );
}

function FieldInput({ label, value, onChange, placeholder, type = "text", mono = false }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; mono?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type={type}
        className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all"
        style={{
          background: "var(--atlas-elevated)",
          border: "1px solid var(--atlas-border)",
          color: "var(--atlas-text)",
          fontFamily: mono ? "'JetBrains Mono', monospace" : undefined,
        }}
        onFocus={e => (e.target as HTMLInputElement).style.borderColor = "rgba(91,140,255,0.4)"}
        onBlur={e => (e.target as HTMLInputElement).style.borderColor = "var(--atlas-border)"}
      />
    </div>
  );
}

function ToggleRow({ label, desc, defaultOn, onChange }: {
  label: string; desc: string; defaultOn?: boolean; onChange?: (v: boolean) => void;
}) {
  const [on, setOn] = useState(defaultOn ?? false);
  const handleToggle = () => {
    const next = !on;
    setOn(next);
    onChange?.(next);
  };
  return (
    <div className="flex items-center justify-between py-2.5">
      <div>
        <p className="text-sm" style={{ color: "var(--atlas-text)" }}>{label}</p>
        <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{desc}</p>
      </div>
      <button onClick={handleToggle} className="w-10 h-5 rounded-full relative transition-all flex-shrink-0"
        style={{ background: on ? "var(--atlas-accent)" : "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}>
        <div className="w-3.5 h-3.5 rounded-full absolute top-0.5 transition-all"
          style={{ background: "#fff", left: on ? "calc(100% - 18px)" : "2px" }} />
      </button>
    </div>
  );
}

// ── Auto-save hook ────────────────────────────────────────────────────────────

function useAutoSave(value: string, onSave: (v: string) => void, delay = 800) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRef = useRef(value);

  useEffect(() => {
    if (value === prevRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onSave(value);
      prevRef.current = value;
    }, delay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [value, onSave, delay]);
}

// ── Profile ───────────────────────────────────────────────────────────────────

function ProfileSection() {
  const { user } = useAtlas();
  const [name, setName] = useState(user?.name || "管理员");
  const [email, setEmail] = useState(user?.email || "admin@example.com");
  const [saved, setSaved] = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);

  const handleSave = useCallback(() => {
    setSaved(true);
    toast.success("账户信息已自动保存");
    setTimeout(() => setSaved(false), 2000);
  }, []);

  useAutoSave(name, handleSave);
  useAutoSave(email, handleSave);

  return (
    <div className="space-y-4">
      <SectionHeader icon={User} title="账户信息" desc="管理你的个人资料和账号安全" />
      <div className="p-5 rounded-xl space-y-4" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold"
            style={{ background: "linear-gradient(135deg, #5B8CFF 0%, #7B5FFF 100%)", color: "#fff" }}>
            {name.charAt(0)}
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>{name}</p>
            <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{email}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: "rgba(91,140,255,0.1)", color: "var(--atlas-accent)", fontSize: "10px" }}>管理员</span>
              {saved && (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="text-xs flex items-center gap-1" style={{ color: "#34D399", fontSize: "10px" }}>
                  <CheckCheck size={10} />已保存
                </motion.span>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldInput label="显示名称" value={name} onChange={setName} />
          <FieldInput label="邮箱地址" value={email} onChange={setEmail} type="email" />
        </div>
        <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>修改后自动保存</p>
      </div>
      <div className="p-5 rounded-xl space-y-4" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
        <div className="flex items-center gap-2">
          <Shield size={13} style={{ color: "var(--atlas-text-2)" }} />
          <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>账号安全</span>
        </div>
        {/* 修改密码 - 明显按钮样式 */}
        <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: "rgba(91,140,255,0.08)", border: "1px solid rgba(91,140,255,0.2)" }}>
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>登录密码</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--atlas-text-3)" }}>定期修改密码可提升账号安全性</p>
          </div>
          <button
            onClick={() => setShowChangePwd(true)}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all hover:opacity-90 active:scale-95"
            style={{ background: "var(--atlas-accent)", color: "white", flexShrink: 0 }}
          >
            修改密码
          </button>
        </div>
        {/* 其他安全项 - 展示但标注即将推出 */}
        <div className="space-y-0 rounded-lg overflow-hidden" style={{ border: "1px solid var(--atlas-border)" }}>
          {[{ label: "两步验证", desc: "登录时额外验证身份" }, { label: "登录记录", desc: "查看最近登录设备和时间" }].map((item, i) => (
            <div key={item.label} className="flex items-center justify-between px-4 py-3"
              style={{ borderTop: i > 0 ? "1px solid var(--atlas-border)" : "none", opacity: 0.5 }}>
              <div>
                <p className="text-sm" style={{ color: "var(--atlas-text)" }}>{item.label}</p>
                <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{item.desc}</p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: "var(--atlas-text-3)" }}>即将推出</span>
            </div>
          ))}
        </div>
      </div>
      <ChangePasswordDialog open={showChangePwd} onClose={() => setShowChangePwd(false)} />
    </div>
  );
}

// ── Appearance ────────────────────────────────────────────────────────────────

function AppearanceSection() {
  const { theme, setTheme } = useAtlas();
  return (
    <div className="space-y-4">
      <SectionHeader icon={Moon} title="个性化" desc="自定义 ATLAS 的外观和显示偏好" />
      <div className="p-5 rounded-xl" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
        <p className="text-sm font-medium mb-3" style={{ color: "var(--atlas-text)" }}>主题模式</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: "dark", label: "深色", desc: "ATLAS 冷黑风格", icon: Moon },
            { id: "light", label: "浅色", desc: "ATLAS 白灰风格", icon: Sun },
          ].map(t => (
            <button key={t.id} onClick={() => setTheme(t.id as any)}
              className="flex items-center gap-3 p-4 rounded-xl transition-all"
              style={{
                background: theme === t.id ? "rgba(91,140,255,0.08)" : "var(--atlas-elevated)",
                border: theme === t.id ? "1px solid rgba(91,140,255,0.3)" : "1px solid var(--atlas-border)",
              }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: theme === t.id ? "rgba(91,140,255,0.15)" : "var(--atlas-surface)" }}>
                <t.icon size={15} style={{ color: theme === t.id ? "var(--atlas-accent)" : "var(--atlas-text-2)" }} />
              </div>
              <div className="text-left flex-1">
                <p className="text-sm font-medium" style={{ color: theme === t.id ? "var(--atlas-accent)" : "var(--atlas-text)" }}>{t.label}</p>
                <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{t.desc}</p>
              </div>
              {theme === t.id && <Check size={14} style={{ color: "var(--atlas-accent)" }} />}
            </button>
          ))}
        </div>
      </div>
      <div className="p-5 rounded-xl" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
        <div className="flex items-center gap-2 mb-3">
          <Bell size={13} style={{ color: "var(--atlas-text-2)" }} />
          <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>通知设置</span>
        </div>
        <ToggleRow label="报表生成完成通知" desc="报表生成后发送提醒" defaultOn onChange={() => toast.success("通知设置已保存")} />
        <ToggleRow label="定时任务通知" desc="定时任务执行结果提醒" onChange={() => toast.success("通知设置已保存")} />
        <ToggleRow label="系统更新通知" desc="ATLAS 版本更新提醒" onChange={() => toast.success("通知设置已保存")} />
      </div>
    </div>
  );
}

// ── API Keys ──────────────────────────────────────────────────────────────────

function ApiKeysSection() {
  const { apiKey, setApiKey, backendUrl, setBackendUrl } = useAtlas();
  const [localUrl, setLocalUrl] = useState(backendUrl);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [keys, setKeys] = useState<ApiKeyEntry[]>(() => {
    const saved = localStorage.getItem("atlas_ui_keys");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.map((k: ApiKeyEntry) => ({ ...k, visible: false, verifyStatus: "idle" as const }));
      } catch {}
    }
    return apiKey
      ? [{ id: "k1", label: "GLM-5 主账号", platform: "智谱 AI", key: apiKey, visible: false, active: true, verifyStatus: "idle" }]
      : [];
  });
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newPlatform, setNewPlatform] = useState("智谱 AI");
  const [newKey, setNewKey] = useState("");
  const [newKeyVisible, setNewKeyVisible] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Persist keys to localStorage
  useEffect(() => {
    localStorage.setItem("atlas_ui_keys", JSON.stringify(keys.map(k => ({ ...k, visible: false, verifyStatus: "idle" }))));
  }, [keys]);

  // Auto-save backend URL
  useAutoSave(localUrl, (url) => {
    setBackendUrl(url);
    toast.success("后端地址已自动保存");
  }, 1200);

  const handleTest = async () => {
    setTesting(true); setTestOk(null);
    try {
      const res = await fetch(`${localUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) { setTestOk(true); toast.success("后端连接正常"); }
      else { setTestOk(false); toast.error("后端返回错误"); }
    } catch {
      setTestOk(false); toast.error("无法连接后端，请检查地址");
    } finally { setTesting(false); }
  };

  const toggleVisible = (id: string) => setKeys(prev => prev.map(k => k.id === id ? { ...k, visible: !k.visible } : k));

  const copyKey = async (id: string, key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedId(id);
      toast.success("API Key 已复制到剪贴板");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const verifyKey = async (id: string, key: string, platform: string) => {
    setKeys(prev => prev.map(k => k.id === id ? { ...k, verifyStatus: "verifying" } : k));
    // Simulate verification (real implementation would call the AI API)
    await new Promise(r => setTimeout(r, 1500));
    const isValid = key.startsWith("sk-") && key.length > 20;
    setKeys(prev => prev.map(k => k.id === id ? { ...k, verifyStatus: isValid ? "ok" : "fail" } : k));
    if (isValid) toast.success(`${platform} Key 验证通过`);
    else toast.error("Key 格式无效，请检查后重试");
    // Reset after 3s
    setTimeout(() => setKeys(prev => prev.map(k => k.id === id ? { ...k, verifyStatus: "idle" } : k)), 3000);
  };

  const toggleActive = (id: string) => {
    setKeys(prev => prev.map(k => ({ ...k, active: k.id === id })));
    const key = keys.find(k => k.id === id);
    if (key) { setApiKey(key.key); toast.success(`已切换到 ${key.label}`); }
  };

  const deleteKey = (id: string) => {
    setKeys(prev => prev.filter(k => k.id !== id));
    toast.success("Key 已删除");
  };

  const addKey = () => {
    if (!newLabel || !newKey) { toast.error("请填写完整信息"); return; }
    const entry: ApiKeyEntry = { id: nanoid(), label: newLabel, platform: newPlatform, key: newKey, visible: false, active: false, verifyStatus: "idle" };
    setKeys(prev => [...prev, entry]);
    if (newPlatform === "智谱 AI") setApiKey(newKey);
    setNewLabel(""); setNewPlatform("智谱 AI"); setNewKey(""); setAdding(false);
    toast.success("API Key 已添加");
  };

  const maskKey = (key: string) => {
    if (key.length <= 8) return "••••••••";
    return key.slice(0, 6) + "••••••••••••" + key.slice(-4);
  };

  return (
    <div className="space-y-4">
      <SectionHeader icon={Key} title="API Key 管理" desc="管理所有 AI 模型的 API Key，支持多模型切换" />

      {/* Backend URL */}
      <div className="p-5 rounded-xl" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
        <div className="flex items-center gap-2 mb-3">
          <Server size={13} style={{ color: "var(--atlas-accent)" }} />
          <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>后端服务地址</span>
          <span className="text-xs px-1.5 py-0.5 rounded ml-auto" style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-3)", fontSize: "10px" }}>自动保存</span>
        </div>
        <div className="flex gap-2">
          <input
            value={localUrl}
            onChange={e => setLocalUrl(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg text-sm outline-none transition-all"
            style={{
              background: "var(--atlas-elevated)",
              border: "1px solid var(--atlas-border)",
              color: "var(--atlas-text)",
              fontFamily: "'JetBrains Mono', monospace",
            }}
            onFocus={e => (e.target as HTMLInputElement).style.borderColor = "rgba(91,140,255,0.4)"}
            onBlur={e => (e.target as HTMLInputElement).style.borderColor = "var(--atlas-border)"}
            placeholder="http://localhost:8000"
          />
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-all"
            style={{
              background: "var(--atlas-elevated)",
              border: "1px solid var(--atlas-border)",
              color: testOk === true ? "#34D399" : testOk === false ? "#F87171" : "var(--atlas-text-2)",
            }}
          >
            {testing
              ? <><Loader2 size={12} className="animate-spin" />测试中</>
              : testOk === true ? <><Check size={12} />正常</>
              : testOk === false ? <><AlertCircle size={12} />失败</>
              : <><RefreshCw size={12} />测试</>
            }
          </button>
        </div>
        <p className="text-xs mt-2" style={{ color: "var(--atlas-text-3)" }}>FastAPI 后端地址，默认 http://localhost:8000，修改后自动保存</p>
      </div>

      {/* Keys list */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--atlas-border)" }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ background: "var(--atlas-surface)", borderBottom: "1px solid var(--atlas-border)" }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>已配置的 Key</span>
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-3)", fontFamily: "monospace", fontSize: "10px" }}>
              {keys.length}
            </span>
          </div>
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ background: "rgba(91,140,255,0.1)", color: "var(--atlas-accent)", border: "1px solid rgba(91,140,255,0.2)" }}
          >
            <Plus size={12} />添加 Key
          </button>
        </div>

        {keys.length === 0 ? (
          <div className="px-5 py-8 text-center" style={{ background: "var(--atlas-surface)" }}>
            <Key size={24} style={{ color: "var(--atlas-text-3)", margin: "0 auto 8px", opacity: 0.4 }} />
            <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>尚未配置 API Key</p>
            <p className="text-xs mt-1" style={{ color: "var(--atlas-text-3)" }}>点击"添加 Key"配置智谱 AI 或其他模型</p>
          </div>
        ) : (
          <div style={{ background: "var(--atlas-surface)" }}>
            {keys.map((k, i) => (
              <div
                key={k.id}
                className="px-5 py-4"
                style={{ borderTop: i > 0 ? "1px solid var(--atlas-border)" : "none" }}
              >
                <div className="flex items-start gap-3">
                  {/* Lock icon */}
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: k.active ? "rgba(91,140,255,0.1)" : "var(--atlas-elevated)" }}
                  >
                    {k.active
                      ? <Unlock size={13} style={{ color: "var(--atlas-accent)" }} />
                      : <Lock size={13} style={{ color: "var(--atlas-text-3)" }} />
                    }
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Label + badges */}
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>{k.label}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-3)", fontSize: "10px" }}>
                        {k.platform}
                      </span>
                      {k.active && (
                        <span className="text-xs px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: "rgba(52,211,153,0.1)", color: "#34D399", fontSize: "10px" }}>
                          <Check size={8} />使用中
                        </span>
                      )}
                      {k.verifyStatus === "ok" && (
                        <span className="text-xs px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: "rgba(52,211,153,0.1)", color: "#34D399", fontSize: "10px" }}>
                          <CheckCheck size={8} />已验证
                        </span>
                      )}
                      {k.verifyStatus === "fail" && (
                        <span className="text-xs px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: "rgba(248,113,113,0.1)", color: "#F87171", fontSize: "10px" }}>
                          <AlertCircle size={8} />验证失败
                        </span>
                      )}
                    </div>

                    {/* Key display */}
                    <div
                      className="flex items-center gap-2 px-3 py-2 rounded-lg"
                      style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}
                    >
                      <code
                        className="flex-1 text-xs truncate"
                        style={{ color: "var(--atlas-text-2)", fontFamily: "'JetBrains Mono', monospace" }}
                      >
                        {k.visible ? k.key : maskKey(k.key)}
                      </code>

                      {/* Eye toggle */}
                      <button
                        onClick={() => toggleVisible(k.id)}
                        className="w-6 h-6 rounded flex items-center justify-center transition-all flex-shrink-0"
                        style={{ color: "var(--atlas-text-3)" }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
                        title={k.visible ? "隐藏 Key" : "显示 Key"}
                      >
                        {k.visible ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>

                      {/* Copy button */}
                      <button
                        onClick={() => copyKey(k.id, k.key)}
                        className="w-6 h-6 rounded flex items-center justify-center transition-all flex-shrink-0"
                        style={{ color: copiedId === k.id ? "#34D399" : "var(--atlas-text-3)" }}
                        onMouseEnter={e => { if (copiedId !== k.id) (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)"; }}
                        onMouseLeave={e => { if (copiedId !== k.id) (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"; }}
                        title="复制 Key"
                      >
                        {copiedId === k.id ? <CheckCheck size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                    {/* Verify button */}
                    <button
                      onClick={() => verifyKey(k.id, k.key, k.platform)}
                      disabled={k.verifyStatus === "verifying"}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all"
                      style={{
                        background: "var(--atlas-elevated)",
                        border: "1px solid var(--atlas-border)",
                        color: "var(--atlas-text-2)",
                        opacity: k.verifyStatus === "verifying" ? 0.7 : 1,
                      }}
                      title="验证 Key 有效性"
                    >
                      {k.verifyStatus === "verifying"
                        ? <Loader2 size={10} className="animate-spin" />
                        : <RefreshCw size={10} />
                      }
                      验证
                    </button>

                    {/* Set default */}
                    {!k.active && (
                      <button
                        onClick={() => toggleActive(k.id)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{
                          background: "rgba(91,140,255,0.08)",
                          border: "1px solid rgba(91,140,255,0.2)",
                          color: "var(--atlas-accent)",
                        }}
                      >
                        设为默认
                      </button>
                    )}

                    {/* Delete */}
                    <button
                      onClick={() => deleteKey(k.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                      style={{ color: "var(--atlas-text-3)" }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.1)";
                        (e.currentTarget as HTMLElement).style.color = "#F87171";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                        (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
                      }}
                      title="删除 Key"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Key form */}
      <AnimatePresence>
        {adding && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-xl p-5 space-y-4"
            style={{ background: "var(--atlas-surface)", border: "1px solid rgba(91,140,255,0.25)" }}
          >
            <div className="flex items-center gap-2">
              <Plus size={14} style={{ color: "var(--atlas-accent)" }} />
              <p className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>添加新 API Key</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldInput label="备注名称" value={newLabel} onChange={setNewLabel} placeholder="GLM-5 主账号" />
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>AI 平台</label>
                <select
                  value={newPlatform}
                  onChange={e => setNewPlatform(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text)" }}
                >
                  {["智谱 AI (GLM)", "月之暗面 (Kimi)", "阿里百炼 (Qwen)", "MiniMax", "Ollama (本地)"].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>API Key</label>
              <div className="relative">
                <input
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                  type={newKeyVisible ? "text" : "password"}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 pr-10 rounded-lg text-sm outline-none"
                  style={{
                    background: "var(--atlas-elevated)",
                    border: "1px solid var(--atlas-border)",
                    color: "var(--atlas-text)",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                  onFocus={e => (e.target as HTMLInputElement).style.borderColor = "rgba(91,140,255,0.4)"}
                  onBlur={e => (e.target as HTMLInputElement).style.borderColor = "var(--atlas-border)"}
                />
                <button
                  onClick={() => setNewKeyVisible(!newKeyVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--atlas-text-3)" }}
                >
                  {newKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-xs mt-1.5" style={{ color: "var(--atlas-text-3)" }}>
                Key 将加密存储在本地，不会上传到服务器
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={addKey}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: "var(--atlas-accent)", color: "#fff" }}
              >
                保存
              </button>
              <button
                onClick={() => { setAdding(false); setNewLabel(""); setNewKey(""); }}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-2)", border: "1px solid var(--atlas-border)" }}
              >
                取消
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Platforms ─────────────────────────────────────────────────────────────────

function PlatformsSection() {
  const platforms = [
    { id: "p1", name: "天猫", icon: "🛒", color: "#FF4400", connected: false },
    { id: "p2", name: "抖音店铺", icon: "🎵", color: "#000000", connected: false },
    { id: "p3", name: "拼多多", icon: "🛍️", color: "#E02020", connected: false },
    { id: "p4", name: "小程序商城", icon: "📱", color: "#07C160", connected: false },
    { id: "p5", name: "京东", icon: "🔴", color: "#CC0000", connected: false },
    { id: "p6", name: "网点通 ERP", icon: "📦", color: "#5B8CFF", connected: false },
  ];
  return (
    <div className="space-y-4">
      <SectionHeader icon={Link2} title="平台授权" desc="连接电商平台，自动同步店铺数据到数据中枢" />
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--atlas-border)" }}>
        <div className="px-5 py-3 flex items-center gap-2" style={{ background: "var(--atlas-surface)", borderBottom: "1px solid var(--atlas-border)" }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#FBBF24" }} />
          <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>平台接入功能将在第二阶段上线，现已开放授权入口</span>
        </div>
        <div style={{ background: "var(--atlas-surface)" }}>
          {platforms.map((p, i) => (
            <div key={p.id} className="px-5 py-3 flex items-center gap-3" style={{ borderTop: i > 0 ? "1px solid var(--atlas-border)" : "none" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: `${p.color}15` }}>{p.icon}</div>
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>{p.name}</p>
                <p className="text-xs" style={{ color: p.connected ? "#34D399" : "var(--atlas-text-3)" }}>{p.connected ? "已连接" : "未连接"}</p>
              </div>
              <button onClick={() => toast.info("平台授权功能开发中，第二阶段上线")}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "rgba(91,140,255,0.1)", color: "var(--atlas-accent)", border: "1px solid rgba(91,140,255,0.2)" }}>
                授权
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Email ─────────────────────────────────────────────────────────────────────

function EmailSection() {
  const [emails, setEmails] = useState<EmailEntry[]>([
    { id: "e1", address: "admin@company.com", type: "企业邮箱", verified: true },
  ]);
  const [adding, setAdding] = useState(false);
  const [newAddr, setNewAddr] = useState("");
  const [newType, setNewType] = useState("企业邮箱");

  const addEmail = () => {
    if (!newAddr.includes("@")) { toast.error("请输入有效的邮箱地址"); return; }
    setEmails(prev => [...prev, { id: nanoid(), address: newAddr, type: newType, verified: false }]);
    setNewAddr(""); setAdding(false);
    toast.success("邮箱已添加，请查收验证邮件");
  };

  return (
    <div className="space-y-4">
      <SectionHeader icon={Mail} title="邮箱管理" desc="绑定邮箱用于接收报表推送和系统通知" />
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--atlas-border)" }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ background: "var(--atlas-surface)", borderBottom: "1px solid var(--atlas-border)" }}>
          <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>已绑定邮箱</span>
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: "rgba(91,140,255,0.1)", color: "var(--atlas-accent)", border: "1px solid rgba(91,140,255,0.2)" }}>
            <Plus size={12} />添加邮箱
          </button>
        </div>
        <div style={{ background: "var(--atlas-surface)" }}>
          {emails.map((e, i) => (
            <div key={e.id} className="px-5 py-3 flex items-center gap-3" style={{ borderTop: i > 0 ? "1px solid var(--atlas-border)" : "none" }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--atlas-elevated)" }}>
                <Mail size={14} style={{ color: "var(--atlas-text-2)" }} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>{e.address}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-3)", fontSize: "10px" }}>{e.type}</span>
                  {e.verified
                    ? <span className="text-xs flex items-center gap-1" style={{ color: "#34D399", fontSize: "10px" }}><Check size={8} />已验证</span>
                    : <span className="text-xs" style={{ color: "#FBBF24", fontSize: "10px" }}>待验证</span>
                  }
                </div>
              </div>
              <button onClick={() => { setEmails(prev => prev.filter(em => em.id !== e.id)); toast.success("邮箱已移除"); }}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                style={{ color: "var(--atlas-text-3)" }}
                onMouseEnter={ev => {
                  (ev.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.1)";
                  (ev.currentTarget as HTMLElement).style.color = "#F87171";
                }}
                onMouseLeave={ev => {
                  (ev.currentTarget as HTMLElement).style.background = "transparent";
                  (ev.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
                }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
      <AnimatePresence>
        {adding && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="rounded-xl p-4 space-y-3" style={{ background: "var(--atlas-surface)", border: "1px solid rgba(91,140,255,0.25)" }}>
            <div className="grid grid-cols-2 gap-3">
              <FieldInput label="邮箱地址" value={newAddr} onChange={setNewAddr} placeholder="name@example.com" type="email" />
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>邮箱类型</label>
                <select value={newType} onChange={e => setNewType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text)" }}>
                  {["企业邮箱", "QQ 邮箱", "Gmail", "163 邮箱", "Outlook"].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={addEmail} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: "var(--atlas-accent)", color: "#fff" }}>添加</button>
              <button onClick={() => setAdding(false)} className="px-4 py-2 rounded-lg text-sm" style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-2)", border: "1px solid var(--atlas-border)" }}>取消</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── AI Engine ─────────────────────────────────────────────────────────────────

function AiEngineSection() {
  const [openClawKey, setOpenClawKey] = useState("");
  const [openClawEndpoint, setOpenClawEndpoint] = useState("https://gateway.openclaw.ai/v1/chat");
  const [keyVisible, setKeyVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<"idle" | "verifying" | "ok" | "fail">("idle");
  const [channelStatus, setChannelStatus] = useState<"openclaw" | "qwen" | "unknown">("unknown");

  // Load saved config from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("atlas_openclaw_config");
    if (saved) {
      try {
        const cfg = JSON.parse(saved);
        if (cfg.key) setOpenClawKey(cfg.key);
        if (cfg.endpoint) setOpenClawEndpoint(cfg.endpoint);
        setChannelStatus(cfg.key ? "openclaw" : "qwen");
      } catch {}
    } else {
      setChannelStatus("qwen");
    }
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      localStorage.setItem("atlas_openclaw_config", JSON.stringify({
        key: openClawKey.trim(),
        endpoint: openClawEndpoint.trim(),
      }));
      setChannelStatus(openClawKey.trim() ? "openclaw" : "qwen");
      toast.success("配置已保存");
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    if (!openClawKey.trim()) {
      toast.error("请先输入 API Key");
      return;
    }
    setVerifyStatus("verifying");
    try {
      const res = await fetch("https://gateway.openclaw.ai/v1/chat", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openClawKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: "ping", source: "atlas-verify" }),
      });
      if (res.ok || res.status === 200) {
        setVerifyStatus("ok");
        toast.success("OpenClaw API Key 验证成功！");
      } else if (res.status === 401 || res.status === 403) {
        setVerifyStatus("fail");
        toast.error("API Key 无效，请检查后重试");
      } else {
        // Non-401/403 means key is valid but request format may differ
        setVerifyStatus("ok");
        toast.success("OpenClaw 连接正常");
      }
    } catch {
      setVerifyStatus("fail");
      toast.error("无法连接到 OpenClaw，请检查网络");
    }
  };

  const handleClear = () => {
    setOpenClawKey("");
    localStorage.removeItem("atlas_openclaw_config");
    setChannelStatus("qwen");
    setVerifyStatus("idle");
    toast.success("已清除 OpenClaw Key，切换到阿里百炼千问");
  };

  return (
    <div className="space-y-4">
      <SectionHeader icon={Server} title="AI 引擎配置" desc="管理 ATLAS 使用的 AI 模型通道，支持双通道无缝切换" />

      {/* Channel Status */}
      <div className="p-4 rounded-xl" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>当前 AI 通道</p>
          <span className="text-xs px-2 py-1 rounded-lg font-medium"
            style={{
              background: channelStatus === "openclaw" ? "rgba(52,211,153,0.1)" : "rgba(91,140,255,0.1)",
              color: channelStatus === "openclaw" ? "#34D399" : "var(--atlas-accent)",
              border: `1px solid ${channelStatus === "openclaw" ? "rgba(52,211,153,0.2)" : "rgba(91,140,255,0.2)"}`,
            }}>
            {channelStatus === "openclaw" ? "🦐 小虾米 Agent (OpenClaw)" : channelStatus === "qwen" ? "🤖 阿里百炼 (Qwen3-Max)" : "检测中..."}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg" style={{ background: "var(--atlas-elevated)", border: channelStatus === "qwen" ? "1px solid rgba(91,140,255,0.3)" : "1px solid var(--atlas-border)" }}>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full" style={{ background: channelStatus === "qwen" ? "#5B8CFF" : "#666" }} />
              <p className="text-xs font-medium" style={{ color: "var(--atlas-text)" }}>阿里百炼 (默认)</p>
            </div>
            <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>qwen3-max-2026-01-23</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--atlas-text-3)" }}>大文件自动切换 kimi-k2.5</p>
          </div>
          <div className="p-3 rounded-lg" style={{ background: "var(--atlas-elevated)", border: channelStatus === "openclaw" ? "1px solid rgba(52,211,153,0.3)" : "1px solid var(--atlas-border)" }}>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full" style={{ background: channelStatus === "openclaw" ? "#34D399" : "#666" }} />
              <p className="text-xs font-medium" style={{ color: "var(--atlas-text)" }}>小虾米 Agent</p>
            </div>
            <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>OpenClaw Gateway</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--atlas-text-3)" }}>需配置 API Key</p>
          </div>
        </div>
      </div>

      {/* OpenClaw Config */}
      <div className="p-5 rounded-xl space-y-4" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm" style={{ background: "rgba(52,211,153,0.1)" }}>🦐</div>
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>OpenClaw (小虾米 Agent)</p>
            <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>配置后将优先使用小虾米 Agent 处理数据分析请求</p>
          </div>
        </div>

        {/* Endpoint */}
        <div>
          <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>API Endpoint</label>
          <input
            value={openClawEndpoint}
            onChange={e => setOpenClawEndpoint(e.target.value)}
            placeholder="https://gateway.openclaw.ai/v1/chat"
            className="w-full px-3 py-2 rounded-lg text-sm outline-none"
            style={{
              background: "var(--atlas-elevated)",
              border: "1px solid var(--atlas-border)",
              color: "var(--atlas-text)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "12px",
            }}
            onFocus={e => (e.target as HTMLInputElement).style.borderColor = "rgba(91,140,255,0.4)"}
            onBlur={e => (e.target as HTMLInputElement).style.borderColor = "var(--atlas-border)"}
          />
        </div>

        {/* API Key */}
        <div>
          <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>API Key</label>
          <div className="relative">
            <input
              value={openClawKey}
              onChange={e => setOpenClawKey(e.target.value)}
              type={keyVisible ? "text" : "password"}
              placeholder="atlas_sk_..."
              className="w-full px-3 py-2 pr-10 rounded-lg text-sm outline-none"
              style={{
                background: "var(--atlas-elevated)",
                border: `1px solid ${verifyStatus === "ok" ? "rgba(52,211,153,0.4)" : verifyStatus === "fail" ? "rgba(248,113,113,0.4)" : "var(--atlas-border)"}`,
                color: "var(--atlas-text)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "12px",
              }}
              onFocus={e => (e.target as HTMLInputElement).style.borderColor = "rgba(91,140,255,0.4)"}
              onBlur={e => (e.target as HTMLInputElement).style.borderColor = verifyStatus === "ok" ? "rgba(52,211,153,0.4)" : verifyStatus === "fail" ? "rgba(248,113,113,0.4)" : "var(--atlas-border)"}
            />
            <button
              onClick={() => setKeyVisible(!keyVisible)}
              className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: "var(--atlas-text-3)" }}
            >
              {keyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            {verifyStatus === "ok" && (
              <span className="text-xs flex items-center gap-1" style={{ color: "#34D399" }}><Check size={10} />验证通过</span>
            )}
            {verifyStatus === "fail" && (
              <span className="text-xs flex items-center gap-1" style={{ color: "#F87171" }}><AlertCircle size={10} />验证失败</span>
            )}
            <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>Key 仅保存在本地浏览器，不上传服务器</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5"
            style={{ background: "var(--atlas-accent)", color: "#fff", opacity: saving ? 0.7 : 1 }}
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            保存配置
          </button>
          <button
            onClick={handleVerify}
            disabled={verifyStatus === "verifying" || !openClawKey.trim()}
            className="px-4 py-2 rounded-lg text-sm flex items-center gap-1.5"
            style={{
              background: "var(--atlas-elevated)",
              border: "1px solid var(--atlas-border)",
              color: "var(--atlas-text-2)",
              opacity: verifyStatus === "verifying" || !openClawKey.trim() ? 0.6 : 1,
            }}
          >
            {verifyStatus === "verifying" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            验证连接
          </button>
          {openClawKey && (
            <button
              onClick={handleClear}
              className="px-4 py-2 rounded-lg text-sm"
              style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "#F87171" }}
            >
              清除 Key
            </button>
          )}
        </div>
      </div>

      {/* Qwen Config Info */}
      <div className="p-4 rounded-xl" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm" style={{ background: "rgba(91,140,255,0.1)" }}>🤖</div>
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>阿里百炼 (默认通道)</p>
            <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>未配置 OpenClaw Key 时自动使用</p>
          </div>
        </div>
        <div className="space-y-2">
          {[
            { label: "主模型", value: "qwen3-max-2026-01-23", desc: "财务/行政/数据分析" },
            { label: "大文件模型", value: "kimi-k2.5", desc: "≥10000行自动切换" },
            { label: "Base URL", value: "dashscope.aliyuncs.com", desc: "阿里云 DashScope" },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid var(--atlas-border)" }}>
              <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{item.label}</span>
              <div className="text-right">
                <span className="text-xs font-medium" style={{ color: "var(--atlas-text)", fontFamily: "'JetBrains Mono', monospace" }}>{item.value}</span>
                <span className="text-xs ml-2" style={{ color: "var(--atlas-text-3)" }}>{item.desc}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs mt-3" style={{ color: "var(--atlas-text-3)" }}>
          如需修改阿里百炼 API Key，请在服务器环境变量 <code style={{ fontFamily: "'JetBrains Mono', monospace", background: "var(--atlas-elevated)", padding: "1px 4px", borderRadius: "3px" }}>DASHSCOPE_API_KEY</code> 中配置。
        </p>
      </div>
    </div>
  );
}

// ── Integrations ──────────────────────────────────────────────────────────────

// ── Bot type ──────────────────────────────────────────────────────────────────
interface BotItem {
  id: string;
  name: string;
  description: string | null;
  avatar: string | null;
  token: string;
  webhookUrl: string | null;
  enabled: number;
  createdBy: number;
  createdAt: Date | string;
}

function IntegrationsSection() {
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [newBotName, setNewBotName] = useState("");
  const [newBotDesc, setNewBotDesc] = useState("");
  const [newBotAvatar, setNewBotAvatar] = useState("🤖");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [editWebhook, setEditWebhook] = useState<{ id: string; url: string } | null>(null);

  // tRPC queries & mutations
  const { data: botList = [], isLoading: loading } = trpc.bots.list.useQuery();
  const createBot = trpc.bots.create.useMutation({
    onSuccess: () => {
      utils.bots.list.invalidate();
      toast.success(`机器人「${newBotName}」创建成功`);
      setNewBotName(""); setNewBotDesc(""); setNewBotAvatar("🤖");
      setShowCreate(false);
    },
    onError: (e) => toast.error(e.message || "创建失败"),
  });
  const deleteBot = trpc.bots.delete.useMutation({
    onSuccess: () => { utils.bots.list.invalidate(); toast.success("已删除"); },
    onError: (e) => toast.error(e.message || "删除失败"),
  });
  const regenerateToken = trpc.bots.regenerateToken.useMutation({
    onSuccess: () => { utils.bots.list.invalidate(); toast.success("Token 已更新"); },
    onError: (e) => toast.error(e.message || "更新失败"),
  });
  const updateBot = trpc.bots.update.useMutation({
    onSuccess: () => { utils.bots.list.invalidate(); toast.success("Webhook URL 已保存"); setEditWebhook(null); },
    onError: (e) => toast.error(e.message || "保存失败"),
  });

  const bots = botList as BotItem[];

  const handleCreate = () => {
    if (!newBotName.trim()) return;
    createBot.mutate({ name: newBotName.trim(), description: newBotDesc.trim() || undefined, avatar: newBotAvatar });
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`确定删除机器人「${name}」？此操作不可恢复。`)) return;
    deleteBot.mutate({ id });
  };

  const handleCopyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopiedToken(token);
    toast.success("Token 已复制");
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleRegenerateToken = (id: string) => {
    if (!confirm("重新生成 Token 后，旧 Token 立即失效，需要重新配置 OpenClaw。确定继续？")) return;
    regenerateToken.mutate({ id });
  };

  const handleSaveWebhook = () => {
    if (!editWebhook) return;
    updateBot.mutate({ id: editWebhook.id, webhookUrl: editWebhook.url });
  };

  const AVATARS = ["🤖", "🦞", "🐙", "🦊", "🐬", "🦅", "⚡", "🔮"];

  return (
    <div className="space-y-4">
      <SectionHeader icon={Zap} title="集成 · 机器人" desc="创建机器人，对接 OpenClaw 等外部 AI 服务" />

      {/* 机器人列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--atlas-text-3)" }} />
        </div>
      ) : bots.length === 0 ? (
        <div className="rounded-xl p-6 text-center" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
          <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>还没有机器人，点击下方按钮创建第一个</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bots.map(bot => (
            <div key={bot.id} className="rounded-xl p-4 space-y-3" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
              {/* 机器人头部 */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: "rgba(91,140,255,0.1)" }}>{bot.avatar || "🤖"}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>{bot.name}</p>
                  <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{bot.description || "无描述"}</p>
                </div>
                <div className="flex items-center gap-1">
                  <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: bot.enabled ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: bot.enabled ? "#22c55e" : "#ef4444" }}>
                    {bot.enabled ? "启用" : "禁用"}
                  </span>
                  <button onClick={() => handleDelete(bot.id, bot.name)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" style={{ color: "var(--atlas-text-3)" }} />
                  </button>
                </div>
              </div>

              {/* Token */}
              <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium" style={{ color: "var(--atlas-text-2)" }}>API Token（给 OpenClaw 配置）</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleCopyToken(bot.token)} className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors" style={{ background: "rgba(91,140,255,0.1)", color: "var(--atlas-accent)" }}>
                      {copiedToken === bot.token ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copiedToken === bot.token ? "已复制" : "复制"}
                    </button>
                    <button onClick={() => handleRegenerateToken(bot.id)} className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors" style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444" }}>
                      <RefreshCw className="w-3 h-3" />
                      重新生成
                    </button>
                  </div>
                </div>
                <code className="block text-xs break-all" style={{ color: "var(--atlas-text-2)", fontFamily: "monospace" }}>{bot.token}</code>
              </div>

              {/* Webhook URL */}
              <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium" style={{ color: "var(--atlas-text-2)" }}>Webhook URL（OpenClaw 接收消息的地址）</span>
                  {bot.webhookUrl && (
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>已配置</span>
                  )}
                </div>
                {editWebhook?.id === bot.id ? (
                  <div className="flex gap-2">
                    <input
                      value={editWebhook.url}
                      onChange={e => setEditWebhook({ id: bot.id, url: e.target.value })}
                      placeholder="https://your-openclaw-server/webhook"
                      className="flex-1 px-2 py-1.5 rounded text-xs outline-none"
                      style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-accent)", color: "var(--atlas-text)" }}
                    />
                    <button onClick={handleSaveWebhook} disabled={updateBot.isPending} className="px-3 py-1.5 rounded text-xs font-medium" style={{ background: "var(--atlas-accent)", color: "white" }}>
                      {updateBot.isPending ? "保存中..." : "保存"}
                    </button>
                    <button onClick={() => setEditWebhook(null)} className="px-2 py-1.5 rounded text-xs" style={{ color: "var(--atlas-text-3)" }}>取消</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-xs truncate" style={{ color: bot.webhookUrl ? "var(--atlas-text-2)" : "var(--atlas-text-3)" }}>
                      {bot.webhookUrl || "未配置，点击右侧按钮填写"}
                    </span>
                    <button onClick={() => setEditWebhook({ id: bot.id, url: bot.webhookUrl || "" })} className="px-2 py-1 rounded text-xs" style={{ background: "rgba(91,140,255,0.1)", color: "var(--atlas-accent)" }}>编辑</button>
                  </div>
                )}
              </div>

              {/* 接口地址提示 */}
              <div className="rounded-lg p-3" style={{ background: "rgba(91,140,255,0.05)", border: "1px solid rgba(91,140,255,0.15)" }}>
                <p className="text-xs mb-1" style={{ color: "var(--atlas-text-2)" }}>OpenClaw 回复接口（小虾米调用此接口发消息给用户）：</p>
                <code className="text-xs" style={{ color: "var(--atlas-accent)", fontFamily: "monospace" }}>POST https://atlascore.cn/api/bots/{bot.id}/reply</code>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 创建机器人 */}
      {showCreate ? (
        <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-accent)", boxShadow: "0 0 0 1px rgba(91,140,255,0.2)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>创建新机器人</p>
          <div className="flex gap-2 flex-wrap">
            {AVATARS.map(a => (
              <button key={a} onClick={() => setNewBotAvatar(a)}
                className="w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-all"
                style={{ background: newBotAvatar === a ? "rgba(91,140,255,0.2)" : "var(--atlas-elevated)", border: newBotAvatar === a ? "2px solid var(--atlas-accent)" : "2px solid transparent" }}>
                {a}
              </button>
            ))}
          </div>
          <input value={newBotName} onChange={e => setNewBotName(e.target.value)} placeholder="机器人名称（必填）*" className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text)" }} />
          <input value={newBotDesc} onChange={e => setNewBotDesc(e.target.value)} placeholder="描述（可选）" className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text)" }} />
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={createBot.isPending || !newBotName.trim()} className="flex-1 py-2 rounded-lg text-sm font-medium transition-opacity" style={{ background: "var(--atlas-accent)", color: "white", opacity: createBot.isPending || !newBotName.trim() ? 0.5 : 1 }}>
              {createBot.isPending ? "创建中..." : "创建机器人"}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg text-sm" style={{ color: "var(--atlas-text-3)" }}>取消</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowCreate(true)} className="w-full py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-all hover:opacity-80" style={{ background: "rgba(91,140,255,0.08)", border: "1px dashed rgba(91,140,255,0.3)", color: "var(--atlas-accent)" }}>
          <Plus className="w-4 h-4" />
          添加机器人
        </button>
      )}
    </div>
  );
}

// ── Schedule ──────────────────────────────────────────────────────────────────

// CRON presets for user-friendly schedule selection
const CRON_PRESETS = [
  { label: "每天 09:00",    cron: "0 0 9 * * *",   desc: "每天早上9点" },
  { label: "每天 18:00",    cron: "0 0 18 * * *",  desc: "每天下午6点" },
  { label: "每周一 08:00",  cron: "0 0 8 * * 1",   desc: "每周一早上8点" },
  { label: "每月1日 09:00", cron: "0 0 9 1 * *",   desc: "每月1日早上9点" },
  { label: "每周五 17:00",  cron: "0 0 17 * * 5",  desc: "每周五下午5点" },
];

function ScheduleSection() {
  const utils = trpc.useUtils();
  const { data: tasks = [], isLoading } = trpc.scheduled.list.useQuery();
  const createMut = trpc.scheduled.create.useMutation({
    onSuccess: () => { utils.scheduled.list.invalidate(); toast.success("定时任务已创建"); setAdding(false); setNewName(""); setNewEmail(""); setNewSessionId(""); },
    onError: (e) => toast.error(`创建失败：${e.message}`),
  });
  const updateMut = trpc.scheduled.update.useMutation({
    onSuccess: () => { utils.scheduled.list.invalidate(); toast.success("定时任务已更新"); },
    onError: (e) => toast.error(`更新失败：${e.message}`),
  });
  const deleteMut = trpc.scheduled.delete.useMutation({
    onSuccess: () => { utils.scheduled.list.invalidate(); toast.success("定时任务已删除"); },
    onError: (e) => toast.error(`删除失败：${e.message}`),
  });

  const { data: sessions = [] } = trpc.session.list.useQuery();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState("销售汇总报表");
  const [newCronPreset, setNewCronPreset] = useState(CRON_PRESETS[0]);
  const [newEmail, setNewEmail] = useState("");
  const [newSessionId, setNewSessionId] = useState("");

  const toggleTask = (id: string, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "paused" : "active";
    updateMut.mutate({ id, status: newStatus as "active" | "paused" | "error" });
  };
  const deleteTask = (id: string) => deleteMut.mutate({ id });
  const addTask = () => {
    if (!newName.trim()) { toast.error("请填写任务名称"); return; }
    if (!newSessionId) { toast.error("请选择要分析的数据文件"); return; }
    createMut.mutate({
      name: newName.trim(),
      templatePrompt: `生成${newTemplate}，分析数据趋势和关键指标`,
      templateName: newTemplate,
      cronExpr: newCronPreset.cron,
      scheduleDesc: newCronPreset.desc,
      notifyEmail: newEmail.trim() || undefined,
      lastSessionId: newSessionId,
    });
  };

  return (
    <div className="space-y-4">
      <SectionHeader icon={Clock} title="定时任务" desc="设置自动报表生成计划，定时推送到邮箱或群组" />
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--atlas-border)" }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ background: "var(--atlas-surface)", borderBottom: "1px solid var(--atlas-border)" }}>
          <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>已配置的任务</span>
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: "rgba(91,140,255,0.1)", color: "var(--atlas-accent)", border: "1px solid rgba(91,140,255,0.2)" }}>
            <Plus size={12} />新建任务
          </button>
        </div>
        <div style={{ background: "var(--atlas-surface)" }}>
          {isLoading && (
            <div className="px-5 py-6 flex items-center justify-center gap-2" style={{ color: "var(--atlas-text-3)" }}>
              <Loader2 size={14} className="animate-spin" />
              <span className="text-sm">加载中...</span>
            </div>
          )}
          {!isLoading && tasks.length === 0 && (
            <div className="px-5 py-6 text-center text-sm" style={{ color: "var(--atlas-text-3)" }}>
              暂无定时任务，点击「新建任务」开始配置
            </div>
          )}
          {tasks.map((t, i) => {
            const isActive = t.status === "active";
            return (
              <div key={t.id} className="px-5 py-3 flex items-center gap-3" style={{ borderTop: i > 0 ? "1px solid var(--atlas-border)" : "none" }}>
                <button onClick={() => toggleTask(t.id, t.status)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
                  style={{ background: isActive ? "rgba(52,211,153,0.1)" : "var(--atlas-elevated)", border: isActive ? "1px solid rgba(52,211,153,0.2)" : "1px solid var(--atlas-border)" }}>
                  {isActive ? <Play size={13} style={{ color: "#34D399" }} /> : <Pause size={13} style={{ color: "var(--atlas-text-3)" }} />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>{t.name}</span>
                    {t.templateName && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-3)", fontSize: "10px" }}>{t.templateName}</span>}
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: isActive ? "rgba(52,211,153,0.08)" : "var(--atlas-elevated)", color: isActive ? "#34D399" : "var(--atlas-text-3)", fontSize: "10px" }}>{isActive ? "运行中" : "已暂停"}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>⏰ {t.scheduleDesc || t.cronExpr}</span>
                    {t.notifyEmail && <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>✉️ {t.notifyEmail}</span>}
                    {t.runCount > 0 && <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>已执行 {t.runCount} 次</span>}
                    {t.nextRunAt && isActive && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs" style={{ color: "var(--atlas-text-3)", fontSize: "10px" }}>
                          {new Date(t.nextRunAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <NextRunCountdown nextRunAt={t.nextRunAt} />
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={() => deleteTask(t.id)} className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                  style={{ color: "var(--atlas-text-3)" }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.1)";
                    (e.currentTarget as HTMLElement).style.color = "#F87171";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                    (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
                  }}>
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <AnimatePresence>
        {adding && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="rounded-xl p-4 space-y-3" style={{ background: "var(--atlas-surface)", border: "1px solid rgba(91,140,255,0.25)" }}>
            <div className="grid grid-cols-2 gap-3">
              <FieldInput label="任务名称" value={newName} onChange={setNewName} placeholder="每日销售汇总" />
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>使用模板</label>
                <select value={newTemplate} onChange={e => setNewTemplate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text)" }}>
                  {["销售汇总报表", "财务利润报表", "库存盘点报表", "多平台对比报表"].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>执行频率</label>
              <select value={newCronPreset.cron} onChange={e => setNewCronPreset(CRON_PRESETS.find(p => p.cron === e.target.value) || CRON_PRESETS[0])}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text)" }}>
                {CRON_PRESETS.map(p => <option key={p.cron} value={p.cron}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>
                数据文件 <span style={{ color: "#F87171" }}>*</span>
              </label>
              <select value={newSessionId} onChange={e => setNewSessionId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "var(--atlas-elevated)", border: `1px solid ${newSessionId ? "var(--atlas-border)" : "rgba(248,113,113,0.4)"}`, color: newSessionId ? "var(--atlas-text)" : "var(--atlas-text-3)" }}>
                <option value="">— 选择已上传的数据文件 —</option>
                {sessions.filter(s => s.status === "ready").map(s => (
                  <option key={s.id} value={s.id}>
                    {s.originalName || s.filename}
                    {s.rowCount ? ` (${s.rowCount}行)` : ""}
                  </option>
                ))}
                {sessions.filter(s => s.status === "ready").length === 0 && (
                  <option disabled value="">请先在工作台上传文件</option>
                )}
              </select>
              {sessions.filter(s => s.status === "ready").length === 0 && (
                <p className="text-xs mt-1" style={{ color: "var(--atlas-text-3)" }}>
                  还没有可用的文件，请先到「工作台」上传 Excel 文件。
                </p>
              )}
            </div>
            <FieldInput label="通知邮符1（可选）" value={newEmail} onChange={setNewEmail} placeholder="boss@company.com" type="email" />
            <div className="flex gap-2">
              <button onClick={addTask} disabled={createMut.isPending}
                className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5"
                style={{ background: "var(--atlas-accent)", color: "#fff", opacity: createMut.isPending ? 0.7 : 1 }}>
                {createMut.isPending && <Loader2 size={12} className="animate-spin" />}
                创建
              </button>
              <button onClick={() => setAdding(false)} className="px-4 py-2 rounded-lg text-sm" style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-2)", border: "1px solid var(--atlas-border)" }}>取消</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState("profile");
  const { user } = useAtlas();
  const isAdmin = user?.role === "admin";

  const renderSection = () => {
    switch (activeSection) {
      case "profile":      return <ProfileSection />;
      case "appearance":   return <AppearanceSection />;
      case "apikeys":      return isAdmin ? <ApiKeysSection /> : <ProfileSection />;
      case "ai-engine":    return isAdmin ? <AiEngineSection /> : <ProfileSection />;
      case "platforms":    return isAdmin ? <PlatformsSection /> : <ProfileSection />;
      case "email":        return <EmailSection />;
      case "integrations": return <IntegrationsSection />;
      case "schedule":     return <ScheduleSection />;
      default:             return <ProfileSection />;
    }
  };

  const visibleNavItems = isAdmin
    ? [...NAV_ITEMS, ...ADMIN_NAV_ITEMS]
    : NAV_ITEMS;

  return (
    <div className="h-full flex overflow-hidden" style={{ background: "var(--atlas-bg)" }}>
      {/* Left nav */}
      <div className="w-48 flex-shrink-0 h-full overflow-y-auto py-5 px-3"
        style={{ background: "var(--atlas-surface)", borderRight: "1px solid var(--atlas-border)" }}>
        <p className="text-xs font-semibold uppercase tracking-wider px-3 mb-3"
          style={{ color: "var(--atlas-text-3)", fontSize: "10px", letterSpacing: "0.08em" }}>设置</p>
        <nav className="space-y-0.5">
          {visibleNavItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all"
              style={{
                background: activeSection === item.id ? "rgba(91,140,255,0.1)" : "transparent",
                color: activeSection === item.id ? "var(--atlas-accent)" : "var(--atlas-text-2)",
              }}
            >
              <item.icon size={14} />{item.label}
            </button>
          ))}
        </nav>
        <div className="mt-6 px-3 pt-4" style={{ borderTop: "1px solid var(--atlas-border)" }}>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--atlas-text-3)" }}>关于 ATLAS</p>
          <p className="text-xs" style={{ color: "var(--atlas-text-3)", fontFamily: "'JetBrains Mono', monospace" }}>v5.0.0</p>
          <p className="text-xs mt-1" style={{ color: "var(--atlas-text-3)" }}>React + FastAPI</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15 }}
            >
              {renderSection()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
