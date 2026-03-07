/**
 * ATLAS V3.0 — Settings Page
 */
import { useState } from "react";
import { Settings, Key, Server, Save, Eye, EyeOff } from "lucide-react";
import { useAtlas } from "@/contexts/AtlasContext";
import { api } from "@/lib/api";
import { toast } from "sonner";

export default function SettingsPage() {
  const { apiKey, setApiKey, backendUrl, setBackendUrl } = useAtlas();
  const [localKey, setLocalKey] = useState(apiKey);
  const [localUrl, setLocalUrl] = useState(backendUrl);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState<boolean | null>(null);

  const handleSave = () => {
    setApiKey(localKey);
    setBackendUrl(localUrl);
    api.setBaseUrl(localUrl);
    toast.success("设置已保存");
  };

  const handleTest = async () => {
    setTesting(true); setTestOk(null);
    api.setBaseUrl(localUrl);
    try {
      await api.health();
      setTestOk(true); toast.success("后端连接正常");
    } catch {
      setTestOk(false); toast.error("无法连接后端，请检查地址");
    } finally { setTesting(false); }
  };

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: "var(--atlas-bg)" }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
            <Settings size={18} style={{ color: "var(--atlas-text-2)" }} />
          </div>
          <div>
            <h1 className="text-lg font-semibold" style={{ color: "var(--atlas-text)" }}>设置</h1>
            <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>配置 API 和后端连接</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="p-5 rounded-xl" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Server size={14} style={{ color: "var(--atlas-accent)" }} />
              <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>后端服务地址</span>
            </div>
            <div className="flex gap-2">
              <input value={localUrl} onChange={e => setLocalUrl(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text)", fontFamily: "'JetBrains Mono', monospace" }}
                placeholder="http://localhost:8000" />
              <button onClick={handleTest} disabled={testing}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)",
                  color: testOk === true ? "var(--atlas-success)" : testOk === false ? "var(--atlas-danger)" : "var(--atlas-text-2)" }}>
                {testing ? "测试中..." : testOk === true ? "✓ 已连接" : testOk === false ? "✗ 失败" : "测试连接"}
              </button>
            </div>
            <p className="text-xs mt-2" style={{ color: "var(--atlas-text-3)" }}>FastAPI 后端地址，默认 http://localhost:8000</p>
          </div>

          <div className="p-5 rounded-xl" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Key size={14} style={{ color: "#A78BFA" }} />
              <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>GLM-4 API Key</span>
            </div>
            <div className="relative">
              <input value={localKey} onChange={e => setLocalKey(e.target.value)}
                type={showKey ? "text" : "password"}
                className="w-full px-3 py-2 pr-10 rounded-lg text-sm outline-none"
                style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text)", fontFamily: "'JetBrains Mono', monospace" }}
                placeholder="输入 GLM-4 API Key..." />
              <button onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: "var(--atlas-text-3)" }}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-xs mt-2" style={{ color: "var(--atlas-text-3)" }}>
              前往 <a href="https://open.bigmodel.cn" target="_blank" rel="noopener noreferrer"
                style={{ color: "var(--atlas-accent)" }}>open.bigmodel.cn</a> 获取 API Key
            </p>
          </div>

          <button onClick={handleSave}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{ background: "var(--atlas-accent)", color: "#fff" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = "0.9"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = "1"}>
            <Save size={14} /> 保存设置
          </button>
        </div>

        <div className="mt-8 p-5 rounded-xl" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
          <p className="text-xs font-medium mb-3" style={{ color: "var(--atlas-text-2)" }}>关于 ATLAS</p>
          <div className="space-y-1.5">
            {([
              ["版本", "v3.0.0"],
              ["技术栈", "React + FastAPI + Pandas + GLM-4"],
              ["支持格式", "Excel (.xlsx/.xls) · CSV"],
              ["最大文件", "50 MB"],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{k}</span>
                <span className="text-xs" style={{ color: "var(--atlas-text-2)", fontFamily: "'JetBrains Mono', monospace" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
