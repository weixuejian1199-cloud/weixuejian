/**
 * ATLAS V6.1 — InvitePage
 * 邀请好友 · 各得500积分
 * Real tRPC API integration
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { Gift, Copy, Check, Share2, ChevronRight, Star } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const INVITE_LINK_BASE = typeof window !== "undefined" ? window.location.origin : "";

export default function InvitePage() {
  const [copied, setCopied] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");

  const { data: inviteData, isLoading } = trpc.invite.getMyCode.useQuery(undefined, { retry: false });

  const redeemMutation = trpc.invite.redeem.useMutation({
    onSuccess: () => { toast.success("兑换成功！已获得 500 积分"); setRedeemCode(""); },
    onError: (err) => { toast.error(err.message || "兑换失败"); },
  });

  const inviteCode = inviteData?.code || "—";
  const credits = inviteData?.credits || 0;
  const inviteCount = inviteData?.inviteCount || 0;
  const inviteLink = INVITE_LINK_BASE + "?invite=" + inviteCode;

  const handleCopyLink = async () => {
    try { await navigator.clipboard.writeText(inviteLink); setCopied(true); toast.success("邀请链接已复制"); setTimeout(() => setCopied(false), 2000); }
    catch { toast.error("复制失败"); }
  };
  const handleCopyCode = async () => {
    try { await navigator.clipboard.writeText(inviteCode); toast.success("邀请码已复制"); }
    catch { toast.error("复制失败"); }
  };
  const handleRedeem = () => {
    if (redeemCode.trim().length === 0) { toast.error("请输入邀请码"); return; }
    redeemMutation.mutate({ code: redeemCode.trim() });
  };

  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--atlas-bg)" }}>
      <div className="max-w-2xl mx-auto px-6 py-8">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #5B8CFF22 0%, #7B5FFF22 100%)", border: "1px solid rgba(91,140,255,0.2)" }}>
              <Gift size={18} style={{ color: "var(--atlas-accent)" }} />
            </div>
            <div>
              <h1 className="text-lg font-bold" style={{ color: "var(--atlas-text)" }}>邀请好友</h1>
              <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>每成功邀请一位好友，双方各得 500 积分</p>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="rounded-2xl p-5 mb-4"
          style={{ background: "linear-gradient(135deg, rgba(91,140,255,0.12) 0%, rgba(123,95,255,0.08) 100%)", border: "1px solid rgba(91,140,255,0.2)" }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs mb-1" style={{ color: "var(--atlas-text-3)" }}>我的积分余额</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-bold" style={{ color: "var(--atlas-accent)", fontFamily: "JetBrains Mono, monospace" }}>
                  {isLoading ? "..." : credits.toLocaleString()}
                </span>
                <span className="text-sm" style={{ color: "var(--atlas-text-2)" }}>积分</span>
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--atlas-text-3)" }}>已邀请 {inviteCount} 位好友 · 累计获得 {inviteCount * 500} 积分</p>
            </div>
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "rgba(91,140,255,0.15)" }}>
              <Star size={22} style={{ color: "var(--atlas-accent)" }} />
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="rounded-2xl p-5 mb-4" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
          <p className="text-xs font-medium mb-3" style={{ color: "var(--atlas-text-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>我的邀请码</p>
          <div className="flex items-center justify-between px-4 py-3 rounded-xl mb-3" style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}>
            <span className="text-xl font-bold" style={{ color: "var(--atlas-text)", fontFamily: "JetBrains Mono, monospace", letterSpacing: "0.2em" }}>
              {isLoading ? "加载中..." : inviteCode}
            </span>
            <button onClick={handleCopyCode} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "var(--atlas-nav-active-bg)", color: "var(--atlas-accent)", border: "1px solid rgba(91,140,255,0.2)" }}>
              <Copy size={11} />复制码
            </button>
          </div>
          <button onClick={handleCopyLink} className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all"
            style={{ background: copied ? "rgba(52,211,153,0.1)" : "var(--atlas-accent)", color: "#fff" }}>
            <div className="flex items-center gap-2">
              {copied ? <Check size={15} /> : <Share2 size={15} />}
              <span className="text-sm font-medium">{copied ? "链接已复制！" : "复制邀请链接"}</span>
            </div>
          </button>
          <p className="text-xs mt-2 text-center" style={{ color: "var(--atlas-text-3)" }}>支持微信、抖音、朋友圈等任意渠道分享</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="rounded-2xl p-5 mb-4" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
          <p className="text-xs font-medium mb-3" style={{ color: "var(--atlas-text-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>兑换好友邀请码</p>
          <div className="flex gap-2">
            <input value={redeemCode} onChange={e => setRedeemCode(e.target.value.toUpperCase())} placeholder="输入好友邀请码"
              className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text)", fontFamily: "JetBrains Mono, monospace" }}
              onKeyDown={e => e.key === "Enter" && handleRedeem()} />
            <button onClick={handleRedeem} disabled={redeemMutation.isPending}
              className="px-4 py-2.5 rounded-xl text-sm font-medium flex-shrink-0"
              style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text-2)", opacity: redeemMutation.isPending ? 0.6 : 1 }}>
              {redeemMutation.isPending ? "兑换中..." : "兑换"}
            </button>
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--atlas-text-3)" }}>每个账号只能使用一次邀请码，兑换后双方各得 500 积分</p>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-6 text-center">
          <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>积分可用于解锁定时报表、高级模板等付费功能</p>
        </motion.div>
      </div>
    </div>
  );
}
