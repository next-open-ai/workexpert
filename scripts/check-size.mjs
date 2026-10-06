import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const assetsDir = 'apps/renderer/dist/assets';

function sizeOf(target) {
  if (!existsSync(target)) return 0;
  const stat = statSync(target);
  if (stat.isFile()) return stat.size;
  return readdirSync(target, { withFileTypes: true })
    .reduce((total, entry) => total + sizeOf(path.join(target, entry.name)), 0);
}

if (!existsSync(assetsDir)) {
  console.error(`renderer build output is missing: ${assetsDir}`);
  process.exit(1);
}

const files = readdirSync(assetsDir)
  .map((name) => ({ name, bytes: statSync(path.join(assetsDir, name)).size }))
  .sort((a, b) => b.bytes - a.bytes);
const code = files.filter(({ name }) => /\.(?:js|css)$/.test(name));
const scripts = files.filter(({ name }) => name.endsWith('.js'));
const entry = scripts.find(({ name }) => /^index-.*\.js$/.test(name));
const metrics = [
  { label: 'renderer entry JavaScript', bytes: entry?.bytes ?? 0, maxBytes: 1_500_000 },
  // Monaco's language contribution is lazy and intentionally isolated from
  // startup; keep a separate ceiling so it cannot silently grow without
  // forcing the first-load bundle to absorb its cost.
  { label: 'largest JavaScript chunk', bytes: scripts[0]?.bytes ?? 0, maxBytes: 2_500_000 },
  { label: 'renderer JavaScript + CSS', bytes: code.reduce((sum, file) => sum + file.bytes, 0), maxBytes: 4_800_000 },
  { label: 'renderer static assets', bytes: sizeOf(assetsDir), maxBytes: 6_000_000 },
];

let failed = false;
for (const metric of metrics) {
  const mb = (metric.bytes / 1_000_000).toFixed(2);
  console.log(`${metric.label}: ${mb} MB / ${(metric.maxBytes / 1_000_000).toFixed(2)} MB`);
  if (metric.bytes <= 0 || metric.bytes > metric.maxBytes) failed = true;
}
if (failed) process.exitCode = 1;
