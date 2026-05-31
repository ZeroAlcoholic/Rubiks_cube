// Service-Worker cache-staleness guard.
//
// service-worker.js precaches the app shell (cube4x4.html, core/*, vendor/*…)
// and serves it cache-first. If a shell file's CONTENT changes but
// CACHE_VERSION is NOT bumped, returning users keep getting the STALE bundle
// (this exact bug shipped once: commit f65168f changed cube4x4.html without a
// bump). The header comment "bump CACHE_VERSION whenever any shell entry
// changes" was a manual rule that got missed.
//
// This guard turns that rule into a CI check using a committed lockfile
// (tools/sw-shell.lock). It hashes the current shell and compares against the
// lock. Invariant enforced:
//   shell content changes  ⟹  CACHE_VERSION must be bumped  ⟹  lock regenerated
//
// Usage:
//   node tools/check-sw-cache.mjs           # verify (CI). exit 1 if out of sync.
//   node tools/check-sw-cache.mjs --write   # regenerate lock after a legit bump.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SW_PATH = join(ROOT, 'service-worker.js');
const LOCK_PATH = join(ROOT, 'tools', 'sw-shell.lock');
const WRITE = process.argv.includes('--write');

const sw = readFileSync(SW_PATH, 'utf8');

const verMatch = sw.match(/const CACHE_VERSION = '([^']+)'/);
if (!verMatch) { console.error('✗ CACHE_VERSION not found in service-worker.js'); process.exit(1); }
const cacheVersion = verMatch[1];

// Extract the SHELL array body, then pull every './…' string literal from it.
const shellBlock = sw.match(/const SHELL = \[([\s\S]*?)\];/);
if (!shellBlock) { console.error('✗ SHELL array not found in service-worker.js'); process.exit(1); }
const shellFiles = [...shellBlock[1].matchAll(/'(\.\/[^']*)'/g)].map(m => m[1]);

// Hash each shell file's path + content, in listed order, into one digest.
const h = createHash('sha256');
const missing = [];
for (const rel of shellFiles) {
    const fsRel = rel === './' ? './index.html' : rel;
    const abs = join(ROOT, fsRel);
    if (!existsSync(abs)) { missing.push(rel); continue; }
    h.update(rel + '\0');
    h.update(readFileSync(abs));
    h.update('\0');
}
if (missing.length) {
    console.error('✗ shell entries missing on disk (SW install would fail):', missing.join(', '));
    process.exit(1);
}
const shellHash = h.digest('hex');

const current = { cacheVersion, shellHash, shellCount: shellFiles.length };
const lock = existsSync(LOCK_PATH) ? JSON.parse(readFileSync(LOCK_PATH, 'utf8')) : null;

if (WRITE) {
    if (lock && lock.shellHash !== shellHash && lock.cacheVersion === cacheVersion) {
        console.error('✗ Shell content changed but CACHE_VERSION is unchanged ' +
            `('${cacheVersion}'). Bump CACHE_VERSION in service-worker.js FIRST, then re-run --write.`);
        process.exit(1);
    }
    writeFileSync(LOCK_PATH, JSON.stringify(current, null, 2) + '\n');
    console.log(`✓ sw-shell.lock written (version=${cacheVersion}, ${shellFiles.length} shell files).`);
    process.exit(0);
}

// Verify mode (CI)
if (!lock) {
    console.error('✗ tools/sw-shell.lock missing. Run: node tools/check-sw-cache.mjs --write');
    process.exit(1);
}
const verOk = lock.cacheVersion === cacheVersion;
const hashOk = lock.shellHash === shellHash;
if (verOk && hashOk) {
    console.log(`✓ SW cache in sync (version=${cacheVersion}, ${shellFiles.length} shell files).`);
    process.exit(0);
}
console.error('✗ SW cache guard failed:');
if (!hashOk) console.error(`  - app shell content changed since lock (locked ${lock.shellHash.slice(0,12)}…, now ${shellHash.slice(0,12)}…).`);
if (!verOk)  console.error(`  - CACHE_VERSION differs from lock (locked '${lock.cacheVersion}', now '${cacheVersion}').`);
console.error('  Fix: ensure CACHE_VERSION is bumped for any shell change, then run:');
console.error('       node tools/check-sw-cache.mjs --write   (and commit tools/sw-shell.lock)');
process.exit(1);
