/**
 * ATLAS V5.0 — App Root
 * Layout: Sidebar (collapsible) + Main Content
 * Theme: Dark (cold black) / Light (Manus white) switchable
 * Nav: home / dashboard / templates / search / library / settings
 */
import { AnimatePresence, motion } from "framer-motion";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AtlasProvider, useAtlas } from "./contexts/AtlasContext";
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

function AppContent() {
  const { activeNav, theme, showLoginModal } = useAtlas();
  const renderPage = () => {
    switch (activeNav) {
      case "dashboard":  return <DashboardPage />;
      case "templates":  return <TemplatesPage />;
      case "settings":   return <SettingsPage />;
      case "search":     return <SearchPage />;
      case "library":    return <LibraryPage />;
      case "invite":     return <InvitePage />;
      case "home":
      default:           return <MainWorkspace />;
    }
  };

  // make sure to consider if you need authentication for certain routes
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
