import { createSubsystemLogger } from "../logging/subsystem.js";
import { appendAuditEntry } from "./audit-log.js";
const log = createSubsystemLogger("security/anomaly");
/**
 * Create an anomaly detector that monitors tool call patterns for suspicious
 * behavior (repetitive loops, bursts, excessive navigation, error loops).
 */
export function createAnomalyDetector(config) {
    const maxRepeatCalls = config.maxRepeatCalls ?? 10;
    const maxBrowserNavigations = config.maxBrowserNavigations ?? 50;
    const burstWindowMs = config.burstWindowMs ?? 60_000;
    const maxBurstCalls = config.maxBurstCalls ?? 30;
    const action = config.action ?? "log";
    // State tracking.
    let lastToolKey = "";
    let repeatCount = 0;
    let browserNavCount = 0;
    let lastErrorKey = "";
    let errorRepeatCount = 0;
    const callTimestamps = [];
    const anomalies = [];
    function emitAnomaly(event) {
        anomalies.push(event);
        if (action === "log") {
            log.debug(`Anomaly detected [${event.type}]: ${event.message}`);
        }
        else if (action === "warn" || action === "abort") {
            log.warn(`Anomaly detected [${event.type}]: ${event.message}`);
            appendAuditEntry({
                ts: Date.now(),
                event: "anomaly_detected",
                toolName: event.toolName,
                anomalyType: event.type,
                reason: event.message,
            });
        }
        return event;
    }
    function buildToolKey(toolName, params) {
        try {
            return `${toolName}:${JSON.stringify(params)}`;
        }
        catch {
            return toolName;
        }
    }
    function recordToolCall(call) {
        const now = Date.now();
        const toolKey = buildToolKey(call.toolName, call.params);
        // --- Repeat-loop detection ---
        if (toolKey === lastToolKey) {
            repeatCount += 1;
            if (repeatCount >= maxRepeatCalls) {
                const event = emitAnomaly({
                    type: "repeat-loop",
                    message: `Tool "${call.toolName}" called ${repeatCount} times with identical params`,
                    toolName: call.toolName,
                });
                repeatCount = 0;
                return event;
            }
        }
        else {
            lastToolKey = toolKey;
            repeatCount = 1;
        }
        // --- Burst detection ---
        callTimestamps.push(now);
        // Prune timestamps outside the window.
        while (callTimestamps.length > 0 && callTimestamps[0] < now - burstWindowMs) {
            callTimestamps.shift();
        }
        if (callTimestamps.length >= maxBurstCalls) {
            const event = emitAnomaly({
                type: "burst",
                message: `${callTimestamps.length} tool calls in ${burstWindowMs}ms window`,
                toolName: call.toolName,
            });
            callTimestamps.length = 0;
            return event;
        }
        // --- Excessive browser navigation ---
        if (call.toolName === "browser" && extractBrowserAction(call.params) === "navigate") {
            browserNavCount += 1;
            if (browserNavCount >= maxBrowserNavigations) {
                const event = emitAnomaly({
                    type: "excessive-navigation",
                    message: `Browser navigate called ${browserNavCount} times`,
                    toolName: call.toolName,
                });
                browserNavCount = 0;
                return event;
            }
        }
        // --- Error-loop detection ---
        if (call.error) {
            const errorKey = `${call.toolName}:${call.error}`;
            if (errorKey === lastErrorKey) {
                errorRepeatCount += 1;
                if (errorRepeatCount >= maxRepeatCalls) {
                    const event = emitAnomaly({
                        type: "error-loop",
                        message: `Tool "${call.toolName}" failed ${errorRepeatCount} times with same error`,
                        toolName: call.toolName,
                    });
                    errorRepeatCount = 0;
                    return event;
                }
            }
            else {
                lastErrorKey = errorKey;
                errorRepeatCount = 1;
            }
        }
        else {
            lastErrorKey = "";
            errorRepeatCount = 0;
        }
        return undefined;
    }
    function shouldBlock() {
        if (action !== "abort")
            return { block: false };
        if (anomalies.length === 0)
            return { block: false };
        const latest = anomalies[anomalies.length - 1];
        return {
            block: true,
            reason: `Anomaly abort [${latest.type}]: ${latest.message}`,
        };
    }
    return {
        recordToolCall,
        getAnomalies: () => [...anomalies],
        shouldBlock,
    };
}
function extractBrowserAction(params) {
    if (typeof params.action === "string")
        return params.action.toLowerCase();
    return undefined;
}
