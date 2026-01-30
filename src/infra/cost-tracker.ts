import { loadJsonFile, saveJsonFile } from "./json-file.js";
import { resolveStateDir } from "../config/paths.js";
import path from "node:path";

type CostSnapshot = {
  sessionId: string;
  sessionCostUsd: number;
  dailyCostUsd: number;
  /** UTC date string YYYY-MM-DD for daily reset. */
  dailyDate: string;
};

function resolveTrackingPath(stateDir?: string): string {
  const dir = stateDir ?? resolveStateDir();
  return path.join(dir, "cost-tracking.json");
}

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Load persisted cost snapshot. Resets session cost when sessionId changes,
 * resets daily cost when the UTC date changes.
 */
export function loadCostSnapshot(
  sessionId: string,
  stateDir?: string,
): { sessionCost: number; dailyCost: number } {
  const filePath = resolveTrackingPath(stateDir);
  const raw = loadJsonFile(filePath) as CostSnapshot | undefined;
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
export function saveCostSnapshot(
  params: {
    sessionId: string;
    sessionCostUsd: number;
    dailyCostUsd: number;
  },
  stateDir?: string,
): void {
  const filePath = resolveTrackingPath(stateDir);
  const snapshot: CostSnapshot = {
    sessionId: params.sessionId,
    sessionCostUsd: params.sessionCostUsd,
    dailyCostUsd: params.dailyCostUsd,
    dailyDate: utcDateString(),
  };
  saveJsonFile(filePath, snapshot);
}
