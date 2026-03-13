/**
 * ATLAS V14.9 — App Root
 * Layout: Sidebar (collapsible) + Main Content
 * Theme: Dark (cold black) / Light (Manus white) switchable
 * Nav: home(对话) / dashboard / templates / search / library / settings / hr / invite
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
import MainWorkspace from "./pages/MainWorkspace";
import DashboardPage from "./pages/DashboardPage";
import TemplatesPage from "./pages/TemplatesPage";
import SettingsPage from "./pages/SettingsPage";
import SearchPage from "./pages/SearchPage";
import LibraryPage from "./pages/LibraryPage";
import InvitePage from "./pages/InvitePage";
import HRCenterPage from "./pages/HRCenterPage";

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

  const renderPage = () => {
    switch (activeNav) {
      case "dashboard":  return <DashboardPage />;
      case "templates":  return <TemplatesPage />;
      case "settings":   return <SettingsPage />;
      case "search":     return <SearchPage />;
      case "library":    return <LibraryPage />;
      case "invite":     return <InvitePage />;
      case "hr":         return <HRCenterPage />;
      case "home":
      default:           return <MainWorkspace />;
    }
  };

  // make sure to consider if you need authentication for certain routes
  return (
    <div
      className={`flex flex-col h-screen overflow-hidden ${theme}`}
      style={{ background: "#f0f4f9" }}
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
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                color: "#1f2937",
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
