/**
 * ATLAS V15.0 — App Root
 * Six-module architecture: chat / files / ai-tools / automation / knowledge / settings
 * Layout: AtlasNavigation (20%) | Module Content (80%)
 *
 * Guest mode: LoginModal is only rendered when showLoginModal === true.
 * No forced login — users can use all basic features without signing in.
 */
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AtlasProvider, useAtlas } from "./contexts/AtlasContext";
import { trpc } from "@/lib/trpc";
import ErrorBoundary from "./components/ErrorBoundary";
import AtlasNavigation from "./components/AtlasNavigation";
import LoginModal from "./components/LoginModal";

// Module pages
import ChatWorkspace from "./pages/ChatWorkspace";
import FilesModule from "./pages/FilesModule";
import AIToolsModule from "./pages/AIToolsModule";
import AutomationModule from "./pages/AutomationModule";
import KnowledgeModule from "./pages/KnowledgeModule";
import SettingsModule from "./pages/SettingsModule";

function AppContent() {
  const { activeModule, setUser, showLoginModal } = useAtlas();

  // Sync server auth state into AtlasContext (silently — no redirect on failure)
  const { data: meData } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!meData) { setUser(null); return; }
    setUser({
      id: String(meData.id),
      name: meData.name ?? meData.username ?? "未命名用户",
      email: meData.email ?? "",
      avatar: undefined,
      plan: (meData.plan as "free" | "pro" | "enterprise") ?? "free",
      role: (meData.role as "user" | "admin") ?? "user",
    });
  }, [meData, setUser]);

  const renderModule = () => {
    switch (activeModule) {
      case "chat":       return <ChatWorkspace />;
      case "files":      return <FilesModule />;
      case "ai-tools":   return <AIToolsModule />;
      case "automation": return <AutomationModule />;
      case "knowledge":  return <KnowledgeModule />;
      case "settings":   return <SettingsModule />;
      default:           return <ChatWorkspace />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* Left Navigation — 20% */}
      <AtlasNavigation />

      {/* Module Content — 80% */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {renderModule()}
      </div>

      {/* Login modal — only shown when explicitly triggered, never forced on load */}
      {showLoginModal && <LoginModal />}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AtlasProvider>
        <TooltipProvider>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "#fff",
                border: "1px solid #e5e7eb",
                color: "#111827",
                fontSize: "13px",
              },
            }}
          />
          <AppContent />
        </TooltipProvider>
      </AtlasProvider>
    </ErrorBoundary>
  );
}
