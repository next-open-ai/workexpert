import fs from 'node:fs';
import path from 'node:path';
import type { FileOwner } from '@workexpert/contracts';

export function readOwnedSourceFile(input: {
  owner: FileOwner;
  asset: { name: string; orgId?: string | null; ownerUserId?: string | null; userId?: string | null; kind?: string };
  target: string;
  assetsRoot: string;
}) {
  const { asset, owner } = input;
  if (asset.orgId !== owner.orgId || (asset.ownerUserId || asset.userId) !== owner.userId || asset.kind === 'bundle') {
    throw new Error('Asset not found or not owned by current user.');
  }
  const root = fs.realpathSync(input.assetsRoot);
  const resolved = fs.realpathSync(input.target);
  if (!resolved.startsWith(root + path.sep) || fs.lstatSync(input.target).isSymbolicLink()) throw new Error('Unsafe asset path.');
  const fd = fs.openSync(resolved, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new Error('Invalid source asset.');
    return { name: asset.name, bytes: fs.readFileSync(fd) };
  } finally { fs.closeSync(fd); }
}
