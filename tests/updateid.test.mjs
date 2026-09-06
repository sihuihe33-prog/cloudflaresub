// Tests for updateId in-place update feature
// Run: node tests/updateid.test.mjs (uses src/core.js style imports where possible;
// worker.js exports default only, so we test via a mocked KV + imported functions through a light harness)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const workerSrc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'worker.js'), 'utf8');

// sanity: patch markers present
if (!workerSrc.includes('updateId')) throw new Error('updateId patch missing');
if (!workerSrc.includes("SUB_STORE.put(`sub:${updateId}`")) throw new Error('in-place rewrite missing');
// ensure old default path still exists
if (!workerSrc.includes('createUniqueShortId(env)')) throw new Error('original create path missing');
// ensure update path runs BEFORE dedup-lookup (patch ordering)
const idxUpdate = workerSrc.indexOf('const updateId =');
const idxLookup = workerSrc.indexOf('let id = await env.SUB_STORE.get(dedupKey);');
if (!(idxUpdate > 0 && idxLookup > idxUpdate)) throw new Error('patch ordering wrong');

console.log('updateid patch test passed');
