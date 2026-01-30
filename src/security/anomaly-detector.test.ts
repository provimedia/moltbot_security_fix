import { describe, expect, it } from "vitest";

import { createAnomalyDetector } from "./anomaly-detector.js";

describe("anomaly-detector", () => {
  describe("repeat-loop detection", () => {
    it("detects repeated identical tool calls", () => {
      const detector = createAnomalyDetector({ enabled: true, maxRepeatCalls: 3 });
      const call = { toolName: "exec", params: { command: "ls" } };

      expect(detector.recordToolCall(call)).toBeUndefined(); // 1st
      expect(detector.recordToolCall(call)).toBeUndefined(); // 2nd
      const event = detector.recordToolCall(call); // 3rd → triggers
      expect(event).toBeDefined();
      expect(event!.type).toBe("repeat-loop");
      expect(event!.toolName).toBe("exec");
      expect(event!.message).toContain("3 times");
    });

    it("resets repeat count when a different call is made", () => {
      const detector = createAnomalyDetector({ enabled: true, maxRepeatCalls: 3 });
      const callA = { toolName: "exec", params: { command: "ls" } };
      const callB = { toolName: "exec", params: { command: "pwd" } };

      detector.recordToolCall(callA);
      detector.recordToolCall(callA);
      // Different call resets counter.
      detector.recordToolCall(callB);
      expect(detector.recordToolCall(callA)).toBeUndefined(); // reset, only 1st again
    });
  });

  describe("burst detection", () => {
    it("detects burst of calls within the time window", () => {
      const detector = createAnomalyDetector({
        enabled: true,
        maxBurstCalls: 5,
        burstWindowMs: 60_000,
        // High repeat threshold to avoid triggering repeat-loop first.
        maxRepeatCalls: 1000,
      });

      // Make 5 calls rapidly with different params to avoid repeat-loop.
      for (let i = 0; i < 4; i++) {
        const event = detector.recordToolCall({ toolName: "search", params: { q: `q${i}` } });
        expect(event).toBeUndefined();
      }
      const event = detector.recordToolCall({ toolName: "search", params: { q: "q4" } });
      expect(event).toBeDefined();
      expect(event!.type).toBe("burst");
    });
  });

  describe("excessive-navigation detection", () => {
    it("detects excessive browser navigate calls", () => {
      const detector = createAnomalyDetector({
        enabled: true,
        maxBrowserNavigations: 3,
        // Prevent other triggers.
        maxRepeatCalls: 1000,
        maxBurstCalls: 1000,
      });

      const nav = { toolName: "browser", params: { action: "navigate", url: "https://a.com" } };
      detector.recordToolCall(nav);
      detector.recordToolCall({
        toolName: "browser",
        params: { action: "navigate", url: "https://b.com" },
      });
      const event = detector.recordToolCall({
        toolName: "browser",
        params: { action: "navigate", url: "https://c.com" },
      });
      expect(event).toBeDefined();
      expect(event!.type).toBe("excessive-navigation");
      expect(event!.message).toContain("3 times");
    });

    it("does not count non-navigate browser actions", () => {
      const detector = createAnomalyDetector({
        enabled: true,
        maxBrowserNavigations: 2,
        maxRepeatCalls: 1000,
        maxBurstCalls: 1000,
      });

      detector.recordToolCall({ toolName: "browser", params: { action: "snapshot" } });
      detector.recordToolCall({
        toolName: "browser",
        params: { action: "click", selector: "#btn" },
      });
      // No excessive-navigation event for non-navigate actions.
      expect(detector.getAnomalies()).toHaveLength(0);
    });
  });

  describe("error-loop detection", () => {
    it("detects repeated identical errors", () => {
      const detector = createAnomalyDetector({ enabled: true, maxRepeatCalls: 3 });
      const call = { toolName: "exec", params: { command: "bad" }, error: "ENOENT" };

      // Each call has a different param to avoid repeat-loop, but same error.
      const makeCall = (i: number) => ({
        toolName: "exec",
        params: { command: `bad-${i}` },
        error: "ENOENT",
      });

      detector.recordToolCall(makeCall(0));
      detector.recordToolCall(makeCall(1));
      const event = detector.recordToolCall(makeCall(2));
      expect(event).toBeDefined();
      expect(event!.type).toBe("error-loop");
      expect(event!.message).toContain("3 times");
    });

    it("resets error count when a successful call is made", () => {
      const detector = createAnomalyDetector({
        enabled: true,
        maxRepeatCalls: 3,
        maxBurstCalls: 1000,
      });
      detector.recordToolCall({ toolName: "exec", params: { command: "a" }, error: "FAIL" });
      detector.recordToolCall({ toolName: "exec", params: { command: "b" }, error: "FAIL" });
      // Successful call resets error tracking.
      detector.recordToolCall({ toolName: "exec", params: { command: "c" } });
      expect(
        detector.recordToolCall({ toolName: "exec", params: { command: "d" }, error: "FAIL" }),
      ).toBeUndefined();
    });
  });

  describe("getAnomalies", () => {
    it("returns all detected anomalies", () => {
      const detector = createAnomalyDetector({ enabled: true, maxRepeatCalls: 2 });
      const call = { toolName: "exec", params: { command: "ls" } };
      detector.recordToolCall(call);
      detector.recordToolCall(call); // triggers
      expect(detector.getAnomalies()).toHaveLength(1);
      expect(detector.getAnomalies()[0].type).toBe("repeat-loop");
    });
  });

  describe("shouldBlock", () => {
    it("returns block: false when action is 'log' even with anomalies", () => {
      const detector = createAnomalyDetector({ enabled: true, maxRepeatCalls: 2, action: "log" });
      const call = { toolName: "exec", params: { command: "ls" } };
      detector.recordToolCall(call);
      detector.recordToolCall(call); // triggers anomaly
      expect(detector.getAnomalies()).toHaveLength(1);
      expect(detector.shouldBlock().block).toBe(false);
    });

    it("returns block: false when action is 'warn' even with anomalies", () => {
      const detector = createAnomalyDetector({ enabled: true, maxRepeatCalls: 2, action: "warn" });
      const call = { toolName: "exec", params: { command: "ls" } };
      detector.recordToolCall(call);
      detector.recordToolCall(call); // triggers anomaly
      expect(detector.getAnomalies()).toHaveLength(1);
      expect(detector.shouldBlock().block).toBe(false);
    });

    it("returns block: true when action is 'abort' and anomalies exist", () => {
      const detector = createAnomalyDetector({ enabled: true, maxRepeatCalls: 2, action: "abort" });
      const call = { toolName: "exec", params: { command: "ls" } };
      // No anomalies yet — should not block.
      expect(detector.shouldBlock().block).toBe(false);
      detector.recordToolCall(call);
      detector.recordToolCall(call); // triggers anomaly
      expect(detector.getAnomalies()).toHaveLength(1);
      const result = detector.shouldBlock();
      expect(result.block).toBe(true);
      if (result.block) {
        expect(result.reason).toContain("repeat-loop");
      }
    });
  });
});
