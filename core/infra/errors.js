// Explicit error types for the rubiks_cube app family.
//
// Why: throwing `new Error('something')` everywhere makes catch handlers
// fragile — they have to substring-match on .message. With named types,
// callers can branch cleanly and we can attach structured context.
//
// Conventions:
//   - All errors extend AppError (which extends Error).
//   - Each error carries a `kind` for switch/case discrimination.
//   - Optional `cause` is the original error (per ES2022 Error.cause).
//   - Optional `details` is a plain object for diagnostic dump.

export class AppError extends Error {
    constructor(message, { kind, cause, details } = {}) {
        super(message);
        this.name = this.constructor.name;
        this.kind = kind || this.constructor.name;
        if (cause) this.cause = cause;
        if (details) this.details = details;
    }
    /** Render to a plain JSON-safe object — for logs and bug reports. */
    toJSON() {
        return {
            name: this.name,
            kind: this.kind,
            message: this.message,
            details: this.details,
            cause: this.cause && (this.cause.toJSON ? this.cause.toJSON() : String(this.cause)),
        };
    }
}

/**
 * State string failed strict validation (count, char set, piece realizability).
 *  - kind: 'fatal' | 'count' | 'piece'
 *  - details: { state, severity, errors[] }
 */
export class ValidationError extends AppError {
    constructor(message, { severity, errors, state, cause } = {}) {
        super(message, {
            kind: severity || 'unknown',
            details: { severity, errors, state: state ? state.slice(0, 24) + '...' : undefined },
            cause,
        });
        this.severity = severity;
        this.errors = errors || [];
    }
}

/**
 * Solver failed to find a solution, or produced an invalid one.
 *  - kind: 'reduction-failed' | 'invalid-state3' | 'cubejs-failed' | 'timeout'
 *  - details: { phase, state, partialMoves }
 */
export class SolverError extends AppError {
    constructor(message, { kind, phase, state, partialMoves, cause } = {}) {
        super(message, {
            kind: kind || 'solver-failed',
            details: {
                phase,
                state: state ? state.slice(0, 32) + '...' : undefined,
                partialMoves: partialMoves && partialMoves.length,
            },
            cause,
        });
        this.phase = phase;
    }
}

/**
 * Scanner / camera / classification failure.
 *  - kind: 'no-camera' | 'permission-denied' | 'bad-frame' | 'classifier-low-confidence'
 */
export class ScannerError extends AppError {
    constructor(message, { kind, details, cause } = {}) {
        super(message, { kind: kind || 'scanner-failed', details, cause });
    }
}

/**
 * The scan→solve handoff was blocked deliberately (e.g., confidence gate).
 *  - kind: 'low-confidence' | 'invalid-state' | 'override-required'
 */
export class HandoffError extends AppError {
    constructor(message, { kind, lows, severity, state, cause } = {}) {
        super(message, {
            kind: kind || 'handoff-blocked',
            details: { lows, severity, state: state ? state.slice(0, 24) + '...' : undefined },
            cause,
        });
        this.lows = lows;
        this.severity = severity;
    }
}
