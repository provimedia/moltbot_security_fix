import { describe, expect, it } from "vitest";

import {
  checkCommand,
  normalizeShellCommand,
  type DangerousCommandGuardConfig,
} from "./dangerous-command-guard.js";

describe("checkCommand", () => {
  describe("built-in rules", () => {
    it("blocks ordercli --confirm", () => {
      const result = checkCommand("ordercli order --confirm");
      expect(result.blocked).toBe(true);
      expect(result.ruleName).toBe("ordercli-confirm");
      expect(result.reason).toContain("ordercli --confirm");
    });

    it("blocks ordercli --pay", () => {
      const result = checkCommand("ordercli checkout --pay");
      expect(result.blocked).toBe(true);
      expect(result.ruleName).toBe("ordercli-pay");
      expect(result.reason).toContain("ordercli --pay");
    });

    it("blocks rm -rf / (root)", () => {
      const result = checkCommand("rm -rf / ");
      expect(result.blocked).toBe(true);
      expect(result.ruleName).toBe("rm-rf-root");
    });

    it("blocks rm -Rf / (root, uppercase R)", () => {
      const result = checkCommand("rm -Rf / ");
      expect(result.blocked).toBe(true);
      expect(result.ruleName).toBe("rm-rf-root");
    });

    it("blocks rm -rf /* (glob)", () => {
      const result = checkCommand("rm -rf /*");
      expect(result.blocked).toBe(true);
      expect(result.ruleName).toBe("rm-rf-root");
    });

    it("blocks rm -rf / at end of string (no trailing space)", () => {
      const result = checkCommand("rm -rf /");
      expect(result.blocked).toBe(true);
      expect(result.ruleName).toBe("rm-rf-root");
    });

    it("allows safe commands", () => {
      expect(checkCommand("ls -la").blocked).toBe(false);
      expect(checkCommand("echo hello").blocked).toBe(false);
      expect(checkCommand("npm install").blocked).toBe(false);
    });

    it("allows rm on non-root paths", () => {
      expect(checkCommand("rm -rf /tmp/test").blocked).toBe(false);
    });
  });

  describe("custom rules", () => {
    it("matches a custom rule", () => {
      const config: DangerousCommandGuardConfig = {
        rules: [
          {
            name: "no-deploy",
            pattern: "deploy\\s+--prod",
            reason: "Production deployment blocked.",
          },
        ],
      };
      const result = checkCommand("deploy --prod --force", config);
      expect(result.blocked).toBe(true);
      expect(result.ruleName).toBe("no-deploy");
      expect(result.reason).toBe("Production deployment blocked.");
    });

    it("uses default reason when custom rule has no reason", () => {
      const config: DangerousCommandGuardConfig = {
        rules: [{ name: "no-drop", pattern: "DROP\\s+TABLE" }],
      };
      const result = checkCommand("DROP TABLE users", config);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('blocked by safety rule "no-drop"');
    });
  });

  describe("builtinRules=false", () => {
    it("disables all built-in rules", () => {
      const config: DangerousCommandGuardConfig = { builtinRules: false };
      expect(checkCommand("ordercli order --confirm", config).blocked).toBe(false);
      expect(checkCommand("ordercli checkout --pay", config).blocked).toBe(false);
      expect(checkCommand("rm -rf / ", config).blocked).toBe(false);
    });

    it("still applies custom rules when builtins are disabled", () => {
      const config: DangerousCommandGuardConfig = {
        builtinRules: false,
        rules: [{ name: "no-sudo", pattern: "^sudo " }],
      };
      expect(checkCommand("sudo rm -rf /tmp", config).blocked).toBe(true);
    });
  });

  it("skips rules with invalid regex patterns", () => {
    const config: DangerousCommandGuardConfig = {
      rules: [{ name: "bad-regex", pattern: "[invalid" }],
    };
    // Should not throw, and should not block.
    expect(checkCommand("anything", config).blocked).toBe(false);
  });
});

describe("normalizeShellCommand", () => {
  it("strips double quotes", () => {
    expect(normalizeShellCommand('ord"er"cli --confirm')).toBe("ordercli --confirm");
  });

  it("strips single quotes", () => {
    expect(normalizeShellCommand("ord'er'cli --pay")).toBe("ordercli --pay");
  });

  it("removes $(...) command substitutions", () => {
    expect(normalizeShellCommand("$(echo rm) -rf /")).toBe("-rf /");
  });

  it("removes backtick command substitutions", () => {
    expect(normalizeShellCommand("`echo rm` -rf /")).toBe("-rf /");
  });

  it("removes ANSI-C quoting $'...'", () => {
    expect(normalizeShellCommand("ordercli$'\\x20'--confirm")).toBe("ordercli--confirm");
  });

  it("removes ${VAR} and $VAR references", () => {
    expect(normalizeShellCommand("ordercli${FOO} --confirm $BAR")).toBe("ordercli --confirm");
  });
});

describe("checkCommand with normalization bypass attempts", () => {
  it("blocks ordercli with embedded quotes", () => {
    const result = checkCommand('ord"er"cli --confirm');
    expect(result.blocked).toBe(true);
    expect(result.ruleName).toBe("ordercli-confirm");
  });

  it("blocks ordercli with ANSI-C quoting bypass", () => {
    const result = checkCommand("ordercli$'\\x20'--confirm");
    expect(result.blocked).toBe(true);
    expect(result.ruleName).toBe("ordercli-confirm");
  });
});
