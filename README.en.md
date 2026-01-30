# Moltbot Security Fix Package

> **Für die deutsche Version dieses Dokuments, siehe [README.md](README.md).**

This package fixes 6 security issues in the Moltbot Agent Security Layer.

## How Does the Security Guard Work?

Before we get to the fixes, here's a quick overview of how the protection works:

Moltbot has a **Command Guard** — a security layer that **checks every command before it is executed**. The guard has a list of rules. Each rule consists of a name, a search pattern (regex) and a reason.

**The built-in rules are:**

| Rule | Pattern | What gets blocked |
|------|---------|-------------------|
| `ordercli-confirm` | `ordercli\b.*--confirm` | Automatic confirmation of orders. The agent must not confirm orders on its own. |
| `ordercli-pay` | `ordercli\b.*--pay` | Automatic payment of orders. The agent must not trigger payments on its own. |
| `rm-rf-root` | `rm\s+-[rR]f\s+/(?:\s\|\*\|$)` | Recursive deletion from root (`/`). Prevents the agent from deleting the entire filesystem. |

**How the check works:**

```
Agent wants to execute a command
        |
+-------------------------------+
|  1. Normalize command         |  <-- Remove quote/variable tricks (Fix 2)
|  2. Check against rules       |  <-- Both original and normalized version
|  3. Anomaly check             |  <-- Detect unusual behavior (Fix 5)
+-------------------------------+
        |                |
    Allowed           Blocked
        |                |
  Command is         Command is NOT executed
  executed           + audit log entry (Fix 4)
```

Users can also define **custom rules** in the config:

```yaml
agents:
  defaults:
    safety:
      builtinRules: true    # Built-in rules active (default: true)
      rules:                # Add custom rules
        - name: "no-curl-upload"
          pattern: "curl.*--upload-file"
          reason: "Upload via curl is not allowed."
```

---

## What Gets Fixed?

### Fix 1 — `rm -rf /*` is not detected

**Problem:** The `rm-rf-root` rule only detects `rm -rf /` when followed by a space. The guard looks for the pattern `rm -rf / ` (with trailing space). But in practice nobody types a space after it — the command just ends, or is followed by `*`.

**Before — these commands are NOT detected:**
```bash
rm -rf /*         # Wildcard — deletes everything under /
rm -rf /          # Command ends directly — no space after it
```

**After — all variants are detected and blocked:**
```bash
rm -rf /          # Blocked: end of line detected
rm -rf /*         # Blocked: wildcard /* detected
rm -rf / foo      # Blocked: space detected (as before)
```

**What changed:** The search pattern was extended. Previously it only looked for a space after `/`. Now it also detects `/*` (wildcard) and end of command:
```
Before:  rm\s+-[rR]f\s+/\s           <-- space only
After:   rm\s+-[rR]f\s+/(?:\s|\*|$)  <-- space OR * OR end
```

---

### Fix 2 — Regex bypasses with quotes and variables

**Problem:** The shell (bash) interprets quotes and variables before executing a command. An attacker can exploit this to bypass the guard: they rewrite the dangerous command with tricks so the guard doesn't recognize it — but the shell still executes the same command.

**Before — these tricks bypass the guard:**
```bash
# Trick 1: Quotes in the middle of the command
ord"er"cli --confirm
# The guard looks for "ordercli" — but finds "ord"er"cli"
# The shell removes the quotes and executes: ordercli --confirm

# Trick 2: ANSI-C escape for space
ordercli$'\x20'--confirm
# The guard sees: ordercli$'\x20'--confirm (no match)
# The shell replaces $'\x20' with a space: ordercli --confirm

# Trick 3: Insert empty variable
rm -r${EMPTY}f /
# The guard sees: rm -r${EMPTY}f / (no match for "rm -rf")
# The shell replaces ${EMPTY} with nothing: rm -rf /
```

**After — all tricks are detected:**

The guard now normalizes every command **before** checking it. The normalization removes:
- All quotes (`"`, `'`)
- Variable references (`${VAR}`, `$VAR`)
- ANSI-C quoting (`$'\x20'`)
- Command substitutions (`$(...)`, `` `...` ``)
- Backslash escapes (`\x`)

Then the guard checks **both versions** — the original command and the normalized version. If either one matches a rule, it gets blocked.

```bash
ord"er"cli --confirm
# Original:     ord"er"cli --confirm     -> no match
# Normalized:   ordercli --confirm       -> MATCH -> Blocked!
```

---

### Fix 3 — `nodes` tool is not checked

**Problem:** The guard checks commands that come through the `exec` or `bash` tool. But Moltbot also has a `nodes` tool that can execute commands on remote machines (`action: "run"`). This tool is completely ignored by the guard — an agent can execute any command through it.

**Before — the nodes tool bypasses the guard:**
```
Agent calls tool "bash": ordercli --confirm
-> Guard checks -> Rule "ordercli-confirm" matches -> BLOCKED

Agent calls tool "nodes": action="run", rawCommand="ordercli --confirm"
-> Guard ignores "nodes" completely -> Command is executed
```

**After — all tools are checked:**

The guard now also recognizes the `nodes` tool. When `action: "run"`, the command is extracted from `rawCommand` (or `command`) and checked against **the same rules** as `exec` and `bash`:

```
Agent calls tool "nodes": action="run", rawCommand="ordercli --confirm"
-> Guard extracts "ordercli --confirm"
-> Rule "ordercli-confirm" matches -> BLOCKED

Agent calls tool "nodes": action="status"
-> No shell command, just a status query -> Not checked, allowed
```

Only `nodes` calls with `action: "run"` are checked. Other actions like `status`, `list` or `info` do not execute shell commands and are not blocked.

---

### Fix 4 — No audit trail for blocks

**Problem:** When the guard blocks a command, it only writes a log message to the console. On the next gateway restart the message is gone. An admin has no way to trace whether and when an agent attempted to execute dangerous commands.

**Before:**
```
Agent attempts: rm -rf /
-> Guard blocks the command
-> Console output: "Command blocked by rule rm-rf-root"
-> Gateway restarts
-> No trace left. Did something happen? Nobody knows.
```

**After — every block is permanently logged:**

Every blocked command is written to an audit file: `~/.clawdbot/security/audit.jsonl`

The file is in JSONL format (one JSON line per entry) and is append-only, never overwritten:

```json
{"ts":1706620800,"event":"command_blocked","toolName":"bash","command":"rm -rf /","ruleName":"rm-rf-root"}
{"ts":1706620815,"event":"command_blocked","toolName":"nodes","command":"ordercli --confirm","ruleName":"ordercli-confirm"}
{"ts":1706621000,"event":"anomaly_detected","anomalyType":"too_many_tool_calls","reason":"50 calls in 60s exceeds limit of 30"}
```

**What gets logged:**
- `ts` — Unix timestamp (when did it happen)
- `event` — Event type (`command_blocked`, `anomaly_detected`, `cost_limit_exceeded`)
- `toolName` — Which tool was used (`bash`, `exec`, `nodes`)
- `command` — The blocked command
- `ruleName` — Which rule was triggered

The file has restrictive permissions (owner read only, `0600`) and so does the directory (`0700`).

---

### Fix 5 — Anomaly detection does not block

**Problem:** In addition to the rule-based guard, there is an anomaly detector. It detects unusual behavior, e.g. when an agent makes unusually many tool calls in a short time. You can configure what should happen on anomaly: `"log"` (just log), `"warn"` (warn) or `"abort"` (stop). But even with `"abort"` the command is still executed — the abort mode never actually worked.

**Before — abort does not block:**
```yaml
# Configuration:
anomalyDetection:
  action: abort              # "abort" should block
  maxToolCallsPerMinute: 30
```
```
Agent makes 50 tool calls in one minute (limit: 30)
-> Anomaly detected!
-> Log message: "anomaly detected: too many tool calls"
-> Command is executed anyway    <-- Bug: abort does nothing
```

**After — abort actually blocks:**
```
Agent makes 50 tool calls in one minute (limit: 30)
-> Anomaly detected!
-> Log message: "anomaly detected: too many tool calls"
-> Audit log entry is written
-> Command is BLOCKED              <-- Now correct
```

**The three levels at a glance:**

| Level | What happens | Command |
|-------|-------------|---------|
| `action: "log"` | Only a debug log is written. No block, no warning. | Executed |
| `action: "warn"` | Warning in log + audit log entry. No block. | Executed |
| `action: "abort"` | Warning in log + audit log entry + **block**. | **NOT** executed |

---

### Fix 6 — Cost tracking is lost on restart

**Problem:** Moltbot can set a cost limit per agent run, per session, and per day (in USD). But the counters are only held in memory. On every gateway restart or crash, all counters start at $0.00 again. An agent can bypass its daily limit by simply restarting the gateway.

**Before — restart bypasses the limit:**
```
Daily limit: $5.00

Session 1: Agent spends $4.50
-> Gateway is restarted (or crashes)

Session 2: Counter is at $0.00   <-- Everything forgotten!
-> Agent can spend another $5.00
-> Actually spent: $9.50 — nearly double the limit
```

**After — counters survive restarts:**
```
Daily limit: $5.00

Session 1: Agent spends $4.50
-> Costs are saved to ~/.clawdbot/cost-tracking.json
-> Gateway is restarted

Session 2: Counter is loaded from file -> $4.50
-> Agent has $0.50 remaining
-> After $0.50 the run is aborted
```

**How does the reset work?**
- **Session counter:** Resets when a new session ID arrives (= the user starts a new conversation)
- **Daily counter:** Resets when the UTC date changes (= midnight UTC)
- **Run counter:** Resets to $0 on every new run (no persistence needed)

---

## Configuring Cost Limits

With Fix 6, costs are now persisted. For the tracking to take effect, you need to set limits in your Moltbot configuration.

**Configuration via CLI:**

```bash
moltbot config set agents.defaults.costLimits.perRun 0.50
moltbot config set agents.defaults.costLimits.perSession 2.00
moltbot config set agents.defaults.costLimits.perDay 5.00
moltbot config set agents.defaults.costLimits.action abort
```

**Or directly in the config file** (`~/.clawdbot/config.yaml`):

```yaml
agents:
  defaults:
    costLimits:
      perRun: 0.50       # Max USD per single agent run
      perSession: 2.00   # Max USD per session (across all runs)
      perDay: 5.00       # Max USD per day (UTC date)
      action: abort      # "abort" = stops the run, "warn" = warning only
```

**Fields (all optional — set only what you need):**

| Field | Type | Description |
|-------|------|-------------|
| `perRun` | Number (USD) | Maximum cost per single agent run. When exceeded, the run is stopped. |
| `perSession` | Number (USD) | Maximum cost across all runs in a session. Resets on new session ID. |
| `perDay` | Number (USD) | Maximum cost per calendar day (UTC). Resets automatically at midnight UTC. |
| `action` | `"abort"` or `"warn"` | What happens when a limit is reached. Default: `"abort"` (run is stopped). |

**Example — daily limit only:**

```yaml
agents:
  defaults:
    costLimits:
      perDay: 10.00
```

The agent can spend a maximum of $10 per day. After that, every further run is aborted until the next day (UTC midnight).

**Where are costs stored?**

The current counters are in `~/.clawdbot/cost-tracking.json`. This file is managed automatically — do not edit manually.

---

## Installation Guide

Choose the guide that matches your installation:

---

### I use the macOS app (Moltbot.app)

The macOS app runs a gateway process that executes JavaScript files from a local directory. The fix patches these files directly.

**Install:**

```bash
# 1. Download the fix
git clone https://github.com/provimedia/moltbot_security_fix.git
cd moltbot_security_fix

# 2. Find your Moltbot directory:
#    npm:      /usr/local/lib/node_modules/moltbot
#    Homebrew: $(brew --prefix)/lib/node_modules/moltbot
#    git:      ~/moltbot

# 3. Run the patch (adjust path!)
./patch-dist.sh /usr/local/lib/node_modules/moltbot

# 4. Restart the gateway
moltbot gateway restart
```

**Uninstall (restore original state):**

```bash
cd moltbot_security_fix
./unpatch-dist.sh /usr/local/lib/node_modules/moltbot
moltbot gateway restart
```

---

### I installed Moltbot via npm/pnpm globally

**Install:**

```bash
# 1. Download the fix
git clone https://github.com/provimedia/moltbot_security_fix.git
cd moltbot_security_fix

# 2. Run the patch
./patch-dist.sh /usr/local/lib/node_modules/moltbot

# 3. Restart the gateway
moltbot gateway restart
```

If you don't know where Moltbot is installed:
```bash
which moltbot
# or
npm list -g moltbot
```

**Uninstall (restore original state):**

```bash
cd moltbot_security_fix
./unpatch-dist.sh /usr/local/lib/node_modules/moltbot
moltbot gateway restart
```

---

### I cloned the Git repo (developer)

You have the source code and can rebuild.

**Install (Option A: install script, recommended):**

```bash
# 1. Download the fix
git clone https://github.com/provimedia/moltbot_security_fix.git
cd moltbot_security_fix

# 2. Copy TypeScript files into your repo
./install.sh ~/moltbot

# 3. Rebuild and test
cd ~/moltbot
pnpm build
pnpm test
```

**Install (Option B: Git patch):**

```bash
# 1. Switch to your Moltbot repo
cd ~/moltbot

# 2. Apply the patch
git apply ~/moltbot_security_fix/security-fix.patch

# 3. Rebuild and test
pnpm build
pnpm test
```

**Uninstall (restore original state):**

Option A:
```bash
cd moltbot_security_fix
./uninstall.sh ~/moltbot
cd ~/moltbot
pnpm build
```

Option B:
```bash
cd ~/moltbot
git apply -R ~/moltbot_security_fix/security-fix.patch
pnpm build
```

---

### I run a server / VPS (Linux)

**Install:**

```bash
# 1. Log into the server
ssh user@your-server

# 2. Download the fix
git clone https://github.com/provimedia/moltbot_security_fix.git
cd moltbot_security_fix

# 3a. For npm installations:
./patch-dist.sh /usr/lib/node_modules/moltbot

# 3b. For git clone installations:
./install.sh /path/to/moltbot
cd /path/to/moltbot && pnpm build

# 4. Restart the gateway
moltbot gateway restart
# or:
systemctl restart moltbot-gateway
```

If you don't know where Moltbot is installed:
```bash
which moltbot
```

**Uninstall (restore original state):**

```bash
cd moltbot_security_fix

# For npm installations:
./unpatch-dist.sh /usr/lib/node_modules/moltbot

# For git clone installations:
./uninstall.sh /path/to/moltbot
cd /path/to/moltbot && pnpm build

# Restart the gateway
moltbot gateway restart
```

---

### For maintainers: Sparkle app update (automatic for all users)

How to distribute the fix as an official macOS app update:

1. Merge the fix into the main repo
2. Bump the version in `package.json`
3. Build and notarize the app:
   ```bash
   scripts/package-mac-dist.sh
   ```
4. Generate the appcast:
   ```bash
   scripts/make_appcast.sh
   ```
5. Upload the release to GitHub
6. Push `appcast.xml` — Sparkle will automatically deliver the update to all users

---

## What's in the Package?

```
README.md                                      # This guide (German)
README.en.md                                   # This guide (English)
LICENSE                                        # GPL-3.0 license
install.sh                                     # Installs TypeScript sources
uninstall.sh                                   # Restores TypeScript originals
patch-dist.sh                                  # Patches compiled JS files
unpatch-dist.sh                                # Restores compiled JS originals
security-fix.patch                             # Git patch (for git apply)

src/                                           # TypeScript sources (11 files)
  security/dangerous-command-guard.ts          #   Fix 1 + 2
  security/dangerous-command-guard.test.ts     #   Tests
  security/register-builtin-guards.ts          #   Fix 3 + 4 + 5
  security/register-builtin-guards.test.ts     #   Tests
  security/anomaly-detector.ts                 #   Fix 5
  security/anomaly-detector.test.ts            #   Tests
  security/audit-log.ts                        #   Fix 4 (new)
  security/audit-log.test.ts                   #   Tests
  infra/cost-tracker.ts                        #   Fix 6 (new)
  infra/cost-tracker.test.ts                   #   Tests
  agents/pi-embedded-runner/run/attempt.ts     #   Fix 6

dist/                                          # Compiled JS files (6 files)
  security/dangerous-command-guard.js
  security/register-builtin-guards.js
  security/anomaly-detector.js
  security/audit-log.js
  infra/cost-tracker.js
  agents/pi-embedded-runner/run/attempt.js
```

## Verification

After installation (source installations with `pnpm` only):

```bash
pnpm vitest run \
  src/security/dangerous-command-guard.test.ts \
  src/security/anomaly-detector.test.ts \
  src/security/register-builtin-guards.test.ts \
  src/security/audit-log.test.ts \
  src/infra/cost-tracker.test.ts
```

All 84 tests must pass (0 failures).

---

## Disclaimer

**Installation and use of this package is at your own risk.**

The authors assume no liability for damages, data loss or outages caused by the installation, use or uninstallation of this package. It is recommended to create a full backup of the affected files before installation. The included install scripts automatically create `.bak` backups, but these do not replace a full system backup.

This package is provided "as is", without warranty of any kind, express or implied.

---

## License

This project is licensed under the [MIT License](LICENSE).

You are free to use, copy, modify, fork and redistribute this code — including for commercial purposes. The only requirement is that the copyright notice is preserved. See [LICENSE](LICENSE) for the full license text.
