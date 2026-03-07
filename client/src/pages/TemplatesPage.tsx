/**
 * ATLAS V4.0 — 模板库
 * Features: browse, pin, custom create, AI generate, use in workspace
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutTemplate, Plus, Search, Sparkles,
  FileSpreadsheet, TrendingUp, BarChart2, PieChart, Table2,
  Users, Package, DollarSign, X, Loader2, ChevronRight,
  Pencil, Trash2, Pin, Check, Eye,
} from "lucide-react";
import { useAtlas } from "@/contexts/AtlasContext";
import { toast } from "sonner";
import { nanoid } from "nanoid";

interface TemplateField {
  name: string;
  type: string;
  example: string;
}

interface Template {
  id: string;
  title: string;
  desc: string;
  category: string;
  iconName: string;
  color: string;
  prompt: string;
  pinned: boolean;
  custom: boolean;
  usageCount: number;
  // Preview data
  fields?: TemplateField[];
  sampleRows?: string[][];
  useCases?: string[];
}

const ICON_MAP: Record<string, typeof FileSpreadsheet> = {
  TrendingUp, Package, DollarSign, Users, BarChart2, PieChart, Table2, FileSpreadsheet,
};

const BUILTIN_TEMPLATES: Template[] = [
  // ── HR 模板 ──
  {
    id: "hr1", title: "工资条生成", category: "HR", desc: "批量生成员工工资条，自动计算个税和社保", iconName: "Users", color: "#34D399",
    prompt: "请生成工资条，包含：员工姓名、基本工资、绩效奖金、各项扣款、应发工资、个税计算、实发工资，按人生成独立工资条",
    pinned: true, custom: false, usageCount: 0,
    fields: [
      { name: "员工姓名", type: "文本", example: "张三" },
      { name: "基本工资", type: "数字", example: "8000" },
      { name: "绩效奖金", type: "数字", example: "2000" },
      { name: "社保扣款", type: "数字", example: "800" },
      { name: "个税", type: "数字", example: "350" },
      { name: "实发工资", type: "数字", example: "8850" },
    ],
    sampleRows: [
      ["张三", "8000", "2000", "800", "350", "8850"],
      ["李四", "7500", "1500", "750", "280", "7970"],
      ["王五", "9000", "3000", "900", "520", "10580"],
    ],
    useCases: ["月度工资条发放", "年终奖金计算", "新员入职工资确认"],
  },
  {
    id: "hr2", title: "考勤汇总报表", category: "HR", desc: "按月汇总出勤、迟到、旷工、加班数据", iconName: "Table2", color: "#5B8CFF",
    prompt: "请生成考勤汇总报表，包含：员工姓名、部门、出勤天数、迟到次数、早退次数、旷工天数、加班时长、异常明细",
    pinned: true, custom: false, usageCount: 0,
    fields: [
      { name: "员工姓名", type: "文本", example: "张三" },
      { name: "部门", type: "文本", example: "销售部" },
      { name: "出勤天数", type: "数字", example: "22" },
      { name: "迟到次数", type: "数字", example: "1" },
      { name: "旷工天数", type: "数字", example: "0" },
      { name: "加班时长(h)", type: "数字", example: "4" },
    ],
    sampleRows: [
      ["张三", "销售部", "22", "1", "0", "4"],
      ["李四", "HR部", "21", "0", "0", "0"],
      ["王五", "运营部", "20", "2", "1", "2"],
    ],
    useCases: ["月度考勤汇总", "加班费结算", "异常考勤处理"],
  },
  {
    id: "hr3", title: "部门薪资分析", category: "HR", desc: "各部门薪资对比、平均薪资、薪资分布", iconName: "BarChart2", color: "#FBBF24",
    prompt: "请生成部门薪资分析报表，包含：各部门平均薪资、薪资总额、人均成本、薪资分布区间、部门薪资占比",
    pinned: false, custom: false, usageCount: 0,
    fields: [
      { name: "部门", type: "文本", example: "销售部" },
      { name: "人数", type: "数字", example: "12" },
      { name: "平均薪资", type: "数字", example: "9500" },
      { name: "薪资总额", type: "数字", example: "114000" },
      { name: "占比", type: "百分比", example: "28%" },
    ],
    sampleRows: [
      ["销售部", "12", "9500", "114000", "28%"],
      ["HR部", "5", "8000", "40000", "10%"],
      ["技术部", "8", "15000", "120000", "30%"],
    ],
    useCases: ["薪资预算制定", "部门成本控制", "薪资结构优化"],
  },
  {
    id: "hr4", title: "员工入离职分析", category: "HR", desc: "入职、离职、流失率、在职周期分析", iconName: "TrendingUp", color: "#A78BFA",
    prompt: "请生成员工入离职分析报表，包含：当月入职人数、离职人数、流失率、离职原因分类、平均在职周期、部门分布",
    pinned: false, custom: false, usageCount: 0,
    fields: [
      { name: "月份", type: "文本", example: "2026-03" },
      { name: "入职人数", type: "数字", example: "5" },
      { name: "离职人数", type: "数字", example: "2" },
      { name: "流失率", type: "百分比", example: "3.2%" },
      { name: "平均在职周期", type: "文本", example: "18个月" },
    ],
    sampleRows: [
      ["2026-01", "8", "3", "4.8%", "16个月"],
      ["2026-02", "5", "1", "1.6%", "20个月"],
      ["2026-03", "5", "2", "3.2%", "18个月"],
    ],
    useCases: ["季度人力盘点", "离职原因分析", "招聘计划制定"],
  },
  // ── 销售 ──
  {
    id: "t1", title: "销售汇总报表", category: "销售", desc: "按时间、品类、渠道汇总销售额、订单量、客单价", iconName: "TrendingUp", color: "#5B8CFF",
    prompt: "请生成销售汇总报表，包含：总销售额、订单数、客单价、按日期趋势、按品类分布、环比增长率",
    pinned: true, custom: false, usageCount: 128,
    fields: [
      { name: "日期", type: "日期", example: "2026-03-01" },
      { name: "销售额", type: "数字", example: "12580" },
      { name: "订单数", type: "数字", example: "86" },
      { name: "客单价", type: "数字", example: "146.3" },
      { name: "品类", type: "文本", example: "服装" },
    ],
    sampleRows: [
      ["2026-03-01", "12580", "86", "146.3", "服装"],
      ["2026-03-02", "9870", "64", "154.2", "配件"],
      ["2026-03-03", "15200", "102", "149.0", "服装"],
    ],
    useCases: ["日销售复盘", "月度销售总结", "品类贡献度分析"],
  },
  {
    id: "t2", title: "库存盘点报表", category: "库存", desc: "统计各 SKU 库存量、周转率、滞销预警", iconName: "Package", color: "#34D399",
    prompt: "请生成库存盘点报表，包含：各SKU当前库存、库存周转天数、滞销预警（超过30天未售）、补货建议",
    pinned: false, custom: false, usageCount: 87,
    fields: [
      { name: "SKU编码", type: "文本", example: "SKU-001" },
      { name: "商品名称", type: "文本", example: "夏季连衣裙" },
      { name: "当前库存", type: "数字", example: "245" },
      { name: "周转天数", type: "数字", example: "12" },
      { name: "状态", type: "文本", example: "正常" },
    ],
    sampleRows: [
      ["SKU-001", "夏季连衣裙", "245", "12", "正常"],
      ["SKU-002", "冬季大衣", "38", "45", "滞销预警"],
      ["SKU-003", "休闲裤", "0", "-", "缺货"],
    ],
    useCases: ["季度库存盘点", "补货决策支持", "滞销商品处理"],
  },
  {
    id: "t3", title: "财务利润报表", category: "财务", desc: "收入、成本、毛利润、净利润多维度分析", iconName: "DollarSign", color: "#FBBF24",
    prompt: "请生成财务利润报表，包含：总收入、总成本、毛利润、净利润、利润率、按月对比",
    pinned: true, custom: false, usageCount: 203,
    fields: [
      { name: "月份", type: "文本", example: "2026-03" },
      { name: "总收入", type: "数字", example: "580000" },
      { name: "总成本", type: "数字", example: "320000" },
      { name: "毛利润", type: "数字", example: "260000" },
      { name: "利润率", type: "百分比", example: "44.8%" },
    ],
    sampleRows: [
      ["2026-01", "520000", "295000", "225000", "43.3%"],
      ["2026-02", "548000", "308000", "240000", "43.8%"],
      ["2026-03", "580000", "320000", "260000", "44.8%"],
    ],
    useCases: ["月度财务复盘", "年度利润分析", "成本控制优化"],
  },
  {
    id: "t4", title: "用户行为分析", category: "用户", desc: "新增用户、留存率、复购率、用户分层", iconName: "Users", color: "#A78BFA",
    prompt: "请生成用户行为分析报表，包含：新增用户数、7日留存率、30日复购率、RFM用户分层、高价値用户特征",
    pinned: false, custom: false, usageCount: 64,
    fields: [
      { name: "日期", type: "日期", example: "2026-03-01" },
      { name: "新增用户", type: "数字", example: "128" },
      { name: "7日留存率", type: "百分比", example: "42%" },
      { name: "30日复购率", type: "百分比", example: "18%" },
      { name: "用户层级", type: "文本", example: "高价値" },
    ],
    sampleRows: [
      ["2026-03-01", "128", "42%", "18%", "高价値"],
      ["2026-03-02", "95", "38%", "15%", "中价値"],
      ["2026-03-03", "143", "45%", "21%", "高价値"],
    ],
    useCases: ["用户增长分析", "RFM分层运营", "留存率优化跟踪"],
  },
  {
    id: "t5", title: "多平台对比报表", category: "销售", desc: "天猫、抖音、拼多多等平台横向对比", iconName: "BarChart2", color: "#FF6B35",
    prompt: "请生成多平台对比报表，包含：各平台GMV、订单量、退款率、客单价对比，以及平台占比饼图",
    pinned: false, custom: false, usageCount: 156,
    fields: [
      { name: "平台", type: "文本", example: "天猫" },
      { name: "GMV", type: "数字", example: "285000" },
      { name: "订单量", type: "数字", example: "1820" },
      { name: "退款率", type: "百分比", example: "8.2%" },
      { name: "客单价", type: "数字", example: "156.6" },
    ],
    sampleRows: [
      ["天猫", "285000", "1820", "8.2%", "156.6"],
      ["抖音", "198000", "2340", "12.5%", "84.6"],
      ["拼多多", "142000", "3180", "15.8%", "44.7"],
    ],
    useCases: ["多平台运营对比", "渠道资源分配", "平台退款率分析"],
  },
  {
    id: "t6", title: "品类结构分析", category: "商品", desc: "各品类销售占比、增长趋势、贡献度排名", iconName: "PieChart", color: "#F472B6",
    prompt: "请生成品类结构分析报表，包含：各品类销售额占比、环比增长、贡献度排名、TOP10商品",
    pinned: false, custom: false, usageCount: 92,
    fields: [
      { name: "品类", type: "文本", example: "服装" },
      { name: "销售额", type: "数字", example: "285000" },
      { name: "占比", type: "百分比", example: "38.5%" },
      { name: "环比增长", type: "百分比", example: "+12.3%" },
      { name: "TOP商品", type: "文本", example: "夏季连衣裙" },
    ],
    sampleRows: [
      ["服装", "285000", "38.5%", "+12.3%", "夏季连衣裙"],
      ["配件", "168000", "22.7%", "+5.8%", "皮带"],
      ["鞋履", "142000", "19.2%", "-2.1%", "运动鞋"],
    ],
    useCases: ["品类贡献度分析", "TOP商品运营", "品类结构调整"],
  },
  {
    id: "t7", title: "自定义数据透视", category: "通用", desc: "灵活配置行列维度，生成数据透视表", iconName: "Table2", color: "#5B8CFF",
    prompt: "请根据我的数据生成数据透视表，我会告诉你具体的行、列维度和汇总方式",
    pinned: false, custom: false, usageCount: 45,
    fields: [
      { name: "行维度", type: "自定义", example: "部门" },
      { name: "列维度", type: "自定义", example: "月份" },
      { name: "汇总方式", type: "自定义", example: "求和" },
      { name: "指标", type: "自定义", example: "销售额" },
    ],
    sampleRows: [
      ["销售部", "2026-01", "求和", "128500"],
      ["销售部", "2026-02", "求和", "145200"],
      ["HR部", "2026-01", "求和", "40000"],
    ],
    useCases: ["自定义指标分析", "多维度交叉分析", "灵活报表生成"],
  },
];

const CATEGORIES = ["全部", "HR", "销售", "财务", "库存", "用户", "商品", "通用", "自定义"];

function CreateTemplateModal({ onClose, onSave }: { onClose: () => void; onSave: (t: Template) => void }) {
  const [mode, setMode] = useState<"manual" | "ai">("manual");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState("通用");
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const handleAiGenerate = async () => {
    if (!aiInput.trim()) { toast.error("请描述你的报表需求"); return; }
    setAiLoading(true);
    await new Promise(r => setTimeout(r, 1500));
    setTitle(`${aiInput.slice(0, 10)}报表`);
    setDesc(`基于 AI 生成：${aiInput}`);
    setPrompt(`请生成${aiInput}，要求：数据清晰、分类合理、包含趋势分析和关键指标汇总`);
    setMode("manual");
    setAiLoading(false);
    toast.success("AI 已生成模板内容，可继续编辑");
  };

  const handleSave = () => {
    if (!title.trim() || !prompt.trim()) { toast.error("请填写模板名称和提示词"); return; }
    onSave({ id: nanoid(), title, desc, prompt, category, iconName: "FileSpreadsheet", color: "#5B8CFF", pinned: false, custom: true, usageCount: 0 });
    toast.success("模板已保存");
    onClose();
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg mx-4 rounded-2xl overflow-hidden"
        style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border-2)", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--atlas-border)" }}>
          <div className="flex items-center gap-2">
            <LayoutTemplate size={16} style={{ color: "var(--atlas-accent)" }} />
            <h2 className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>新建模板</h2>
          </div>
          <button onClick={onClose} style={{ color: "var(--atlas-text-3)" }}><X size={15} /></button>
        </div>
        <div className="px-5 pt-4 flex gap-2">
          {[{ id: "manual", label: "手动创建", icon: Pencil }, { id: "ai", label: "AI 生成", icon: Sparkles }].map(tab => (
            <button key={tab.id} onClick={() => setMode(tab.id as any)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: mode === tab.id ? "rgba(91,140,255,0.12)" : "var(--atlas-elevated)", color: mode === tab.id ? "var(--atlas-accent)" : "var(--atlas-text-2)", border: mode === tab.id ? "1px solid rgba(91,140,255,0.2)" : "1px solid var(--atlas-border)" }}>
              <tab.icon size={12} />{tab.label}
            </button>
          ))}
        </div>
        <div className="px-5 py-4 space-y-3">
          {mode === "ai" ? (
            <>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>描述你的报表需求</label>
                <textarea value={aiInput} onChange={e => setAiInput(e.target.value)}
                  placeholder="例如：我需要一个按店铺、按月统计销售额和退款率的对比报表..."
                  rows={4} className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
                  style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border-2)", color: "var(--atlas-text)" }} />
              </div>
              <button onClick={handleAiGenerate} disabled={aiLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium"
                style={{ background: "linear-gradient(135deg, #5B8CFF 0%, #7B5FFF 100%)", color: "#fff", opacity: aiLoading ? 0.7 : 1 }}>
                {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {aiLoading ? "AI 生成中..." : "让 ATLAS 生成模板"}
              </button>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>模板名称</label>
                  <input value={title} onChange={e => setTitle(e.target.value)} placeholder="销售汇总报表"
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border-2)", color: "var(--atlas-text)" }} />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>分类</label>
                  <select value={category} onChange={e => setCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border-2)", color: "var(--atlas-text)" }}>
                    {["销售", "财务", "库存", "用户", "商品", "通用"].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>简介</label>
                <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="简短描述这个模板的用途"
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border-2)", color: "var(--atlas-text)" }} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--atlas-text-2)" }}>AI 提示词</label>
                <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
                  placeholder="告诉 ATLAS 要生成什么样的报表，越详细越好..."
                  rows={3} className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
                  style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border-2)", color: "var(--atlas-text)" }} />
              </div>
              <button onClick={handleSave}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium"
                style={{ background: "var(--atlas-accent)", color: "#fff" }}>
                <Check size={14} />保存模板
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function TemplatesPage() {
  const { setActiveNav, addMessage, clearMessages } = useAtlas();
  const [templates, setTemplates] = useState<Template[]>(BUILTIN_TEMPLATES);
  const [activeCategory, setActiveCategory] = useState("全部");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);

  const filtered = templates.filter(t => {
    const matchCat = activeCategory === "全部" || (activeCategory === "自定义" ? t.custom : t.category === activeCategory);
    const matchSearch = !searchQuery || t.title.includes(searchQuery) || t.desc.includes(searchQuery);
    return matchCat && matchSearch;
  });

  const pinned = filtered.filter(t => t.pinned);
  const rest = filtered.filter(t => !t.pinned);

  const togglePin = (id: string) => setTemplates(prev => prev.map(t => t.id === id ? { ...t, pinned: !t.pinned } : t));
  const deleteTemplate = (id: string) => { setTemplates(prev => prev.filter(t => t.id !== id)); toast.success("模板已删除"); };

  const useTemplate = (t: Template) => {
    clearMessages();
    addMessage({ role: "assistant", content: `已加载模板「${t.title}」\n\n${t.desc}\n\n**提示词已就绪：**\n${t.prompt}\n\n请上传数据文件，我将按此模板生成报表。` });
    setTemplates(prev => prev.map(tp => tp.id === t.id ? { ...tp, usageCount: tp.usageCount + 1 } : tp));
    setActiveNav("home");
    toast.success(`已应用模板「${t.title}」`);
  };

  const TemplateCard = ({ t, index }: { t: Template; index: number }) => {
    const IconComp = ICON_MAP[t.iconName] || FileSpreadsheet;
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}
        className="group rounded-xl p-4 flex flex-col gap-3 transition-all relative"
        style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border-2)"}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)"}>
        {t.pinned && <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full" style={{ background: "var(--atlas-accent)" }} />}
        <div className="flex items-start justify-between">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${t.color}18` }}>
            <IconComp size={16} style={{ color: t.color }} />
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => togglePin(t.id)}
              className="w-6 h-6 rounded flex items-center justify-center"
              style={{ color: t.pinned ? "var(--atlas-accent)" : "var(--atlas-text-3)" }} title={t.pinned ? "取消置顶" : "置顶"}>
              <Pin size={11} />
            </button>
            {t.custom && (
              <button onClick={() => deleteTemplate(t.id)}
                className="w-6 h-6 rounded flex items-center justify-center"
                style={{ color: "var(--atlas-text-3)" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-danger)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
                title="删除">
                <Trash2 size={11} />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>{t.title}</h3>
            {t.custom && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(91,140,255,0.1)", color: "var(--atlas-accent)", fontSize: "10px" }}>自定义</span>}
          </div>
          <p className="text-xs leading-relaxed" style={{ color: "var(--atlas-text-3)" }}>{t.desc}</p>
        </div>
        <div className="flex items-center justify-between pt-1" style={{ borderTop: "1px solid var(--atlas-border)" }}>
          <div className="flex items-center gap-1.5">
            <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--atlas-elevated)", color: "var(--atlas-text-3)", fontSize: "10px" }}>{t.category}</span>
            {t.usageCount > 0 && <span className="text-xs" style={{ color: "var(--atlas-text-3)", fontSize: "10px" }}>{t.usageCount} 次使用</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPreviewTemplate(t)}
              className="flex items-center gap-1 text-xs font-medium"
              style={{ color: "var(--atlas-text-3)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}>
              <Eye size={11} /> 预览
            </button>
            <button onClick={() => useTemplate(t)}
              className="flex items-center gap-1 text-xs font-medium"
              style={{ color: "var(--atlas-accent)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = "0.75"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = "1"}>
              使用 <ChevronRight size={11} />
            </button>
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--atlas-bg)" }}>
      {/* Template Preview Modal */}
      <AnimatePresence>
        {previewTemplate && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
            onClick={e => { if (e.target === e.currentTarget) setPreviewTemplate(null); }}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl mx-4 rounded-2xl overflow-hidden flex flex-col"
              style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border-2)", boxShadow: "0 24px 64px rgba(0,0,0,0.5)", maxHeight: "85vh" }}>
              {/* Header */}
              <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{ borderBottom: "1px solid var(--atlas-border)" }}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${previewTemplate.color}18` }}>
                    {(() => { const IC = ICON_MAP[previewTemplate.iconName] || FileSpreadsheet; return <IC size={15} style={{ color: previewTemplate.color }} />; })()}
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>{previewTemplate.title}</h2>
                    <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{previewTemplate.category} · {previewTemplate.desc}</p>
                  </div>
                </div>
                <button onClick={() => setPreviewTemplate(null)} style={{ color: "var(--atlas-text-3)" }}><X size={15} /></button>
              </div>
              {/* Body */}
              <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
                {/* Fields */}
                {previewTemplate.fields && previewTemplate.fields.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold mb-2.5 flex items-center gap-1.5" style={{ color: "var(--atlas-text-2)" }}>
                      <span className="w-1 h-3 rounded-full inline-block" style={{ background: previewTemplate.color }} />
                      字段结构
                    </h3>
                    <div className="grid grid-cols-3 gap-2">
                      {previewTemplate.fields.map((f, i) => (
                        <div key={i} className="px-3 py-2 rounded-lg" style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}>
                          <div className="text-xs font-medium mb-0.5" style={{ color: "var(--atlas-text)" }}>{f.name}</div>
                          <div className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{f.type} · 例: {f.example}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Sample Data Table */}
                {previewTemplate.sampleRows && previewTemplate.sampleRows.length > 0 && previewTemplate.fields && (
                  <div>
                    <h3 className="text-xs font-semibold mb-2.5 flex items-center gap-1.5" style={{ color: "var(--atlas-text-2)" }}>
                      <span className="w-1 h-3 rounded-full inline-block" style={{ background: previewTemplate.color }} />
                      示例数据
                    </h3>
                    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--atlas-border)" }}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr style={{ background: "var(--atlas-elevated)" }}>
                            {previewTemplate.fields.map((f, i) => (
                              <th key={i} className="px-3 py-2 text-left font-medium" style={{ color: "var(--atlas-text-2)", borderBottom: "1px solid var(--atlas-border)" }}>{f.name}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewTemplate.sampleRows.map((row, ri) => (
                            <tr key={ri} style={{ borderBottom: ri < previewTemplate.sampleRows!.length - 1 ? "1px solid var(--atlas-border)" : "none" }}>
                              {row.map((cell, ci) => (
                                <td key={ci} className="px-3 py-2" style={{ color: "var(--atlas-text)" }}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {/* Use Cases */}
                {previewTemplate.useCases && previewTemplate.useCases.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold mb-2.5 flex items-center gap-1.5" style={{ color: "var(--atlas-text-2)" }}>
                      <span className="w-1 h-3 rounded-full inline-block" style={{ background: previewTemplate.color }} />
                      适用场景
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {previewTemplate.useCases.map((uc, i) => (
                        <span key={i} className="text-xs px-2.5 py-1 rounded-full" style={{ background: `${previewTemplate.color}15`, color: previewTemplate.color, border: `1px solid ${previewTemplate.color}30` }}>{uc}</span>
                      ))}
                    </div>
                  </div>
                )}
                {/* Prompt Preview */}
                <div>
                  <h3 className="text-xs font-semibold mb-2.5 flex items-center gap-1.5" style={{ color: "var(--atlas-text-2)" }}>
                    <span className="w-1 h-3 rounded-full inline-block" style={{ background: previewTemplate.color }} />
                    AI 提示词
                  </h3>
                  <div className="px-3 py-2.5 rounded-lg text-xs leading-relaxed" style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text-2)" }}>
                    {previewTemplate.prompt}
                  </div>
                </div>
              </div>
              {/* Footer */}
              <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{ borderTop: "1px solid var(--atlas-border)" }}>
                <button onClick={() => setPreviewTemplate(null)}
                  className="px-4 py-2 rounded-lg text-sm"
                  style={{ color: "var(--atlas-text-3)", background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)" }}>
                  关闭
                </button>
                <button onClick={() => { useTemplate(previewTemplate); setPreviewTemplate(null); }}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium"
                  style={{ background: "var(--atlas-accent)", color: "#fff" }}>
                  <Check size={13} /> 使用此模板
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="max-w-6xl mx-auto px-6 py-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold" style={{ color: "var(--atlas-text)" }}>模板库</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--atlas-text-3)" }}>选择模板快速生成报表，或创建你自己的专属模板</p>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "var(--atlas-accent)", color: "#fff" }}>
            <Plus size={14} />新建模板
          </button>
        </div>

        <div className="flex items-center gap-3 mb-5">
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--atlas-text-3)" }} />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜索模板..."
              className="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text)" }} />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {CATEGORIES.map(cat => (
              <button key={cat} onClick={() => setActiveCategory(cat)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{ background: activeCategory === cat ? "rgba(91,140,255,0.12)" : "var(--atlas-surface)", color: activeCategory === cat ? "var(--atlas-accent)" : "var(--atlas-text-3)", border: activeCategory === cat ? "1px solid rgba(91,140,255,0.2)" : "1px solid var(--atlas-border)" }}>
                {cat}
              </button>
            ))}
          </div>
        </div>

        {pinned.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Pin size={12} style={{ color: "var(--atlas-accent)" }} />
              <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--atlas-text-3)", fontSize: "10px", letterSpacing: "0.08em" }}>已置顶</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {pinned.map((t, i) => <TemplateCard key={t.id} t={t} index={i} />)}
            </div>
          </div>
        )}

        {rest.length > 0 && (
          <div>
            {pinned.length > 0 && (
              <div className="flex items-center gap-2 mb-3">
                <LayoutTemplate size={12} style={{ color: "var(--atlas-text-3)" }} />
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--atlas-text-3)", fontSize: "10px", letterSpacing: "0.08em" }}>全部模板</span>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              {rest.map((t, i) => <TemplateCard key={t.id} t={t} index={i} />)}
            </div>
          </div>
        )}

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <LayoutTemplate size={32} className="mb-3" style={{ color: "var(--atlas-text-3)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--atlas-text-2)" }}>没有找到匹配的模板</p>
            <p className="text-xs mt-1" style={{ color: "var(--atlas-text-3)" }}>试试创建一个新模板</p>
            <button onClick={() => setShowCreate(true)}
              className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: "var(--atlas-accent)", color: "#fff" }}>
              <Plus size={14} />新建模板
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showCreate && (
          <CreateTemplateModal onClose={() => setShowCreate(false)} onSave={t => setTemplates(prev => [t, ...prev])} />
        )}
      </AnimatePresence>
    </div>
  );
}
