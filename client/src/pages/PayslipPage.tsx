/**
 * ATLAS HR — 工资条制作页面
 * 流程：上传工资表 → AI 自动识别字段 → 确认字段映射 → 生成工资条 Excel → 下载
 */
import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, FileSpreadsheet, ChevronRight, CheckCircle2,
  Download, Loader2, AlertCircle, Users, DollarSign,
  Calculator, ArrowLeft, RefreshCw, Eye, X,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FieldMap {
  nameCol: string;
  emailCol: string;
  baseSalaryCol: string;
  bonusCol: string;
  deductionCol: string;
  insuranceCol: string;
  deptCol: string;
}

interface UploadResult {
  id: string;
  headers: string[];
  fieldMap: FieldMap;
  preview: Record<string, unknown>[];
  employeeCount: number;
}

interface GenerateResult {
  id: string;
  downloadUrl: string;
  employeeCount: number;
  summary: { totalPayroll: number; totalNetPay: number; totalTax: number; avgSalary: number };
  preview: Array<{ name: string; dept: string; email: string; grossSalary: number; insurance: number; incomeTax: number; netSalary: number }>;
}

type Step = "upload" | "mapping" | "preview" | "done";

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const FIELD_LABELS: { key: keyof FieldMap; label: string; required: boolean; hint: string }[] = [
  { key: "nameCol",        label: "员工姓名",   required: true,  hint: "如：姓名、员工姓名、Name" },
  { key: "deptCol",        label: "部门",       required: false, hint: "如：部门、Department" },
  { key: "baseSalaryCol",  label: "基本工资",   required: true,  hint: "如：基本工资、底薪、Base Salary" },
  { key: "bonusCol",       label: "奖金/绩效",  required: false, hint: "如：奖金、绩效奖金、Bonus" },
  { key: "deductionCol",   label: "扣款",       required: false, hint: "如：扣款、罚款、Deduction" },
  { key: "insuranceCol",   label: "五险一金",   required: false, hint: "个人部分，不填则按 10.5% 自动计算" },
  { key: "emailCol",       label: "邮箱",       required: false, hint: "用于后续邮件推送工资条" },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function PayslipPage({ onBack }: { onBack?: () => void }) {
  const [step, setStep] = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [fieldMap, setFieldMap] = useState<FieldMap | null>(null);
  const [generateResult, setGenerateResult] = useState<GenerateResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Upload ──────────────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      toast.error("请上传 Excel (.xlsx/.xls) 或 CSV 文件");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("文件大小不能超过 20MB");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/hr/payslip/upload", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "上传失败");
      }
      const data: UploadResult = await res.json();
      setUploadResult(data);
      setFieldMap(data.fieldMap);
      setStep("mapping");
      toast.success(`已识别 ${data.employeeCount} 名员工，请确认字段映射`);
    } catch (e: any) {
      toast.error(e.message || "上传失败，请重试");
    } finally {
      setUploading(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ── Generate ────────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!uploadResult || !fieldMap) return;
    if (!fieldMap.nameCol || !fieldMap.baseSalaryCol) {
      toast.error("请至少配置「员工姓名」和「基本工资」字段");
      return;
    }

    setGenerating(true);
    try {
      const res = await fetch("/api/hr/payslip/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: uploadResult.id, fieldMap, period }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "生成失败");
      }
      const data: GenerateResult = await res.json();
      setGenerateResult(data);
      setStep("preview");
      toast.success(`工资条已生成，共 ${data.employeeCount} 人`);
    } catch (e: any) {
      toast.error(e.message || "生成失败，请重试");
    } finally {
      setGenerating(false);
    }
  };

  // ── Reset ───────────────────────────────────────────────────────────────────

  const handleReset = () => {
    setStep("upload");
    setUploadResult(null);
    setFieldMap(null);
    setGenerateResult(null);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--atlas-bg)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        {onBack && (
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <ArrowLeft size={18} style={{ color: "var(--atlas-text-muted)" }} />
          </button>
        )}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg,#34D399,#059669)" }}>
            <DollarSign size={16} className="text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-sm" style={{ color: "var(--atlas-text)" }}>工资条制作</h1>
            <p className="text-xs" style={{ color: "var(--atlas-text-muted)" }}>上传工资表 → 自动计算个税 → 生成规范工资条</p>
          </div>
        </div>
        {/* Step indicator */}
        <div className="ml-auto flex items-center gap-1">
          {(["upload", "mapping", "preview", "done"] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all"
                style={{
                  background: step === s ? "#34D399" : (["upload","mapping","preview","done"].indexOf(step) > i ? "rgba(52,211,153,0.3)" : "rgba(255,255,255,0.1)"),
                  color: step === s ? "white" : (["upload","mapping","preview","done"].indexOf(step) > i ? "#34D399" : "var(--atlas-text-muted)"),
                }}
              >
                {["upload","mapping","preview","done"].indexOf(step) > i ? <CheckCircle2 size={12} /> : i + 1}
              </div>
              {i < 3 && <div className="w-4 h-px" style={{ background: "rgba(255,255,255,0.15)" }} />}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <AnimatePresence mode="wait">

          {/* Step 1: Upload */}
          {step === "upload" && (
            <motion.div key="upload" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
              className="max-w-2xl mx-auto space-y-6">
              {/* Period selector */}
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium" style={{ color: "var(--atlas-text-muted)" }}>工资期间</label>
                <input
                  type="month" value={period} onChange={e => setPeriod(e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-sm border"
                  style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.1)", color: "var(--atlas-text)" }}
                />
              </div>

              {/* Drop zone */}
              <div
                className={`relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${dragging ? "border-green-400 bg-green-400/10" : "hover:border-white/30"}`}
                style={{ borderColor: dragging ? "#34D399" : "rgba(255,255,255,0.15)" }}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
                {uploading ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 size={40} className="animate-spin" style={{ color: "#34D399" }} />
                    <p className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>正在上传并识别字段...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(52,211,153,0.15)" }}>
                      <Upload size={28} style={{ color: "#34D399" }} />
                    </div>
                    <div>
                      <p className="font-semibold" style={{ color: "var(--atlas-text)" }}>拖拽或点击上传工资表</p>
                      <p className="text-sm mt-1" style={{ color: "var(--atlas-text-muted)" }}>支持 .xlsx / .xls / .csv，最大 20MB</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Tips */}
              <div className="rounded-xl p-4 space-y-2" style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)" }}>
                <p className="text-xs font-semibold" style={{ color: "#34D399" }}>📋 工资表格式说明</p>
                <p className="text-xs" style={{ color: "var(--atlas-text-muted)" }}>
                  第一行为表头，每行代表一名员工。建议包含：姓名、部门、基本工资、奖金、扣款等列。
                  AI 会自动识别列名，无需严格按照模板格式。
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {["姓名", "部门", "基本工资", "绩效奖金", "扣款", "五险一金", "邮箱"].map(tag => (
                    <span key={tag} className="px-2 py-0.5 rounded text-xs" style={{ background: "rgba(52,211,153,0.15)", color: "#34D399" }}>{tag}</span>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 2: Field Mapping */}
          {step === "mapping" && uploadResult && fieldMap && (
            <motion.div key="mapping" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
              className="max-w-2xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold" style={{ color: "var(--atlas-text)" }}>确认字段映射</h2>
                  <p className="text-sm mt-0.5" style={{ color: "var(--atlas-text-muted)" }}>
                    AI 已自动识别 {uploadResult.employeeCount} 名员工，请确认或调整字段对应关系
                  </p>
                </div>
                <button onClick={handleReset} className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors" style={{ color: "var(--atlas-text-muted)" }}>
                  <RefreshCw size={12} /> 重新上传
                </button>
              </div>

              {/* Field mapping form */}
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                {FIELD_LABELS.map(({ key, label, required, hint }, idx) => (
                  <div key={key} className={`flex items-center gap-4 px-4 py-3 ${idx > 0 ? "border-t" : ""}`}
                    style={{ borderColor: "rgba(255,255,255,0.06)", background: idx % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                    <div className="w-28 flex-shrink-0">
                      <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>{label}</span>
                      {required && <span className="ml-1 text-xs" style={{ color: "#F87171" }}>*</span>}
                    </div>
                    <select
                      value={fieldMap[key]}
                      onChange={e => setFieldMap(prev => ({ ...prev!, [key]: e.target.value }))}
                      className="flex-1 px-3 py-1.5 rounded-lg text-sm border"
                      style={{ background: "rgba(255,255,255,0.05)", borderColor: fieldMap[key] ? "rgba(52,211,153,0.4)" : "rgba(255,255,255,0.1)", color: "var(--atlas-text)" }}
                    >
                      <option value="">— 不使用 —</option>
                      {uploadResult.headers.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                    <span className="text-xs w-40 flex-shrink-0 hidden md:block" style={{ color: "var(--atlas-text-muted)" }}>{hint}</span>
                  </div>
                ))}
              </div>

              {/* Preview table */}
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: "var(--atlas-text-muted)" }}>数据预览（前 5 行）</p>
                <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.05)" }}>
                        {uploadResult.headers.slice(0, 6).map(h => (
                          <th key={h} className="px-3 py-2 text-left font-medium" style={{ color: "var(--atlas-text-muted)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {uploadResult.preview.map((row, i) => (
                        <tr key={i} className="border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                          {uploadResult.headers.slice(0, 6).map(h => (
                            <td key={h} className="px-3 py-2" style={{ color: "var(--atlas-text)" }}>{String(row[h] ?? "")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Generate button */}
              <button
                onClick={handleGenerate}
                disabled={generating || !fieldMap.nameCol || !fieldMap.baseSalaryCol}
                className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#34D399,#059669)", color: "white" }}
              >
                {generating ? <><Loader2 size={16} className="animate-spin" /> 正在计算个税并生成工资条...</> : <><Calculator size={16} /> 生成工资条 Excel</>}
              </button>
            </motion.div>
          )}

          {/* Step 3: Preview & Download */}
          {step === "preview" && generateResult && (
            <motion.div key="preview" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
              className="max-w-3xl mx-auto space-y-6">
              {/* Success banner */}
              <div className="rounded-2xl p-5 flex items-start gap-4" style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)" }}>
                <CheckCircle2 size={24} style={{ color: "#34D399", flexShrink: 0, marginTop: 2 }} />
                <div className="flex-1">
                  <p className="font-semibold" style={{ color: "#34D399" }}>工资条已生成！</p>
                  <p className="text-sm mt-0.5" style={{ color: "var(--atlas-text-muted)" }}>
                    共 {generateResult.employeeCount} 名员工，包含汇总表、个人工资条、个税明细三个 Sheet
                  </p>
                </div>
                <a
                  href={generateResult.downloadUrl}
                  download
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
                  style={{ background: "#34D399", color: "white" }}
                >
                  <Download size={14} /> 下载 Excel
                </a>
              </div>

              {/* Summary stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "应发工资总额", value: `¥${fmt(generateResult.summary.totalPayroll)}`, color: "#5B8CFF" },
                  { label: "实发工资总额", value: `¥${fmt(generateResult.summary.totalNetPay)}`, color: "#34D399" },
                  { label: "个税合计", value: `¥${fmt(generateResult.summary.totalTax)}`, color: "#FBBF24" },
                  { label: "人均实发", value: `¥${fmt(generateResult.summary.avgSalary)}`, color: "#A78BFA" },
                ].map(stat => (
                  <div key={stat.label} className="rounded-xl p-4 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <p className="text-lg font-bold" style={{ color: stat.color }}>{stat.value}</p>
                    <p className="text-xs mt-1" style={{ color: "var(--atlas-text-muted)" }}>{stat.label}</p>
                  </div>
                ))}
              </div>

              {/* Employee preview table */}
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: "var(--atlas-text-muted)" }}>员工工资预览（前 10 人）</p>
                <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.05)" }}>
                        {["姓名", "部门", "应发工资", "五险一金", "个税", "实发工资"].map(h => (
                          <th key={h} className="px-3 py-2 text-right first:text-left font-medium" style={{ color: "var(--atlas-text-muted)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {generateResult.preview.map((emp, i) => (
                        <tr key={i} className="border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                          <td className="px-3 py-2 font-medium" style={{ color: "var(--atlas-text)" }}>{emp.name}</td>
                          <td className="px-3 py-2 text-right" style={{ color: "var(--atlas-text-muted)" }}>{emp.dept || "—"}</td>
                          <td className="px-3 py-2 text-right" style={{ color: "var(--atlas-text)" }}>{fmt(emp.grossSalary)}</td>
                          <td className="px-3 py-2 text-right" style={{ color: "#FBBF24" }}>{fmt(emp.insurance)}</td>
                          <td className="px-3 py-2 text-right" style={{ color: "#F87171" }}>{fmt(emp.incomeTax)}</td>
                          <td className="px-3 py-2 text-right font-semibold" style={{ color: "#34D399" }}>{fmt(emp.netSalary)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button onClick={handleReset} className="flex-1 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 hover:bg-white/10 transition-colors border" style={{ borderColor: "rgba(255,255,255,0.12)", color: "var(--atlas-text-muted)" }}>
                  <RefreshCw size={14} /> 制作新一期
                </button>
                <a
                  href={generateResult.downloadUrl}
                  download
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90"
                  style={{ background: "linear-gradient(135deg,#34D399,#059669)", color: "white" }}
                >
                  <Download size={14} /> 下载工资条 Excel
                </a>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
