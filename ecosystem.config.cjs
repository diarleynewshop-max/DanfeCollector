const NODE_BIN = '/home/danfe/.nvm/versions/node/v22.23.1/bin';

module.exports = {
  apps: [
    {
      name: 'danfecollector',
      cwd: '/home/danfe/htdocs/danfe.newgrup.cloud',
      script: './node_modules/next/dist/bin/next',
      args: 'start -p 3100',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '900M',
      min_uptime: '20s',
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: '3100',
        PATH: `${NODE_BIN}:/usr/local/bin:/usr/bin:/bin`,
      },
    },
    {
      name: 'danfecollector-sync-nf',
      cwd: '/home/danfe/htdocs/danfe.newgrup.cloud',
      script: './scripts/cron-sync-nf.js',
      interpreter: `${NODE_BIN}/node`,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      min_uptime: '10s',
      restart_delay: 30000,
      exp_backoff_restart_delay: 1000,
      env: {
        NODE_ENV: 'production',
        PORT: '3100',
        PATH: `${NODE_BIN}:/usr/local/bin:/usr/bin:/bin`,
      },
    },
  ],
};
