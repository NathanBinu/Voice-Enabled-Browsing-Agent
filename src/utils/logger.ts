// Minimal console logger with ISO timestamps for consistent logs.
export const log = (...args: unknown[]) =>
    console.log(new Date().toISOString(), '-', ...args);

export const warn = (...args: unknown[]) =>
    console.warn(new Date().toISOString(), '[WARN]', ...args);

export const error = (...args: unknown[]) =>
    console.error(new Date().toISOString(), '[ERROR]', ...args);
