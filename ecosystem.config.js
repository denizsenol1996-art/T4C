module.exports = {
  apps: [{
    name: "t4c-server",
    script: "./backend/server.js",
    cwd: "/opt/t4c",
    exec_mode: "fork",
    instances: 1,

    // RSPP/engine-blacklist Gate 5 — SHADOW aan (rekent+logt naar data/bench/engine-shadow.jsonl,
    // past het bod NIET aan). Echte flag blijft UIT. Verwijderen na 24u shadow-evaluatie.
    env: {
      T4C_ENGINE_BLACKLIST_SHADOW: "1"
    },

    // Graceful-shutdown ruimte: sql.js export + writeSync van 179MB DB kan 3-5s duren.
    // Default 1600ms was te kort → zombies bij elke restart.
    kill_timeout: 10000,

    // Restart-storm beperken: minder dan 10s uptime + 8 keer = stop. Voorkomt CPU-loops.
    min_uptime: "10s",
    max_restarts: 8,
    restart_delay: 3000,

    // OOM-vangnet: bij heap-leak (zoals atx-admin restart-loop 06-10) → graceful kill
    // i.p.v. wachten op kernel-OOM-killer (die slaat alles plat). 1.5GB = ruim genoeg
    // voor 179MB sql.js DB + heap + cache, maar trigger ruim onder kernel-OOM.
    max_memory_restart: "1500M",

    // Logs blijven via pm2-logrotate gerouteerd (module al actief).
    autorestart: true,
    watch: false,
  }]
}
