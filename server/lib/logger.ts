type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVELS: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const CURRENT_LEVEL = LEVELS[(process.env.LOG_LEVEL?.toUpperCase() as LogLevel) || "INFO"] ?? LEVELS.INFO;

function log(level: LogLevel, message: string, context?: Record<string, unknown>) {
  if (LEVELS[level] < CURRENT_LEVEL) return;
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  if (context && Object.keys(context).length > 0) {
    console.log(line, JSON.stringify(context));
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log("DEBUG", message, context),
  info: (message: string, context?: Record<string, unknown>) => log("INFO", message, context),
  warn: (message: string, context?: Record<string, unknown>) => log("WARN", message, context),
  error: (message: string, context?: Record<string, unknown>) => log("ERROR", message, context),
};
