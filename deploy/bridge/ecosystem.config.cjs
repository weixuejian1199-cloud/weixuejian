/**
 * PM2 配置 — Bridge 进程守护（tmux 的备选方案）
 *
 * 用法:
 *   pm2 start deploy/bridge/ecosystem.config.cjs
 *   pm2 logs bridge
 *   pm2 restart bridge
 */
module.exports = {
  apps: [
    {
      name: 'bridge',
      script: 'packages/bridge/index.mjs',
      cwd: process.env.PROJECT_ROOT || '/app',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PROJECT_DIR: process.env.PROJECT_DIR || '/app',
      },
      error_file: 'logs/bridge-error.log',
      out_file: 'logs/bridge-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
