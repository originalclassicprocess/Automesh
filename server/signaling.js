import { pathToFileURL } from 'node:url';
import { createSignalingServer } from '../nodes/packages/runtime/src/signaling.js';
export { createSignalingServer, createSignalingRegistry } from '../nodes/packages/runtime/src/signaling.js';
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.SIGNALING_PORT ?? 3001);
  const host = process.env.SIGNALING_HOST ?? '127.0.0.1';
  const allowedOrigins = process.env.SIGNALING_ALLOWED_ORIGINS
    ? process.env.SIGNALING_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SIGNALING_PORT must be between 1 and 65535');
  }
  const server = createSignalingServer({ port, host, allowedOrigins });
  server.on('listening', () => {
    console.log(`✅ Signaling server on ws://${host}:${port}`);
  });
}
