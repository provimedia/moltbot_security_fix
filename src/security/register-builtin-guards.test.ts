import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createBuiltinGuardHooks } from "./register-builtin-guards.js";
import {
  initializeGlobalHookRunner,
  getGlobalHookRunner,
  resetGlobalHookRunner,
} from "../plugins/hook-runner-global.js";
import type { PluginRegistry } from "../plugins/registry.js";
import type { PluginHookRegistration } from "../plugins/types.js";

/**
 * Build a minimal PluginRegistry that includes builtin guard hooks,
 * mirroring what loadMoltbotPlugins does at startup.
 */
function buildRegistryWithGuards(config?: Record<string, unknown>): PluginRegistry {
  const guards = createBuiltinGuardHooks(config as any);
  const registry: PluginRegistry = {
    plugins: [],
    tools: [],
    hooks: [],
    typedHooks: [
      {
        pluginId: "builtin:security-guards",
        hookName: "before_tool_call",
        handler: guards.before_tool_call,
        priority: 1000,
        source: "builtin",
      } as PluginHookRegistration,
      {
        pluginId: "builtin:security-guards",
        hookName: "after_tool_call",
        handler: guards.after_tool_call,
        priority: 1000,
        source: "builtin",
      } as PluginHookRegistration,
    ],
    channels: [],
    providers: [],
    gatewayHandlers: {},
    httpHandlers: [],
    httpRoutes: [],
    cliRegistrars: [],
    services: [],
    commands: [],
    diagnostics: [],
  };
  return registry;
}

describe("register-builtin-guards integration", () => {
  afterEach(() => {
    resetGlobalHookRunner();
  });

  it("registers both before_tool_call and after_tool_call hooks", () => {
    const registry = buildRegistryWithGuards();
    expect(registry.typedHooks).toHaveLength(2);
    expect(registry.typedHooks[0].hookName).toBe("before_tool_call");
    expect(registry.typedHooks[1].hookName).toBe("after_tool_call");
    expect(registry.typedHooks[0].pluginId).toBe("builtin:security-guards");
  });

  it("global hook runner reports hooks after initialization", () => {
    const registry = buildRegistryWithGuards();
    initializeGlobalHookRunner(registry);
    const runner = getGlobalHookRunner();
    expect(runner).not.toBeNull();
    expect(runner!.hasHooks("before_tool_call")).toBe(true);
    expect(runner!.hasHooks("after_tool_call")).toBe(true);
  });

  it("before_tool_call blocks dangerous exec commands via the hook runner", async () => {
    const registry = buildRegistryWithGuards();
    initializeGlobalHookRunner(registry);
    const runner = getGlobalHookRunner()!;

    const result = await runner.runBeforeToolCall(
      { toolName: "exec", params: { command: "ordercli pizza --confirm" } },
      { agentId: "test", sessionKey: "s1", toolName: "exec" },
    );

    expect(result).toBeDefined();
    expect(result!.block).toBe(true);
    expect(result!.blockReason).toContain("ordercli --confirm");
  });

  it("before_tool_call blocks ordercli --pay via the hook runner", async () => {
    const registry = buildRegistryWithGuards();
    initializeGlobalHookRunner(registry);
    const runner = getGlobalHookRunner()!;

    const result = await runner.runBeforeToolCall(
      { toolName: "bash", params: { command: "ordercli burger --pay" } },
      { agentId: "test", sessionKey: "s1", toolName: "bash" },
    );

    expect(result).toBeDefined();
    expect(result!.block).toBe(true);
    expect(result!.blockReason).toContain("ordercli --pay");
  });

  it("before_tool_call blocks rm -rf / via the hook runner", async () => {
    const registry = buildRegistryWithGuards();
    initializeGlobalHookRunner(registry);
    const runner = getGlobalHookRunner()!;

    const result = await runner.runBeforeToolCall(
      { toolName: "exec", params: { command: "rm -rf / " } },
      { agentId: "test", sessionKey: "s1", toolName: "exec" },
    );

    expect(result).toBeDefined();
    expect(result!.block).toBe(true);
    expect(result!.blockReason).toContain("recursive delete");
  });

  it("before_tool_call allows safe commands", async () => {
    const registry = buildRegistryWithGuards();
    initializeGlobalHookRunner(registry);
    const runner = getGlobalHookRunner()!;

    const result = await runner.runBeforeToolCall(
      { toolName: "exec", params: { command: "ls -la" } },
      { agentId: "test", sessionKey: "s1", toolName: "exec" },
    );

    // No block result means allowed.
    expect(result?.block).toBeFalsy();
  });

  it("before_tool_call ignores non-exec/bash tools", async () => {
    const registry = buildRegistryWithGuards();
    initializeGlobalHookRunner(registry);
    const runner = getGlobalHookRunner()!;

    const result = await runner.runBeforeToolCall(
      { toolName: "browser", params: { command: "ordercli --confirm" } },
      { agentId: "test", sessionKey: "s1", toolName: "browser" },
    );

    expect(result?.block).toBeFalsy();
  });

  it("custom safety rules block via the hook runner", async () => {
    const registry = buildRegistryWithGuards({
      agents: {
        defaults: {
          safety: {
            rules: [
              { name: "no-deploy", pattern: "deploy.*--prod", reason: "Blocked: no prod deploy" },
            ],
          },
        },
      },
    });
    initializeGlobalHookRunner(registry);
    const runner = getGlobalHookRunner()!;

    const result = await runner.runBeforeToolCall(
      { toolName: "exec", params: { command: "deploy my-app --prod" } },
      { agentId: "test", sessionKey: "s1", toolName: "exec" },
    );

    expect(result!.block).toBe(true);
    expect(result!.blockReason).toContain("no prod deploy");
  });

  it("disabling builtinRules stops default blocking", async () => {
    const registry = buildRegistryWithGuards({
      agents: { defaults: { safety: { builtinRules: false } } },
    });
    initializeGlobalHookRunner(registry);
    const runner = getGlobalHookRunner()!;

    const result = await runner.runBeforeToolCall(
      { toolName: "exec", params: { command: "ordercli pizza --confirm" } },
      { agentId: "test", sessionKey: "s1", toolName: "exec" },
    );

    expect(result?.block).toBeFalsy();
  });

  it("before_tool_call blocks nodes tool with action=run and dangerous rawCommand", async () => {
    const registry = buildRegistryWithGuards();
    initializeGlobalHookRunner(registry);
    const runner = getGlobalHookRunner()!;

    const result = await runner.runBeforeToolCall(
      { toolName: "nodes", params: { action: "run", rawCommand: "ordercli --confirm" } },
      { agentId: "test", sessionKey: "s1", toolName: "nodes" },
    );

    expect(result).toBeDefined();
    expect(result!.block).toBe(true);
    expect(result!.blockReason).toContain("ordercli --confirm");
  });

  it("before_tool_call allows nodes tool with action=status (not checked)", async () => {
    const registry = buildRegistryWithGuards();
    initializeGlobalHookRunner(registry);
    const runner = getGlobalHookRunner()!;

    const result = await runner.runBeforeToolCall(
      { toolName: "nodes", params: { action: "status", rawCommand: "ordercli --confirm" } },
      { agentId: "test", sessionKey: "s1", toolName: "nodes" },
    );

    expect(result?.block).toBeFalsy();
  });

  it("before_tool_call allows nodes tool with action=run and safe command", async () => {
    const registry = buildRegistryWithGuards();
    initializeGlobalHookRunner(registry);
    const runner = getGlobalHookRunner()!;

    const result = await runner.runBeforeToolCall(
      { toolName: "nodes", params: { action: "run", rawCommand: "ls -la" } },
      { agentId: "test", sessionKey: "s1", toolName: "nodes" },
    );

    expect(result?.block).toBeFalsy();
  });

  it("after_tool_call records anomaly data (does not throw)", async () => {
    const registry = buildRegistryWithGuards({
      agents: { defaults: { anomalyDetection: { enabled: true, maxRepeatCalls: 3 } } },
    });
    initializeGlobalHookRunner(registry);
    const runner = getGlobalHookRunner()!;

    // Fire a few after_tool_call events — should not throw.
    for (let i = 0; i < 5; i++) {
      await runner.runAfterToolCall(
        { toolName: "exec", params: { command: "echo hi" }, durationMs: 10 },
        { agentId: "test", sessionKey: "s1", toolName: "exec" },
      );
    }
    // If we got here without error, the anomaly detector is wired correctly.
    expect(true).toBe(true);
  });

  it("before_tool_call blocks when anomaly detector is in abort mode with anomalies", async () => {
    const registry = buildRegistryWithGuards({
      agents: {
        defaults: {
          anomalyDetection: { enabled: true, maxRepeatCalls: 2, action: "abort" },
        },
      },
    });
    initializeGlobalHookRunner(registry);
    const runner = getGlobalHookRunner()!;

    // Fire repeated after_tool_call events to trigger anomaly.
    for (let i = 0; i < 3; i++) {
      await runner.runAfterToolCall(
        { toolName: "exec", params: { command: "echo hi" }, durationMs: 10 },
        { agentId: "test", sessionKey: "s1", toolName: "exec" },
      );
    }

    // Now a before_tool_call should be blocked by the anomaly detector.
    const result = await runner.runBeforeToolCall(
      { toolName: "exec", params: { command: "echo safe" } },
      { agentId: "test", sessionKey: "s1", toolName: "exec" },
    );

    expect(result).toBeDefined();
    expect(result!.block).toBe(true);
    expect(result!.blockReason).toContain("Anomaly");
  });
});
