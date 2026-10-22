import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function verifyStagedKnowledge(dependencies) {
  // Running from stage/ would mask missing dependencies via workspace parents.
  // Copy only shipped dependencies outside the repository, with no symlinks.
  const root = mkdtempSync(path.join(tmpdir(), 'workexpert-package-check-'));
  try {
    const isolated = path.join(root, 'node_modules');
    cpSync(dependencies, isolated, { recursive: true, dereference: true });
    const result = spawnSync(process.execPath, ['--no-global-search-paths', '-e', `
      const { createRequire } = require('node:module');
      const path = require('node:path');
      const load = createRequire(path.join(process.cwd(), 'probe.cjs'));
      const lancedb = load('./node_modules/@lancedb/lancedb');
      (async () => {
        const db = await lancedb.connect(path.join(process.cwd(), 'db'));
        const table = await db.createTable('chunks', [{ id: 'test', content: 'original', vector: [1, 0, 0] }]);
        await table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll()
          .execute([{ id: 'test', content: 'updated', vector: [1, 0, 0] }]);
        const hits = await table.vectorSearch([1, 0, 0]).limit(1).toArray();
        if (await table.countRows() !== 1 || hits[0]?.content !== 'updated') throw new Error('LanceDB read/write verification failed');
        console.log('Isolated LanceDB write/update/recall: OK');
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `], {
      cwd: root,
      env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8', timeout: 60_000,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Staged local knowledge runtime is incomplete or incompatible. Reinstall dependencies on the target platform before packaging.\n${result.error?.message ?? ''}\n${result.stderr || result.stdout}`);
    }
    return result.stdout.trim();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
