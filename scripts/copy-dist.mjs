import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('apps/web/dist');
const dest = path.resolve('dist');

if (fs.existsSync(src)) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log('[Build] Mirrored apps/web/dist to ./dist for hosting compatibility.');
}
