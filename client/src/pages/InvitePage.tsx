/**
 * ATLAS V7.1 — InvitePage
 * 邀请好友 · 各得500积分 · 微信分享海报
 */
import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gift, Copy, Check, Share2, Star, Image, Download, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import QRCode from "qrcode";

const INVITE_LINK_BASE = typeof window !== "undefined" ? window.location.origin : "";

// ── Poster Generator ──────────────────────────────────────────────────────────

async function generatePoster(inviteCode: string, inviteLink: string, credits: number): Promise<string> {
  const canvas = document.createElement("canvas");
  const W = 750, H = 1200;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Background gradient (dark theme matching ATLAS)
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0A0F1E");
  bg.addColorStop(0.5, "#0D1628");
  bg.addColorStop(1, "#0A0F1E");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Decorative glow circles
  const glow1 = ctx.createRadialGradient(150, 200, 0, 150, 200, 300);
  glow1.addColorStop(0, "rgba(91,140,255,0.15)");
  glow1.addColorStop(1, "transparent");
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, W, H);

  const glow2 = ctx.createRadialGradient(600, 900, 0, 600, 900, 250);
  glow2.addColorStop(0, "rgba(123,95,255,0.12)");
  glow2.addColorStop(1, "transparent");
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);

  // Top logo area
  ctx.fillStyle = "rgba(91,140,255,0.15)";
  roundRect(ctx, W / 2 - 44, 80, 88, 88, 22);
  ctx.fill();

  // ATLAS text in logo box
  ctx.fillStyle = "#5B8CFF";
  ctx.font = "bold 28px 'SF Pro Display', -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("ATLAS", W / 2, 134);

  // Tagline
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "22px -apple-system, sans-serif";
  ctx.fillText("智能报表生成平台", W / 2, 210);

  // Divider
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, 250);
  ctx.lineTo(W - 60, 250);
  ctx.stroke();

  // Main headline
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 52px -apple-system, sans-serif";
  ctx.fillText("邀请你加入 ATLAS", W / 2, 330);

  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = "28px -apple-system, sans-serif";
  ctx.fillText("注册即送 500 积分，可解锁高级功能", W / 2, 380);

  // Benefits cards
  const benefits = [
    { icon: "📊", title: "AI 智能分析", desc: "上传 Excel，秒出报表" },
    { icon: "⏰", title: "定时报表", desc: "自动生成，邮件推送" },
    { icon: "🎁", title: "邀请奖励", desc: "双方各得 500 积分" },
  ];
  const cardW = 200, cardH = 110, cardGap = 25;
  const totalW = benefits.length * cardW + (benefits.length - 1) * cardGap;
  const startX = (W - totalW) / 2;

  benefits.forEach((b, i) => {
    const x = startX + i * (cardW + cardGap);
    const y = 430;
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    roundRect(ctx, x, y, cardW, cardH, 16);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, cardW, cardH, 16);
    ctx.stroke();

    ctx.font = "28px serif";
    ctx.textAlign = "center";
    ctx.fillText(b.icon, x + cardW / 2, y + 38);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 18px -apple-system, sans-serif";
    ctx.fillText(b.title, x + cardW / 2, y + 65);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "14px -apple-system, sans-serif";
    ctx.fillText(b.desc, x + cardW / 2, y + 88);
  });

  // Invite code section
  const codeBoxY = 590;
  ctx.fillStyle = "rgba(91,140,255,0.12)";
  roundRect(ctx, 60, codeBoxY, W - 120, 100, 20);
  ctx.fill();
  ctx.strokeStyle = "rgba(91,140,255,0.3)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, 60, codeBoxY, W - 120, 100, 20);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "20px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("我的专属邀请码", W / 2, codeBoxY + 32);

  ctx.fillStyle = "#5B8CFF";
  ctx.font = "bold 44px 'JetBrains Mono', 'SF Mono', monospace";
  ctx.letterSpacing = "0.3em";
  ctx.fillText(inviteCode, W / 2, codeBoxY + 82);
  ctx.letterSpacing = "0";

  // Credits display
  if (credits > 0) {
    ctx.fillStyle = "rgba(52,211,153,0.12)";
    roundRect(ctx, 60, 720, W - 120, 60, 14);
    ctx.fill();
    ctx.fillStyle = "#34D399";
    ctx.font = "bold 20px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`✦ 我已积累 ${credits.toLocaleString()} 积分`, W / 2, 757);
  }

  // QR Code
  const qrSize = 220;
  const qrX = (W - qrSize) / 2;
  const qrY = 810;

  // White background for QR
  ctx.fillStyle = "#FFFFFF";
  roundRect(ctx, qrX - 16, qrY - 16, qrSize + 32, qrSize + 32, 20);
  ctx.fill();

  // Generate QR code as data URL
  const qrDataUrl = await QRCode.toDataURL(inviteLink, {
    width: qrSize,
    margin: 1,
    color: { dark: "#0A0F1E", light: "#FFFFFF" },
  });
  const qrImg = new window.Image();
  await new Promise<void>((resolve, reject) => {
    qrImg.onload = () => resolve();
    qrImg.onerror = reject;
    qrImg.src = qrDataUrl;
  });
  ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

  // QR label
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "22px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("扫码立即注册", W / 2, qrY + qrSize + 50);

  // Bottom watermark
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.font = "18px -apple-system, sans-serif";
  ctx.fillText("atlasrepo-cryfqh5q.manus.space · 智能报表 · 一键生成", W / 2, H - 40);

  return canvas.toDataURL("image/png");
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Poster Preview Modal ──────────────────────────────────────────────────────

function PosterModal({ dataUrl, onClose }: { dataUrl: string; onClose: () => void }) {
  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "ATLAS邀请海报.png";
    a.click();
    toast.success("海报已保存到本地");
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="relative max-h-[90vh] flex flex-col items-center gap-4"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center z-10"
          style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}
        >
          <X size={14} style={{ color: "var(--atlas-text-2)" }} />
        </button>
        <img
          src={dataUrl}
          alt="邀请海报"
          className="max-h-[75vh] w-auto rounded-2xl"
          style={{ boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}
        />
        <div className="flex gap-3">
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium"
            style={{ background: "var(--atlas-accent)", color: "#fff" }}
          >
            <Download size={14} /> 保存海报
          </button>
          <p className="text-xs self-center" style={{ color: "rgba(255,255,255,0.4)" }}>
            长按图片可直接分享到微信
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function InvitePage() {
  const [copied, setCopied] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [generatingPoster, setGeneratingPoster] = useState(false);

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
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success("邀请链接已复制");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("复制失败");
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(inviteCode);
      toast.success("邀请码已复制");
    } catch {
      toast.error("复制失败");
    }
  };

  const handleRedeem = () => {
    if (redeemCode.trim().length === 0) { toast.error("请输入邀请码"); return; }
    redeemMutation.mutate({ code: redeemCode.trim() });
  };

  const handleGeneratePoster = async () => {
    if (inviteCode === "—") { toast.error("邀请码加载中，请稍候"); return; }
    setGeneratingPoster(true);
    try {
      const url = await generatePoster(inviteCode, inviteLink, credits);
      setPosterUrl(url);
    } catch (e) {
      toast.error("海报生成失败，请重试");
      console.error(e);
    } finally {
      setGeneratingPoster(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--atlas-bg)" }}>
      <div className="max-w-2xl mx-auto px-6 py-8">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #5B8CFF22 0%, #7B5FFF22 100%)", border: "1px solid rgba(91,140,255,0.2)" }}>
              <Gift size={18} style={{ color: "var(--atlas-accent)" }} />
            </div>
            <div>
              <h1 className="text-lg font-bold" style={{ color: "var(--atlas-text)" }}>邀请好友</h1>
              <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>每成功邀请一位好友，双方各得 500 积分</p>
            </div>
          </div>
        </motion.div>

        {/* Credits card */}
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
              <p className="text-xs mt-1" style={{ color: "var(--atlas-text-3)" }}>
                已邀请 {inviteCount} 位好友 · 累计获得 {inviteCount * 500} 积分
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "rgba(91,140,255,0.15)" }}>
              <Star size={22} style={{ color: "var(--atlas-accent)" }} />
            </div>
          </div>
        </motion.div>

        {/* Invite code & share */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="rounded-2xl p-5 mb-4" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
          <p className="text-xs font-medium mb-3" style={{ color: "var(--atlas-text-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>我的邀请码</p>
          <div className="flex items-center justify-between px-4 py-3 rounded-xl mb-3"
            style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}>
            <span className="text-xl font-bold" style={{ color: "var(--atlas-text)", fontFamily: "JetBrains Mono, monospace", letterSpacing: "0.2em" }}>
              {isLoading ? "加载中..." : inviteCode}
            </span>
            <button onClick={handleCopyCode}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: "var(--atlas-nav-active-bg)", color: "var(--atlas-accent)", border: "1px solid rgba(91,140,255,0.2)" }}>
              <Copy size={11} /> 复制码
            </button>
          </div>

          {/* Share buttons row */}
          <div className="flex gap-2">
            <button onClick={handleCopyLink}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl transition-all text-sm font-medium"
              style={{ background: copied ? "rgba(52,211,153,0.15)" : "var(--atlas-accent)", color: "#fff" }}>
              {copied ? <Check size={14} /> : <Share2 size={14} />}
              {copied ? "链接已复制！" : "复制邀请链接"}
            </button>
            <button
              onClick={handleGeneratePoster}
              disabled={generatingPoster || isLoading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{
                background: "rgba(167,139,250,0.12)",
                border: "1px solid rgba(167,139,250,0.25)",
                color: "#A78BFA",
                opacity: generatingPoster || isLoading ? 0.6 : 1,
              }}
            >
              {generatingPoster ? <Loader2 size={14} className="animate-spin" /> : <Image size={14} />}
              {generatingPoster ? "生成中..." : "生成海报"}
            </button>
          </div>
          <p className="text-xs mt-2 text-center" style={{ color: "var(--atlas-text-3)" }}>
            支持微信、抖音、朋友圈等任意渠道分享
          </p>
        </motion.div>

        {/* Redeem code */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="rounded-2xl p-5 mb-4" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
          <p className="text-xs font-medium mb-3" style={{ color: "var(--atlas-text-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>兑换好友邀请码</p>
          <div className="flex gap-2">
            <input
              value={redeemCode}
              onChange={e => setRedeemCode(e.target.value.toUpperCase())}
              placeholder="输入好友邀请码"
              className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text)", fontFamily: "JetBrains Mono, monospace" }}
              onKeyDown={e => e.key === "Enter" && handleRedeem()}
            />
            <button
              onClick={handleRedeem}
              disabled={redeemMutation.isPending}
              className="px-4 py-2.5 rounded-xl text-sm font-medium flex-shrink-0"
              style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text-2)", opacity: redeemMutation.isPending ? 0.6 : 1 }}
            >
              {redeemMutation.isPending ? "兑换中..." : "兑换"}
            </button>
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--atlas-text-3)" }}>
            每个账号只能使用一次邀请码，兑换后双方各得 500 积分
          </p>
        </motion.div>

        {/* Footer */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-6 text-center">
          <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>
            积分可用于解锁定时报表、高级模板等付费功能
          </p>
        </motion.div>
      </div>

      {/* Poster Preview Modal */}
      <AnimatePresence>
        {posterUrl && (
          <PosterModal dataUrl={posterUrl} onClose={() => setPosterUrl(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
