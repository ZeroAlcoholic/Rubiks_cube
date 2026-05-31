// Pure-cache Service Worker — NOT a PWA install gateway.
//
// Goal: make the second visit ~50 ms and let users solve cubes offline.
// We precache the app shell + heavy vendor JS + worker chain on install,
// then serve cache-first on every fetch. No manifest.json, no install banner,
// no icon set — those are PWA install UX, which CLAUDE.md still prohibits.
//
// Versioning: bump CACHE_VERSION whenever any shell entry changes. On the
// next page load the new SW activates, deletes old caches, and the user
// transparently gets the fresh bundle.

const CACHE_VERSION = 'rubiks-v2-2026-05-31';

// Files that MUST exist for the app to boot. Listed by URL (relative to /),
// so this file deploys correctly under GitHub Pages subpaths.
const SHELL = [
    './',
    './index.html',
    './cube3x3.html',
    './cube4x4.html',
    // Vendor (shared across 3×3 / 4×4)
    './vendor/three-r128.min.js',
    './vendor/orbitcontrols-r128.js',
    './vendor/cubejs-1.3.2.js',
    './vendor/cstimer-444.js',
    // 4×4 solver module graph
    './workers/solver-worker.js',
    './core/solver/solver-registry.js',
    './core/solver/reduction.js',
    './core/solver/yau-solver.js',
    './core/geometry/perms-n.js',
    './core/geometry/cube-geometry-n.js',
    './core/infra/errors.js',
    './core/infra/logger.js',
    './core/infra/perf.js',
    './content/teaching-4x4.js',
];

// Optional precache entries — fetch failures here are non-fatal (won't block
// SW activation). Use for assets that may not exist in all deploys.
//
// IMPORTANT: filenames MUST match what the worker actually fetches
// (workers/solver-worker.js → BAKED_URL builds `../vendor/bfs-tables/${name}.bin.gz`).
// If the extension drifts, the SW silently caches nothing here and the worker's
// first-visit fast path always misses the cache — falling back to BFS rebuild.
const SHELL_OPTIONAL = [
    './vendor/bfs-tables/udPair.bin.gz',
    './vendor/bfs-tables/fbPair.bin.gz',
    './vendor/bfs-tables/sortJoint.bin.gz',
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_VERSION);
        // Required shell: fail the install if any of these can't be cached.
        // Better to fall back to non-SW behavior than silently leave the user
        // with a half-cached app that breaks unpredictably offline.
        await cache.addAll(SHELL);
        // Optional shell: cache best-effort, ignore individual failures.
        await Promise.allSettled(SHELL_OPTIONAL.map(url =>
            fetch(url, { cache: 'reload' })
                .then(r => r.ok ? cache.put(url, r) : null)
                .catch(() => null)
        ));
        // Skip waiting so the new SW activates immediately on first install.
        // For updates, the user still sees the old SW until they reload —
        // that's intentional: don't disrupt an in-flight solve.
        self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
        );
        await self.clients.claim();
    })());
});

// Cache-first strategy:
//   1. If the request is in cache, serve it immediately (no network).
//   2. Otherwise, fetch from network. If successful and same-origin, also
//      put it in cache for next time (stale-while-revalidate-lite).
//   3. If both fail, return whatever cache.match found (may be undefined).
//
// We deliberately DO NOT use stale-while-revalidate for the shell because
// versioned CACHE_VERSION already handles updates. Adding background revalidate
// would cause extra network round-trips on every cached load.
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Only handle GET — POST/PUT/DELETE bypass the SW entirely.
    if (req.method !== 'GET') return;

    // Don't intercept cross-origin (CDN images, analytics, etc).
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith((async () => {
        const cache = await caches.open(CACHE_VERSION);
        // ignoreSearch:true so cache-bust query strings (e.g.
        // `workers/solver-worker.js?v=5`, `reduction.js?v=3`) still hit the
        // precached versionless entry. We rely on CACHE_VERSION (the cache
        // name itself) for invalidation on deploy, NOT URL query strings —
        // those are only there to defeat the browser's HTTP module cache
        // when SW is unavailable. Without ignoreSearch, an offline second
        // visit would 404 every versioned import.
        let cached = await cache.match(req, { ignoreSearch: true });
        if (cached) return cached;

        try {
            const fresh = await fetch(req);
            // Cache only successful, basic-type responses (skip opaque CDN
            // responses we never asked for).
            if (fresh.ok && fresh.type === 'basic') {
                // Clone BEFORE returning — Response body is a stream and can
                // only be consumed once. Store WITHOUT the query string so
                // future versioned requests can also match (consistent with
                // the precache layout above).
                const cacheKey = new URL(req.url);
                cacheKey.search = '';
                cache.put(cacheKey.toString(), fresh.clone());
            }
            return fresh;
        } catch (err) {
            // Network failed AND no cache match. Return a clear error so the
            // app can show its own "offline, please reconnect" message.
            return new Response(
                JSON.stringify({ error: 'offline-and-uncached', url: req.url }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
            );
        }
    })());
});
