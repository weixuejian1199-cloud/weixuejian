/**
 * ATLAS — Login Modal
 * 使用 Manus OAuth 登录，点击按钮跳转授权页，完成后自动回到当前页面
 */
import { motion, AnimatePresence } from "framer-motion";
import { X, Shield, LogIn } from "lucide-react";
import { useAtlas } from "@/contexts/AtlasContext";
import { getLoginUrl } from "@/const";

export default function LoginModal() {
  const { setShowLoginModal } = useAtlas();

  const handleLogin = () => {
    window.location.href = getLoginUrl();
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
          {/* Close button */}
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
          <div className="px-8 pt-8 pb-6 text-center">
            <div className="flex items-center justify-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--atlas-accent)" }}>
                <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1L13 12H1L7 1Z" fill="white" fillOpacity="0.9" />
                </svg>
              </div>
              <span className="font-bold tracking-widest text-sm uppercase" style={{ color: "var(--atlas-text)", letterSpacing: "0.12em" }}>ATLAS</span>
            </div>
            <h2 className="text-xl font-bold mb-2" style={{ color: "var(--atlas-text)" }}>
              登录以继续使用
            </h2>
            <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>
              使用 Manus 账号一键登录，安全可靠
            </p>
          </div>

          {/* Feature highlights */}
          <div className="px-8 pb-6 space-y-2.5">
            {[
              { icon: "📊", text: "AI 智能分析 Excel / CSV 数据" },
              { icon: "📝", text: "自然语言生成专业报表" },
              { icon: "🏢", text: "HR 工资条 · 考勤分析 · 财务汇总" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "var(--atlas-elevated)" }}>
                <span className="text-base">{item.icon}</span>
                <span className="text-sm" style={{ color: "var(--atlas-text-2)" }}>{item.text}</span>
              </div>
            ))}
          </div>

          {/* Security badge */}
          <div className="mx-8 mb-5 flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.15)" }}>
            <Shield size={12} style={{ color: "var(--atlas-success)" }} />
            <span className="text-xs" style={{ color: "var(--atlas-success)" }}>端对端加密 · 数据完全隔离 · 文件1小时后自动删除</span>
          </div>

          {/* Login button */}
          <div className="px-8 pb-8">
            <button
              onClick={handleLogin}
              className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all"
              style={{ background: "var(--atlas-accent)", color: "#fff" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = "0.9"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = "1"}
            >
              <LogIn size={15} />
              使用 Manus 账号登录
            </button>
            <p className="text-center text-xs mt-3" style={{ color: "var(--atlas-text-3)" }}>
              登录即表示同意 ATLAS 服务条款与隐私政策
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
