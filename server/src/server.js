'use strict';

const { loadDotEnv, loadConfig } = require('./env');
const { createPool, resolveCompanyId } = require('./db');
const { createApp } = require('./app');
const { attachLive } = require('./live');

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const companyId = await resolveCompanyId(pool, config.companySlug);
  const app = createApp({ pool, companyId, trustProxy: config.trustProxy });
  const server = app.listen(config.port, config.host, () => {
    const { address, port } = server.address();
    console.log('Creative Episode wall on http://' + address + ':' + port + ' (company: ' + config.companySlug + ')');
  });
  const wss = attachLive(server, { hub: app.locals.hub, pool, companyId, trustProxy: config.trustProxy });
  const shutdown = () => {
    // Open sockets would keep server.close() waiting forever; walls reconnect to the next process.
    wss.clients.forEach((ws) => ws.close(1001, 'restarting'));
    server.close(() => pool.end().then(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Server failed to start: ' + err.message);
  process.exit(1);
});
