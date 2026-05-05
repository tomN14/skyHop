/**
 * Frees SKYHOP_RACE_PORT (default 3001) then starts the server.
 * Use when a previous `npm start` is still holding the port.
 */
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const killPort = require('kill-port');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, '..');
const port = Number(process.env.SKYHOP_RACE_PORT || 3001);

await killPort(port, 'tcp').catch(() => {
  /* nothing listening */
});

const r = spawnSync(process.execPath, ['index.js'], {
  stdio: 'inherit',
  cwd: serverRoot,
  env: process.env,
});

process.exit(r.status === null ? 1 : r.status);
