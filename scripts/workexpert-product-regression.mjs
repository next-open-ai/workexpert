import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const files = ['package.json', 'README.md', 'apps/desktop/package.json', 'apps/desktop/src/main/index.cjs', 'apps/api/src/main.ts', 'apps/renderer/src/app/BrandLogo.vue'];
const source = files.map(read).join('\n');

assert.match(read('package.json'), /@next-open-ai\/workexpert/);
assert.match(source, /WorkExpert/);
assert.match(source, /\.workexpert/);
assert.match(source, /50831/);
assert.match(source, /50832/);
assert.equal(fs.existsSync(path.join(root, 'bin/workexpert.mjs')), true);
assert.equal(fs.existsSync(path.join(root, 'apps/renderer/src/features/chat/RealtimeVoiceDialog.vue')), false);
assert.equal(fs.existsSync(path.join(root, 'apps/api/src/modules/chat-mobile/voice.ts')), false);

const searchable = ['apps/api/src', 'apps/renderer/src', 'packages/contracts/src'];
for (const base of searchable) {
  const pending = [path.join(root, base)];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (/\.(?:ts|vue|js|cjs|mjs)$/.test(entry.name)) {
        const value = fs.readFileSync(full, 'utf8');
        assert.doesNotMatch(value, /\/voice\/realtime|settings\/voice\/realtime|RealtimeVoiceDialog|VOLCENGINE_REALTIME/, full);
        assert.doesNotMatch(value, /@workmate|WORKMATE|\.workmate|com\.workmate/, full);
      }
    }
  }
}
console.log('WorkExpert product isolation regression passed.');
