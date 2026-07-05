const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const CURRENT_LEVEL = LEVELS[process.env.LOG_LEVEL?.toUpperCase() || "INFO"] ?? LEVELS.INFO;
function log(level, message, context) {
    if (LEVELS[level] < CURRENT_LEVEL)
        return;
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    if (context && Object.keys(context).length > 0) {
        console.log(line, JSON.stringify(context));
    }
    else {
        console.log(line);
    }
}
export const logger = {
    debug: (message, context) => log("DEBUG", message, context),
    info: (message, context) => log("INFO", message, context),
    warn: (message, context) => log("WARN", message, context),
    error: (message, context) => log("ERROR", message, context),
};
