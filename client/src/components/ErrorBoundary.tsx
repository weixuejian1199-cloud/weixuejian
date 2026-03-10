import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Log to console for debugging on mobile
    console.error("[ErrorBoundary] Caught error:", error.message);
    console.error("[ErrorBoundary] Stack:", error.stack);
    console.error("[ErrorBoundary] Component stack:", info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background text-foreground">
          <div className="flex flex-col items-center w-full max-w-md p-6">
            <AlertTriangle
              size={40}
              className="text-destructive mb-4 flex-shrink-0"
            />

            <h2 className="text-lg font-semibold mb-2">页面加载出错</h2>
            <p className="text-muted-foreground text-sm mb-4 text-center">
              请尝试刷新页面，若问题持续请联系客服
            </p>

            <div className="p-3 w-full rounded bg-muted overflow-auto mb-5 max-h-32">
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all">
                {this.state.error?.message || "Unknown error"}
              </pre>
            </div>

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 active:opacity-80 cursor-pointer"
              )}
            >
              <RotateCcw size={15} />
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
