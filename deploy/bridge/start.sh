#!/bin/bash
# ============================================================
# Bridge tmux 会话管理脚本
# 用法: ./deploy/bridge/start.sh [start|stop|restart|status|logs]
# ============================================================

set -e

SESSION_NAME="bridge"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BRIDGE_DIR="$PROJECT_ROOT/packages/bridge"

# 加载环境变量
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

# 确保 PROJECT_DIR 已设置
export PROJECT_DIR="${PROJECT_DIR:-$PROJECT_ROOT}"

case "${1:-start}" in
  start)
    if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
      echo "Bridge already running in tmux session '$SESSION_NAME'"
      echo "Use: $0 restart"
      exit 1
    fi

    echo "Starting Bridge in tmux session '$SESSION_NAME'..."
    tmux new-session -d -s "$SESSION_NAME" -c "$BRIDGE_DIR" \
      "node index.mjs 2>&1 | tee -a $PROJECT_ROOT/logs/bridge.log"

    sleep 1
    if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
      echo "Bridge started successfully."
      echo "  Attach: tmux attach -t $SESSION_NAME"
      echo "  Logs:   $0 logs"
      echo "  Stop:   $0 stop"
    else
      echo "Bridge failed to start. Check logs."
      exit 1
    fi
    ;;

  stop)
    if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
      echo "Stopping Bridge..."
      tmux send-keys -t "$SESSION_NAME" C-c
      sleep 2
      tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
      echo "Bridge stopped."
    else
      echo "Bridge is not running."
    fi
    ;;

  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;

  status)
    if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
      echo "Bridge is RUNNING in tmux session '$SESSION_NAME'"
      tmux capture-pane -t "$SESSION_NAME" -p | tail -5
    else
      echo "Bridge is NOT running."
    fi
    ;;

  logs)
    if [ -f "$PROJECT_ROOT/logs/bridge.log" ]; then
      tail -50 "$PROJECT_ROOT/logs/bridge.log"
    else
      echo "No log file found."
      if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
        echo "Showing tmux pane output:"
        tmux capture-pane -t "$SESSION_NAME" -p | tail -20
      fi
    fi
    ;;

  *)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
