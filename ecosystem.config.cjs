module.exports = {
  apps: [
    {
      name: "infinite-web",
      script: "node_modules/.bin/next",
      args: "start -H 0.0.0.0",
      cwd: "/home/rey/project/infinite",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      watch: false,
      max_memory_restart: "512M",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "infinite-ws",
      script: "server/index.ts",
      interpreter: "node_modules/.bin/tsx",
      cwd: "/home/rey/project/infinite",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
      watch: false,
      max_memory_restart: "256M",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};