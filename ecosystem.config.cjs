module.exports = {
  apps: [{
    name: "jetstar-hub",
    script: "/opt/jetstar-hub/artifacts/api-server/dist/index.mjs",
    interpreter: "node",
    interpreter_args: "--enable-source-maps",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "512M",
    env: {
      NODE_ENV: "production",
      PORT: "3000",
      // Fill these in:
      DATABASE_URL: "postgresql://jetstar:CHANGE_PASSWORD@localhost:5432/jetstar_hub",
      SESSION_SECRET: "REPLACE_WITH: openssl rand -hex 64",
      CORS_ORIGIN: "http://YOUR_VPS_IP_OR_DOMAIN",
    },
  }],
};
