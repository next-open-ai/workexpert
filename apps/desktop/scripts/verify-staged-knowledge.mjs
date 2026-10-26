import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);

export function verifyStagedKnowledge(apiDirectory, { executable = require('electron') } = {}) {
  // Running from stage/ would mask missing dependencies via workspace parents.
  // Copy only shipped dependencies outside the repository, with no symlinks.
  const root = mkdtempSync(path.join(tmpdir(), 'workexpert-package-check-'));
  try {
    // Preserve the actual shipped layout. Never normalize node_deps to
    // node_modules here: doing so hid the ESM import failure in the old probe.
    const isolated = path.join(root, 'api');
    cpSync(apiDirectory, isolated, { recursive: true, dereference: true });
    const probe = path.join(isolated, 'knowledge-probe.cjs');
    writeFileSync(probe, `
      const path = require('node:path');
      (async () => {
        if (!process.versions.electron) throw new Error('Verification must use the Electron runtime');
        const lancedb = await import('@lancedb/lancedb');
        const db = await lancedb.connect(path.join(process.cwd(), 'db'));
        const vector = Array.from({ length: 1024 }, (_, index) => index === 0 ? 1 : 0);
        const original = { id: 'test', documentId: 'document-test', documentTitle: 'Test', title: 'Test',
          content: 'original', source: 'packaging-probe', vector, createdAt: Date.now() };
        const table = await db.createTable('chunks', [original]);
        await table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll()
          .execute([{ ...original, content: 'updated' }]);
        const saved = await table.query().where("id = 'test'").toArray();
        const hits = await table.vectorSearch(vector).distanceType('cosine').limit(1).toArray();
        if (await table.countRows() !== 1 || hits[0]?.content !== 'updated'
          || saved[0]?.documentId !== original.documentId || saved[0]?.vector?.length !== 1024) {
          throw new Error('LanceDB read/write verification failed');
        }
        console.log('Electron ' + process.versions.electron + ' / Node ' + process.versions.node + ' ESM import + isolated LanceDB write/update/recall: OK');
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `);
    const result = spawnSync(executable, ['--no-global-search-paths', probe], {
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
