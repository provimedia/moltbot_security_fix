import { checkCommand } from "./dangerous-command-guard.js";
import { createAnomalyDetector, } from "./anomaly-detector.js";
import { appendAuditEntry } from "./audit-log.js";
/**
 * Extract the command string from a tool-call event, supporting exec, bash,
 * and nodes (action: "run") tools.
 */
function extractCommandFromEvent(event) {
    const { toolName, params } = event;
    if (toolName === "exec" || toolName === "bash") {
        if (typeof params.command === "string")
            return params.command;
        if (typeof params.input === "string")
            return params.input;
        return "";
    }
    if (toolName === "nodes" && params.action === "run") {
        if (typeof params.rawCommand === "string")
            return params.rawCommand;
        if (typeof params.command === "string")
            return params.command;
        if (Array.isArray(params.command))
            return params.command.join(" ");
        return "";
    }
    return "";
}
/**
 * Create hook handlers for the built-in security guards.
 * These are designed to be registered in the plugin hook system so they run
 * alongside any user-defined plugin hooks.
 */
export function createBuiltinGuardHooks(config) {
    const safety = config?.agents?.defaults?.safety;
    const guardConfig = {
        builtinRules: safety?.builtinRules !== false,
        rules: safety?.rules,
    };
    const anomalyConfig = config?.agents?.defaults?.anomalyDetection;
    let anomalyDetector;
    if (anomalyConfig?.enabled) {
        anomalyDetector = createAnomalyDetector(anomalyConfig);
    }
    return {
        before_tool_call(event, _ctx) {
            // Check exec/bash/nodes(run) tool calls for dangerous commands.
            const command = extractCommandFromEvent(event);
            if (command) {
                const result = checkCommand(command, guardConfig);
                if (result.blocked) {
                    appendAuditEntry({
                        ts: Date.now(),
                        event: "command_blocked",
                        toolName: event.toolName,
                        command,
                        ruleName: result.ruleName,
                        reason: result.reason,
                    });
                    return {
                        block: true,
                        blockReason: result.reason,
                    };
                }
            }
            // Anomaly detection enforcement (abort mode).
            if (anomalyDetector) {
                const anomalyBlock = anomalyDetector.shouldBlock();
                if (anomalyBlock.block) {
                    appendAuditEntry({
                        ts: Date.now(),
                        event: "anomaly_detected",
                        toolName: event.toolName,
                        reason: anomalyBlock.reason,
                    });
                    return {
                        block: true,
                        blockReason: anomalyBlock.reason,
                    };
                }
            }
        },
        after_tool_call(event, _ctx) {
            if (!anomalyDetector)
                return;
            anomalyDetector.recordToolCall({
                toolName: event.toolName,
                params: event.params,
                error: event.error,
            });
        },
    };
}
