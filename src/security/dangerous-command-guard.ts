import type { DangerousCommandRule } from "../config/types.agent-defaults.js";

export type DangerousCommandGuardConfig = {
  /** Enable built-in blocking rules. Default: true. */
  builtinRules?: boolean;
  /** Custom blocking rules. */
  rules?: DangerousCommandRule[];
};

export type GuardResult = {
  blocked: boolean;
  reason?: string;
  ruleName?: string;
};

/**
 * Built-in rules that protect against dangerous automated commands.
 * These are always active when `builtinRules` is true (the default).
 */
const BUILTIN_RULES: DangerousCommandRule[] = [
  {
    name: "ordercli-confirm",
    pattern: "ordercli\\b.*--confirm",
    reason:
      "Blocked: ordercli --confirm requires explicit user approval. " +
      "The agent cannot auto-confirm food orders.",
  },
  {
    name: "ordercli-pay",
    pattern: "ordercli\\b.*--pay",
    reason:
      "Blocked: ordercli --pay requires explicit user approval. " +
      "The agent cannot auto-pay for orders.",
  },
  {
    name: "rm-rf-root",
    pattern: "rm\\s+-[rR]f\\s+/(?:\\s|\\*|$)",
    reason: "Blocked: recursive delete from root is not allowed.",
  },
];

/**
 * Normalize a shell command string to defeat regex-bypass tricks
 * (quote insertion, variable references, backslash-escapes, ANSI-C quoting,
 * and command substitution).
 */
export function normalizeShellCommand(cmd: string): string {
  let s = cmd;
  // Remove command substitutions: $(...) and `...`
  s = s.replace(/\$\([^)]*\)/g, "");
  s = s.replace(/`[^`]*`/g, "");
  // Remove ANSI-C quoting: $'...'
  s = s.replace(/\$'[^']*'/g, "");
  // Strip double and single quotes (e.g. ord"er"cli → ordercli)
  s = s.replace(/["']/g, "");
  // Remove ${VAR} and $VAR references
  s = s.replace(/\$\{[^}]*\}/g, "");
  s = s.replace(/\$[A-Za-z_]\w*/g, "");
  // Remove backslash-escapes
  s = s.replace(/\\./g, "");
  // Normalize whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Check a command string against all active guard rules.
 */
export function checkCommand(command: string, config?: DangerousCommandGuardConfig): GuardResult {
  const builtinEnabled = config?.builtinRules !== false;
  const customRules = config?.rules ?? [];

  const allRules = [...(builtinEnabled ? BUILTIN_RULES : []), ...customRules];

  const normalized = normalizeShellCommand(command);

  for (const rule of allRules) {
    try {
      const regex = new RegExp(rule.pattern, "i");
      if (regex.test(command) || regex.test(normalized)) {
        return {
          blocked: true,
          reason: rule.reason ?? `Command blocked by safety rule "${rule.name}": ${command}`,
          ruleName: rule.name,
        };
      }
    } catch {
      // Invalid regex in config — skip silently.
    }
  }

  return { blocked: false };
}
