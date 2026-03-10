/**
 * ATLAS V16.6 — App Root
 * Layout: TopBar (48px) | AtlasNavigation (220px, collapsible) | Module Content (flex-1)
 * Light blue-gray theme, glassmorphism style
 * Guest mode: no forced login
 */
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AtlasProvider, useAtlas } from "./contexts/AtlasContext";
import { trpc } from "@/lib/trpc";
import ErrorBoundary from "./components/ErrorBoundary";
import AtlasNavigation from "./components/AtlasNavigation";
import TopBar from "./components/TopBar";
import LoginModal from "./components/LoginModal";

// Module pages
import ChatWorkspace from "./pages/ChatWorkspace";
import FilesModule from "./pages/FilesModule";
import AIToolsModule from "./pages/AIToolsModule";
import AutomationModule from "./pages/AutomationModule";
import KnowledgeModule from "./pages/KnowledgeModule";
import SettingsModule from "./pages/SettingsModule";
import InvitePage from "./pages/InvitePage";

function AppContent() {
  const { activeModule, setUser, showLoginModal, setShowLoginModal } = useAtlas();
  const [navCollapsed, setNavCollapsed] = useState(false);

  const { data: meData, refetch: refetchMe } = trpc.auth.me.useQuery(undefined, {
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

  // Listen for unauthorized events (stale/expired cookie) and show login modal.
  // This handles the case where the user has an old browser session with an
  // expired JWT — requests silently fail without this handler.
  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setShowLoginModal(true);
      // Refresh auth state so UI reflects the logged-out state
      refetchMe();
    };
    window.addEventListener("atlas:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("atlas:unauthorized", handleUnauthorized);
  }, [setUser, setShowLoginModal, refetchMe]);

  const renderModule = () => {
    switch (activeModule) {
      case "chat":       return <ChatWorkspace />;
      case "files":      return <FilesModule />;
      case "ai-tools":   return <AIToolsModule />;
      case "automation": return <AutomationModule />;
      case "knowledge":  return <KnowledgeModule />;
      case "settings":   return <SettingsModule />;
      case "invite":     return <InvitePage />;
      default:           return <ChatWorkspace />;
    }
  };

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ background: "var(--atlas-bg)" }}
    >
      {/* Top Bar — 48px, with sidebar toggle + user avatar */}
      <TopBar
        navCollapsed={navCollapsed}
        onToggleNav={() => setNavCollapsed(v => !v)}
      />

      {/* Main area: Nav + Content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Navigation — collapsible */}
        {!navCollapsed && <AtlasNavigation onCollapse={() => setNavCollapsed(true)} />}

        {/* Module Content — flex-1 */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {renderModule()}
        </div>
      </div>

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
                background: "rgba(255,255,255,0.9)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(74,144,226,0.2)",
                color: "#1A2332",
                fontSize: "13px",
                borderRadius: "10px",
              },
            }}
          />
          <AppContent />
        </TooltipProvider>
      </AtlasProvider>
    </ErrorBoundary>
  );
}
