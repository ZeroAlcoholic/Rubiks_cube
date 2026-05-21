// Structured logging for the rubiks_cube app family.
//
// Goal: replace scattered console.log calls with categorized log streams
// that can be filtered, exported, and replayed during diagnosis.
//
// Categories:
//   scan    - camera capture, color classification, calibration
//   solve   - solver invocations, phase transitions, results
//   perf    - timing and performance budget tracking
//   ui      - user-facing state changes (panel open/close, guide step)
//   error   - structured error reports (paired with errors.js)
//
// Usage:
//   import { logger } from './core/infra/logger.js';
//   logger.scan('face-confirmed', { slot: 'U', confidenceLow: 2 });
//   logger.solve('phase-start', { name: 'centers', N: 4 });
//
// The default sink prints to console.log with a category prefix.
// Override via setSink() — useful for tests (capture into array) or
// future telemetry (send to localStorage / remote endpoint).

const DEFAULT_SINK = (category, event, data) => {
    const timestamp = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const payload = data === undefined ? '' : ' ' + JSON.stringify(data);
    console.log(`[${timestamp}][${category.toUpperCase()}] ${event}${payload}`);
};

let currentSink = DEFAULT_SINK;
const ringBuffer = [];
const RING_CAPACITY = 500;

function emit(category, event, data) {
    // Always keep last N events in memory for crash/error reports.
    ringBuffer.push({ ts: Date.now(), category, event, data });
    if (ringBuffer.length > RING_CAPACITY) ringBuffer.shift();
    try {
        currentSink(category, event, data);
    } catch (e) {
        // Never let logging break the app.
        console.error('[LOGGER] sink threw', e);
    }
}

export const logger = {
    scan:  (event, data) => emit('scan',  event, data),
    solve: (event, data) => emit('solve', event, data),
    perf:  (event, data) => emit('perf',  event, data),
    ui:    (event, data) => emit('ui',    event, data),
    error: (event, data) => emit('error', event, data),
};

// Replace the sink (e.g., tests can collect into an array).
export function setSink(fn) {
    currentSink = typeof fn === 'function' ? fn : DEFAULT_SINK;
}

// Dump recent events as a JSON-serializable array — for bug reports.
export function dumpRecentEvents() {
    return ringBuffer.slice();
}

// Clear the ring (typically called at the start of a new scan session).
export function clearRingBuffer() {
    ringBuffer.length = 0;
}
