import { appendFileSync, writeFileSync } from "fs";

const LOG_FILE = "/tmp/aebclawd-install.log";

let initialized = false;

export function log(msg: string) {
  if (!initialized) {
    writeFileSync(LOG_FILE, `=== AEBClawd Installer ${new Date().toISOString()} ===\n`);
    initialized = true;
  }
  appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
}

export function logError(msg: string, err: unknown) {
  const errMsg = err instanceof Error ? err.message : String(err);
  log(`ERROR: ${msg}: ${errMsg}`);
}
