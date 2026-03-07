/**
 * ATLAS HR Center — HR 中心入口页面
 * 两大功能入口：工资条制作 + 考勤汇总
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { DollarSign, Clock, ChevronRight, Sparkles, Shield, Zap } from "lucide-react";
import PayslipPage from "./PayslipPage";
import AttendancePage from "./AttendancePage";

type View = "center" | "payslip" | "attendance";

export default function HRCenterPage() {
  const [view, setView] = useState<View>("center");

  if (view === "payslip") return <PayslipPage onBack={() => setView("center")} />;
  if (view === "attendance") return <AttendancePage onBack={() => setView("center")} />;

  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--atlas-bg)" }}>
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B8CFF,#A78BFA)" }}>
              <Sparkles size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: "var(--atlas-text)" }}>HR 智能中心</h1>
              <p className="text-sm" style={{ color: "var(--atlas-text-muted)" }}>工资条制作 · 考勤汇总 · 数据保密</p>
            </div>
          </div>
        </motion.div>

        {/* Feature cards */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Payslip */}
          <motion.button
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            onClick={() => setView("payslip")}
            className="text-left p-6 rounded-2xl border transition-all hover:scale-[1.02] group"
            style={{ background: "rgba(52,211,153,0.06)", borderColor: "rgba(52,211,153,0.2)" }}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#34D399,#059669)" }}>
                <DollarSign size={22} className="text-white" />
              </div>
              <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" style={{ color: "#34D399" }} />
            </div>
            <h2 className="text-lg font-bold mb-1" style={{ color: "var(--atlas-text)" }}>工资条制作</h2>
            <p className="text-sm mb-4" style={{ color: "var(--atlas-text-muted)" }}>
              上传工资表，AI 自动识别字段，按 2024 年最新税率计算个税，生成规范工资条 Excel
            </p>
            <div className="flex flex-wrap gap-2">
              {["自动计算个税", "三 Sheet 输出", "支持 CSV/Excel"].map(tag => (
                <span key={tag} className="px-2 py-0.5 rounded text-xs" style={{ background: "rgba(52,211,153,0.15)", color: "#34D399" }}>{tag}</span>
              ))}
            </div>
          </motion.button>

          {/* Attendance */}
          <motion.button
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
            onClick={() => setView("attendance")}
            className="text-left p-6 rounded-2xl border transition-all hover:scale-[1.02] group"
            style={{ background: "rgba(91,140,255,0.06)", borderColor: "rgba(91,140,255,0.2)" }}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B8CFF,#2563EB)" }}>
                <Clock size={22} className="text-white" />
              </div>
              <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" style={{ color: "#5B8CFF" }} />
            </div>
            <h2 className="text-lg font-bold mb-1" style={{ color: "var(--atlas-text)" }}>考勤汇总</h2>
            <p className="text-sm mb-4" style={{ color: "var(--atlas-text-muted)" }}>
              上传打卡记录，自动识别迟到、旷工、早退，生成月度考勤汇总报表和异常明细
            </p>
            <div className="flex flex-wrap gap-2">
              {["自动识别异常", "部门汇总", "加班统计"].map(tag => (
                <span key={tag} className="px-2 py-0.5 rounded text-xs" style={{ background: "rgba(91,140,255,0.15)", color: "#5B8CFF" }}>{tag}</span>
              ))}
            </div>
          </motion.button>
        </div>

        {/* Trust badges */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
          className="grid grid-cols-3 gap-3">
          {[
            { icon: Shield, title: "数据安全", desc: "文件 1 小时后自动删除，不留存敏感数据", color: "#34D399" },
            { icon: Zap, title: "秒级处理", desc: "AI 自动识别字段，无需手动配置模板", color: "#FBBF24" },
            { icon: Sparkles, title: "合规计算", desc: "内置 2024 年最新个税算法，自动扣除起征点", color: "#A78BFA" },
          ].map(({ icon: Icon, title, desc, color }) => (
            <div key={title} className="rounded-xl p-4 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <Icon size={20} className="mx-auto mb-2" style={{ color }} />
              <p className="text-sm font-semibold mb-1" style={{ color: "var(--atlas-text)" }}>{title}</p>
              <p className="text-xs" style={{ color: "var(--atlas-text-muted)" }}>{desc}</p>
            </div>
          ))}
        </motion.div>

        {/* Coming soon */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
          className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.1)" }}>
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--atlas-text-muted)" }}>即将推出</p>
          <div className="flex flex-wrap gap-2">
            {["绩效评估汇总", "招聘漏斗分析", "培训记录统计", "工资条邮件推送"].map(item => (
              <span key={item} className="px-2.5 py-1 rounded-lg text-xs" style={{ background: "rgba(255,255,255,0.05)", color: "var(--atlas-text-muted)" }}>{item}</span>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
