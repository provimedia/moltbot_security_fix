import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendAuditEntry, resolveAuditLogPath, type AuditLogEntry } from "./audit-log.js";

describe("audit-log", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-log-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a single entry as JSONL", () => {
    const entry: AuditLogEntry = {
      ts: 1000,
      event: "command_blocked",
      toolName: "exec",
      command: "ordercli --confirm",
      ruleName: "ordercli-confirm",
      reason: "blocked",
    };
    appendAuditEntry(entry, tmpDir);

    const logPath = resolveAuditLogPath(tmpDir);
    const content = fs.readFileSync(logPath, "utf8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.event).toBe("command_blocked");
    expect(parsed.toolName).toBe("exec");
    expect(parsed.ts).toBe(1000);
  });

  it("appends multiple entries as separate lines", () => {
    const entry1: AuditLogEntry = { ts: 1, event: "command_blocked" };
    const entry2: AuditLogEntry = { ts: 2, event: "anomaly_detected", anomalyType: "burst" };
    const entry3: AuditLogEntry = { ts: 3, event: "cost_limit_exceeded" };

    appendAuditEntry(entry1, tmpDir);
    appendAuditEntry(entry2, tmpDir);
    appendAuditEntry(entry3, tmpDir);

    const logPath = resolveAuditLogPath(tmpDir);
    const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).ts).toBe(1);
    expect(JSON.parse(lines[1]).event).toBe("anomaly_detected");
    expect(JSON.parse(lines[2]).event).toBe("cost_limit_exceeded");
  });

  it("produces valid JSONL (each line is valid JSON)", () => {
    for (let i = 0; i < 5; i++) {
      appendAuditEntry({ ts: i, event: "command_blocked", reason: `r${i}` }, tmpDir);
    }

    const logPath = resolveAuditLogPath(tmpDir);
    const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
