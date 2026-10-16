// PM2 process manager config
// Start:   pm2 start deploy/ecosystem.config.cjs
// Restart: pm2 restart vjetstar-api
// Logs:    pm2 logs vjetstar-api
// Status:  pm2 status

module.exports = {
  apps: [
    {
      name: "vjetstar-api",
      script: "./artifacts/api-server/dist/index.mjs",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      // Load .env from repo root
      env_file: ".env",
      env: {
        NODE_ENV: "production",
      },
      // Restart if memory > 400MB (safe for 1GB VPS shared with another app)
      max_memory_restart: "400M",
      // Restart on crash with backoff
      restart_delay: 3000,
      max_restarts: 10,
      // Logs
      error_file: "/var/log/vjetstar/error.log",
      out_file: "/var/log/vjetstar/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};
