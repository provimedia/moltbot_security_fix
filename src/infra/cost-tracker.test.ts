import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadCostSnapshot, saveCostSnapshot } from "./cost-tracker.js";

describe("cost-tracker", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cost-tracker-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("round-trips save and load with same session", () => {
    saveCostSnapshot({ sessionId: "s1", sessionCostUsd: 1.5, dailyCostUsd: 3.0 }, tmpDir);

    const snapshot = loadCostSnapshot("s1", tmpDir);
    expect(snapshot.sessionCost).toBe(1.5);
    expect(snapshot.dailyCost).toBe(3.0);
  });

  it("resets session cost when sessionId changes", () => {
    saveCostSnapshot({ sessionId: "s1", sessionCostUsd: 2.0, dailyCostUsd: 5.0 }, tmpDir);

    const snapshot = loadCostSnapshot("s2", tmpDir);
    expect(snapshot.sessionCost).toBe(0);
    // Daily cost should persist (same date).
    expect(snapshot.dailyCost).toBe(5.0);
  });

  it("resets daily cost when UTC date changes", () => {
    // Write a snapshot with a stale date.
    const filePath = path.join(tmpDir, "cost-tracking.json");
    const staleSnapshot = {
      sessionId: "s1",
      sessionCostUsd: 1.0,
      dailyCostUsd: 10.0,
      dailyDate: "2020-01-01",
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(staleSnapshot), "utf8");

    const snapshot = loadCostSnapshot("s1", tmpDir);
    expect(snapshot.sessionCost).toBe(1.0);
    expect(snapshot.dailyCost).toBe(0);
  });

  it("returns zeros when file does not exist", () => {
    const snapshot = loadCostSnapshot("s1", tmpDir);
    expect(snapshot.sessionCost).toBe(0);
    expect(snapshot.dailyCost).toBe(0);
  });
});
