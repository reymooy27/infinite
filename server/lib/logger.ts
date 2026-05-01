type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

function formatLog(entry: LogEntry): string {
  const base = `[${entry.timestamp}] [${entry.level}] ${entry.message}`;
  if (entry.context && Object.keys(entry.context).length > 0) {
    return `${base} ${JSON.stringify(entry.context)}`;
  }
  return base;
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
  };
  console.log(formatLog(entry));
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => log("INFO", message, context),
  warn: (message: string, context?: Record<string, unknown>) => log("WARN", message, context),
  error: (message: string, context?: Record<string, unknown>) => log("ERROR", message, context),
  debug: (message: string, context?: Record<string, unknown>) => log("DEBUG", message, context),
};