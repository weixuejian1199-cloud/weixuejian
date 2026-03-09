/**
 * ATLAS V8.0 — App Root
 * Layout: AtlasWorkspace (three-column) for home, legacy layout for other pages
 */
import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AtlasProvider, useAtlas } from "./contexts/AtlasContext";
import { trpc } from "@/lib/trpc";
import ErrorBoundary from "./components/ErrorBoundary";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import LoginModal from "./components/LoginModal";
import AtlasWorkspace from "./pages/AtlasWorkspace";
import DashboardPage from "./pages/DashboardPage";
import TemplatesPage from "./pages/TemplatesPage";
import SettingsPage from "./pages/SettingsPage";
import SearchPage from "./pages/SearchPage";
import LibraryPage from "./pages/LibraryPage";
import InvitePage from "./pages/InvitePage";
import HRCenterPage from "./pages/HRCenterPage";
import IMPage from "./pages/IMPage";
import OpenClawMonitor from "./pages/OpenClawMonitor";

function AppContent() {
  const { activeNav, theme, showLoginModal, setUser } = useAtlas();

  // Sync server auth state into AtlasContext
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

  // Home uses the new three-column AtlasWorkspace (no TopBar/Sidebar wrapper)
  if (activeNav === "home") {
    return (
      <div className={`flex h-screen overflow-hidden ${theme}`} style={{ background: "#fff" }}>
        <AtlasWorkspace />
        {showLoginModal && <LoginModal />}
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
      </div>
    );
  }

  // Other pages use the legacy Sidebar + TopBar layout
  const renderPage = () => {
    switch (activeNav) {
      case "dashboard":  return <DashboardPage />;
      case "templates":  return <TemplatesPage />;
      case "settings":   return <SettingsPage />;
      case "search":     return <SearchPage />;
      case "library":    return <LibraryPage />;
      case "invite":     return <InvitePage />;
      case "hr":         return <HRCenterPage />;
      case "im":         return <IMPage />;
      case "openclaw-monitor": return <OpenClawMonitor />;
      default:           return <AtlasWorkspace />;
    }
  };

  return (
    <div
      className={`flex flex-col h-screen overflow-hidden ${theme}`}
      style={{ background: "var(--atlas-bg)" }}
    >
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeNav}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="h-full"
            >
              {renderPage()}
            </motion.div>
          </AnimatePresence>
        </main>
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
                background: "var(--atlas-elevated)",
                border: "1px solid var(--atlas-border)",
                color: "var(--atlas-text)",
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
