module.exports = {
  apps: [
    {
      name: 'omnysync-erp',
      script: 'node',
      args: 'apps/api/dist/index.js',
      cwd: __dirname,
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        OMNYSYNC_DEMO_SEED: 'true',
        OMNYSYNC_DEMO_MODE: 'false',
        KEEP_ALIVE_ENABLED: 'false',
      },
    },
  ],
};
