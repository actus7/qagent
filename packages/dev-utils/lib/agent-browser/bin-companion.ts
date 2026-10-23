import { AgentBrowserCompanionServer } from './companion';

async function main(): Promise<void> {
  const server = AgentBrowserCompanionServer.fromEnv(process.env);
  await server.start();

  console.log(`[agent-browser] companion listening on ${server.getAddress()}`);

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

void main().catch(error => {
  console.error('[agent-browser] companion failed to start:', error);
  process.exit(1);
});

