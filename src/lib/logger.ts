type LogLevel = "info" | "warn" | "error" | "debug";

function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const entry = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}${meta ? " " + JSON.stringify(meta) : ""}`;
  if (level === "error") console.error(entry);
  else console.log(entry);
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
  debug: (msg: string, meta?: Record<string, unknown>) => log("debug", msg, meta),
};

export function logApiRequest(method: string, path: string, status: number, duration: number, _err?: unknown) {
  void _err;
  logger.info(`${method} ${path} ${status} ${duration}ms`);
}
