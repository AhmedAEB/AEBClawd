import { existsSync, readFileSync } from "fs";
const DEFAULT_ENV_PATH = "/opt/aebclawd/.env";
export function detectExistingInstall() {
    if (!existsSync(DEFAULT_ENV_PATH)) {
        return { found: false };
    }
    try {
        const content = readFileSync(DEFAULT_ENV_PATH, "utf-8");
        const envVars = {};
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#"))
                continue;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx === -1)
                continue;
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            envVars[key] = val;
        }
        return { found: true, envPath: DEFAULT_ENV_PATH, envVars };
    }
    catch {
        return { found: true, envPath: DEFAULT_ENV_PATH };
    }
}
