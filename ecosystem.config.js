// PM2 process definition for the customer's Windows server.
// Start with: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "adl-server",
      script: "server.js",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      max_memory_restart: "1G",
      watch: false,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
