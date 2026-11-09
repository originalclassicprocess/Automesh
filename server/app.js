import { deploymentConfig, createApplicationServer } from './application.js';

const config = deploymentConfig();
// Set canonical origin before loading the generated Svelte runtime.
process.env.ORIGIN = config.origin;
// The standalone Node runtime also uses /signal in localhost tests. It must
// not accidentally join a different development registry on port 3001.
process.env.MESH_RUNTIME_LOCAL_SIGNAL_URL ||= config.origin.replace(/^http/, 'ws') + '/signal';
const { handler } = await import('../build/handler.js');
const runtime = createApplicationServer(handler, config);
const startupError = (error) => {
  console.error(`Application startup failed (${error.code || 'server_error'}).`);
  process.exitCode = 1;
};
runtime.app.on('error', startupError);
runtime.signaling.on('error', startupError);
runtime.app.listen(config.port, config.host, () => console.log(`Automesh ready: ${config.origin}`));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(1), 10_000); timer.unref();
  void runtime.close().then(() => { clearTimeout(timer); process.exit(0); });
});
