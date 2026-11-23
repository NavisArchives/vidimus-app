import { buildApp } from './app.js';

async function main() {
  const { app, db, config } = await buildApp();

  const shutdown = async () => {
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: config.host });
  console.log(`Vidimus server listening on http://${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error('Failed to start Vidimus server:', err);
  process.exit(1);
});
