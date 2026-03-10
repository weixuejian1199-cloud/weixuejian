/**
 * ATLAS V15.0 — AI Automation Module
 * Scheduled tasks, monitoring alerts, event triggers
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Clock, Bell, Zap, Play, Pause, Trash2, ChevronRight, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";

type TaskType = "scheduled" | "monitor" | "event";
type TaskStatus = "running" | "paused" | "failed";

interface AutoTask {
  id: string;
  name: string;
  type: TaskType;
  schedule?: string;
  condition?: string;
  trigger?: string;
  status: TaskStatus;
  nextRun?: string;
  lastRun?: string;
}

const MOCK_TASKS: AutoTask[] = [
  { id: "1", name: "每日销售报表", type: "scheduled", schedule: "每天 09:00", status: "running", nextRun: "明天 09:00", lastRun: "今天 09:00" },
  { id: "2", name: "每周运营汇总", type: "scheduled", schedule: "每周一 09:00", status: "running", nextRun: "03-16 周一", lastRun: "03-09 周一" },
  { id: "3", name: "月度对账", type: "scheduled", schedule: "每月 1号", status: "paused", nextRun: "04-01", lastRun: "03-01" },
  { id: "4", name: "库存低于100预警", type: "monitor", condition: "库存 < 100", status: "running" },
  { id: "5", name: "订单异常告警", type: "monitor", condition: "退款率 > 5%", status: "running" },
  { id: "6", name: "新文件上传分析", type: "event", trigger: "文件上传", status: "running" },
];

const EXECUTION_HISTORY = [
  { date: "03-10 09:00", name: "每日销售报表", status: "success" as const },
  { date: "03-09 09:00", name: "每日销售报表", status: "success" as const },
  { date: "03-09 09:00", name: "每周运营汇总", status: "success" as const },
  { date: "03-08 09:00", name: "每日销售报表", status: "failed" as const, error: "文件未上传" },
  { date: "03-07 09:00", name: "每日销售报表", status: "success" as const },
];

const TYPE_CONFIG: Record<TaskType, { icon: React.ReactNode; label: string; color: string }> = {
  scheduled: { icon: <Clock size={13} />, label: "定时任务", color: "#2563eb" },
  monitor: { icon: <Bell size={13} />, label: "监控告警", color: "#f59e0b" },
  event: { icon: <Zap size={13} />, label: "事件触发", color: "#10b981" },
};

export default function AutomationModule() {
  const [selectedTask, setSelectedTask] = useState<AutoTask | null>(MOCK_TASKS[0]);
  const [tasks, setTasks] = useState(MOCK_TASKS);

  const toggleTask = (id: string) => {
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, status: t.status === "running" ? "paused" : "running" } : t
    ));
  };

  const grouped = {
    scheduled: tasks.filter(t => t.type === "scheduled"),
    monitor: tasks.filter(t => t.type === "monitor"),
    event: tasks.filter(t => t.type === "event"),
  };

  return (
    <div className="flex h-full overflow-hidden" style={{ background: "#fff" }}>
      {/* Center: Task List */}
      <div
        className="flex flex-col overflow-hidden"
        style={{ width: "20%", minWidth: "200px", borderRight: "1px solid var(--atlas-border)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--atlas-border)", height: 48 }}
        >
          <div className="flex items-center gap-2">
            <Zap size={14} style={{ color: "#2563eb" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>AI 自动化</span>
          </div>
          <button
            onClick={() => toast.info("创建自动化任务功能即将上线")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ background: "rgba(37,99,235,0.08)", color: "#2563eb", border: "1px solid rgba(37,99,235,0.2)" }}
          >
            <Plus size={12} />
            创建任务
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {(["scheduled", "monitor", "event"] as TaskType[]).map(type => {
            const group = grouped[type];
            if (group.length === 0) return null;
            const cfg = TYPE_CONFIG[type];
            return (
              <div key={type}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span style={{ color: cfg.color }}>{cfg.icon}</span>
                  <span className="text-xs font-semibold" style={{ color: "var(--atlas-text-2)" }}>
                    {cfg.label} ({group.length})
                  </span>
                </div>
                <div className="space-y-1.5">
                  {group.map(task => (
                    <motion.button
                      key={task.id}
                      whileHover={{ scale: 1.005 }}
                      onClick={() => setSelectedTask(task)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
                      style={{
                        background: selectedTask?.id === task.id ? "rgba(37,99,235,0.06)" : "var(--atlas-surface)",
                        border: `1px solid ${selectedTask?.id === task.id ? "rgba(37,99,235,0.25)" : "var(--atlas-border)"}`,
                      }}
                    >
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: task.status === "running" ? "#10b981" : task.status === "paused" ? "#94a3b8" : "#ef4444" }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>{task.name}</div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--atlas-text-3)" }}>
                          {task.schedule || task.condition || task.trigger}
                          {task.status === "paused" && " · 已暂停"}
                        </div>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); toggleTask(task.id); }}
                        className="p-1 rounded-md transition-colors flex-shrink-0"
                        style={{ color: task.status === "running" ? "#10b981" : "var(--atlas-text-3)" }}
                      >
                        {task.status === "running" ? <Pause size={12} /> : <Play size={12} />}
                      </button>
                    </motion.button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Task Detail */}
      <div className="flex flex-col overflow-hidden" style={{ width: "80%", background: "var(--atlas-surface)" }}>
        {selectedTask ? (
          <TaskDetail
            task={selectedTask}
            history={EXECUTION_HISTORY.filter(h => h.name === selectedTask.name)}
            onToggle={() => toggleTask(selectedTask.id)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <Clock size={28} style={{ color: "rgba(37,99,235,0.25)" }} />
            <p className="text-sm" style={{ color: "var(--atlas-text-3)" }}>选择左侧任务查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskDetail({ task, history, onToggle }: {
  task: AutoTask;
  history: typeof EXECUTION_HISTORY;
  onToggle: () => void;
}) {
  const cfg = TYPE_CONFIG[task.type];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--atlas-border)", height: 48, background: "#fff" }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: cfg.color }}>{cfg.icon}</span>
          <span className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>{task.name}</span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full"
            style={{
              background: task.status === "running" ? "rgba(16,185,129,0.1)" : "rgba(148,163,184,0.15)",
              color: task.status === "running" ? "#10b981" : "#94a3b8",
            }}
          >
            {task.status === "running" ? "运行中" : task.status === "paused" ? "已暂停" : "失败"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggle}
            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg transition-all"
            style={{
              background: task.status === "running" ? "rgba(148,163,184,0.1)" : "rgba(16,185,129,0.1)",
              color: task.status === "running" ? "#64748b" : "#10b981",
              border: `1px solid ${task.status === "running" ? "rgba(148,163,184,0.2)" : "rgba(16,185,129,0.2)"}`,
            }}
          >
            {task.status === "running" ? <><Pause size={10} /> 暂停</> : <><Play size={10} /> 启动</>}
          </button>
          <button
            onClick={() => toast.info("立即执行中...")}
            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg transition-all"
            style={{ background: "rgba(37,99,235,0.08)", color: "#2563eb", border: "1px solid rgba(37,99,235,0.2)" }}
          >
            <Play size={10} /> 立即执行
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Task info */}
        <div className="rounded-xl p-4 space-y-2.5" style={{ background: "#fff", border: "1px solid var(--atlas-border)" }}>
          {task.schedule && (
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>执行频率</span>
              <span className="text-xs font-medium" style={{ color: "var(--atlas-text)" }}>{task.schedule}</span>
            </div>
          )}
          {task.nextRun && (
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>下次执行</span>
              <span className="text-xs font-medium" style={{ color: "#2563eb" }}>{task.nextRun}</span>
            </div>
          )}
          {task.lastRun && (
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>上次执行</span>
              <span className="text-xs font-medium" style={{ color: "var(--atlas-text-2)" }}>{task.lastRun}</span>
            </div>
          )}
          {task.condition && (
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>触发条件</span>
              <span className="text-xs font-medium" style={{ color: "var(--atlas-text)" }}>{task.condition}</span>
            </div>
          )}
        </div>

        {/* Execution history */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: "var(--atlas-text-3)" }}>
            执行记录
          </div>
          <div className="space-y-1.5">
            {history.length === 0 ? (
              <p className="text-xs text-center py-4" style={{ color: "var(--atlas-text-4)" }}>暂无执行记录</p>
            ) : (
              history.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg"
                  style={{ background: "#fff", border: "1px solid var(--atlas-border)" }}
                >
                  {item.status === "success"
                    ? <CheckCircle2 size={13} style={{ color: "#10b981", flexShrink: 0 }} />
                    : <XCircle size={13} style={{ color: "#ef4444", flexShrink: 0 }} />
                  }
                  <span className="text-xs font-mono flex-shrink-0" style={{ color: "var(--atlas-text-3)" }}>{item.date}</span>
                  <span className="text-xs flex-1" style={{ color: item.status === "success" ? "var(--atlas-text-2)" : "#ef4444" }}>
                    {item.status === "success" ? "执行成功" : item.error || "执行失败"}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Delete */}
        <button
          onClick={() => toast.error("删除任务功能即将上线")}
          className="flex items-center gap-1.5 text-xs transition-colors"
          style={{ color: "var(--atlas-text-4)" }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#ef4444"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-4)"}
        >
          <Trash2 size={11} />
          删除任务
        </button>
      </div>
    </div>
  );
}
