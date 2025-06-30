export function logError(error, context = {}) {
  console.error(`[${new Date().toISOString()}] ERROR: ${error.message}`, {
    stack: error.stack,
    ...context,
  });
}
