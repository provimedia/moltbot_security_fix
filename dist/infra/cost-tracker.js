import { loadJsonFile, saveJsonFile } from "./json-file.js";
import { resolveStateDir } from "../config/paths.js";
import path from "node:path";
function resolveTrackingPath(stateDir) {
    const dir = stateDir ?? resolveStateDir();
    return path.join(dir, "cost-tracking.json");
}
function utcDateString() {
    return new Date().toISOString().slice(0, 10);
}
/**
 * Load persisted cost snapshot. Resets session cost when sessionId changes,
 * resets daily cost when the UTC date changes.
 */
export function loadCostSnapshot(sessionId, stateDir) {
    const filePath = resolveTrackingPath(stateDir);
    const raw = loadJsonFile(filePath);
    if (!raw || typeof raw !== "object") {
        return { sessionCost: 0, dailyCost: 0 };
    }
    const today = utcDateString();
    const sessionCost = raw.sessionId === sessionId ? (raw.sessionCostUsd ?? 0) : 0;
    const dailyCost = raw.dailyDate === today ? (raw.dailyCostUsd ?? 0) : 0;
    return { sessionCost, dailyCost };
}
/**
 * Persist current cost snapshot for session and daily tracking.
 */
export function saveCostSnapshot(params, stateDir) {
    const filePath = resolveTrackingPath(stateDir);
    const snapshot = {
        sessionId: params.sessionId,
        sessionCostUsd: params.sessionCostUsd,
        dailyCostUsd: params.dailyCostUsd,
        dailyDate: utcDateString(),
    };
    saveJsonFile(filePath, snapshot);
}
