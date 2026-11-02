import { readFileSync } from 'node:fs';
import { gzipSync, constants } from 'node:zlib';

const MAX_RAW = 120 * 1024;
const MAX_GZIP = 50 * 1024;
const file = new URL('../dist/index.html', import.meta.url);

let buf;
try {
  buf = readFileSync(file);
} catch {
  console.error('size: dist/index.html introuvable (lancer npm run build)');
  process.exit(2);
}
const raw = buf.length;
const gz = gzipSync(buf, { level: constants.Z_BEST_COMPRESSION }).length;
console.log(`dist/index.html: ${raw} octets bruts (max ${MAX_RAW}), ${gz} octets gzip niveau 9 (max ${MAX_GZIP})`);
if (raw > MAX_RAW || gz > MAX_GZIP) {
  console.error('size: budget dépassé');
  process.exit(1);
}
