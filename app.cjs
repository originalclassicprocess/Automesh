// CommonJS startup entry for cPanel/Passenger; the application itself uses ESM.
import('./server/app.js').catch(() => {
  console.error('Automesh could not start. Check ORIGIN, Node version and uploaded build.');
  process.exitCode = 1;
});
