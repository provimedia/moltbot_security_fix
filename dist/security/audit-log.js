import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
const log = createSubsystemLogger("security/audit-log");
/**
 * Resolve the audit log file path (~/.clawdbot/security/audit.jsonl).
 */
export function resolveAuditLogPath(stateDir) {
    const dir = stateDir ?? resolveStateDir();
    return path.join(dir, "security", "audit.jsonl");
}
/**
 * Append a single audit entry as JSONL to the persistent audit log.
 * Never throws — errors are logged and swallowed.
 */
export function appendAuditEntry(entry, stateDir) {
    try {
        const filePath = resolveAuditLogPath(stateDir);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
        const line = JSON.stringify(entry) + "\n";
        fs.appendFileSync(filePath, line, { mode: 0o600 });
    }
    catch (err) {
        log.warn(`Failed to write audit entry: ${err}`);
    }
}
