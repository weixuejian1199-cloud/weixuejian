/**
 * ATLAS V3.0 — App Root
 * Layout: Left Sidebar (240px) + Center Panel + Right Chat Panel
 * Style: Dark / Minimal / Structured / Calm
 */

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AtlasProvider, useAtlas } from "./contexts/AtlasContext";
import ErrorBoundary from "./components/ErrorBoundary";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import MainWorkspace from "./pages/MainWorkspace";
import ReportsPage from "./pages/ReportsPage";
import TemplatesPage from "./pages/TemplatesPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";

function AppContent() {
  const { activeNav } = useAtlas();

  const renderPage = () => {
    switch (activeNav) {
      case "reports":   return <ReportsPage />;
      case "templates": return <TemplatesPage />;
      case "history":   return <HistoryPage />;
      case "settings":  return <SettingsPage />;
      default:          return <MainWorkspace />;
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--atlas-bg)" }}>
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <AtlasProvider>
          <TooltipProvider>
            <Toaster
              theme="dark"
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
      </ThemeProvider>
    </ErrorBoundary>
  );
}
