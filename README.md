# Moltbot Security Fix Package

Dieses Paket behebt 6 Sicherheitsprobleme im Moltbot Agent Security Layer.

## Wie funktioniert der Security Guard?

Bevor wir zu den Fixes kommen, kurz erklärt wie der Schutz funktioniert:

Moltbot hat einen **Command Guard** — eine Schutzschicht die **jeden Befehl prüft bevor er ausgeführt wird**. Der Guard hat eine Liste von Regeln. Jede Regel besteht aus einem Namen, einem Suchmuster (Regex) und einer Begründung.

**Die eingebauten Regeln sind:**

| Regel | Suchmuster | Was wird geblockt |
|-------|------------|-------------------|
| `ordercli-confirm` | `ordercli\b.*--confirm` | Automatisches Bestätigen von Bestellungen. Der Agent darf keine Bestellungen eigenständig bestätigen. |
| `ordercli-pay` | `ordercli\b.*--pay` | Automatisches Bezahlen von Bestellungen. Der Agent darf keine Zahlungen eigenständig auslösen. |
| `rm-rf-root` | `rm\s+-[rR]f\s+/(?:\s\|\*\|$)` | Rekursives Löschen ab Root (`/`). Verhindert dass der Agent das gesamte Dateisystem löscht. |

**So läuft die Prüfung ab:**

```
Agent will Befehl ausführen
        ↓
┌─────────────────────────────┐
│  1. Befehl normalisieren    │  ← Tricks mit Quotes/Variablen entfernen (Fix 2)
│  2. Gegen Regeln prüfen     │  ← Sowohl Original als auch normalisierte Version
│  3. Anomaly-Check           │  ← Ungewöhnliches Verhalten erkennen (Fix 5)
└─────────────────────────────┘
        ↓                ↓
    Erlaubt           Geblockt
        ↓                ↓
  Befehl wird       Befehl wird NICHT ausgeführt
  ausgeführt        + Audit-Log Eintrag (Fix 4)
```

Nutzer können zusätzlich **eigene Regeln** in der Config definieren:

```yaml
agents:
  defaults:
    safety:
      builtinRules: true    # Eingebaute Regeln aktiv (Standard: true)
      rules:                # Eigene Regeln hinzufügen
        - name: "no-curl-upload"
          pattern: "curl.*--upload-file"
          reason: "Upload per curl ist nicht erlaubt."
```

---

## Was wird gefixt?

### Fix 1 — `rm -rf /*` wird nicht erkannt

**Problem:** Die Regel `rm-rf-root` erkennt `rm -rf /` nur wenn danach ein Leerzeichen folgt. Der Guard sucht nach dem Muster `rm -rf / ` (mit Leerzeichen am Ende). Aber in der Praxis schreibt niemand ein Leerzeichen danach — der Befehl endet einfach, oder es folgt ein `*`.

**Vorher — diese Befehle werden NICHT erkannt:**
```bash
rm -rf /*         # Wildcard — löscht alles unter /
rm -rf /          # Befehl endet direkt — kein Leerzeichen danach
```

**Nachher — alle Varianten werden erkannt und geblockt:**
```bash
rm -rf /          # Geblockt: Zeilenende erkannt
rm -rf /*         # Geblockt: Wildcard /* erkannt
rm -rf / foo      # Geblockt: Leerzeichen erkannt (wie vorher)
```

**Was wurde geändert:** Das Suchmuster wurde erweitert. Vorher hat es nur nach einem Leerzeichen nach dem `/` gesucht. Jetzt erkennt es auch `/*` (Wildcard) und das Ende des Befehls:
```
Vorher:  rm\s+-[rR]f\s+/\s           ← nur Leerzeichen
Nachher: rm\s+-[rR]f\s+/(?:\s|\*|$)  ← Leerzeichen ODER * ODER Ende
```

---

### Fix 2 — Regex-Bypasses mit Quotes und Variablen

**Problem:** Die Shell (Bash) interpretiert Quotes und Variablen bevor sie einen Befehl ausführt. Ein Angreifer kann das ausnutzen um den Guard zu umgehen: Er schreibt den gefährlichen Befehl mit Tricks so um, dass der Guard ihn nicht erkennt — die Shell aber trotzdem den gleichen Befehl ausführt.

**Vorher — diese Tricks umgehen den Guard:**
```bash
# Trick 1: Quotes mitten im Befehl
ord"er"cli --confirm
# Der Guard sucht nach "ordercli" — findet aber "ord"er"cli"
# Die Shell entfernt die Quotes und führt aus: ordercli --confirm

# Trick 2: ANSI-C Escape für Leerzeichen
ordercli$'\x20'--confirm
# Der Guard sieht: ordercli$'\x20'--confirm (kein Match)
# Die Shell ersetzt $'\x20' durch ein Leerzeichen: ordercli --confirm

# Trick 3: Leere Variable einfügen
rm -r${LEER}f /
# Der Guard sieht: rm -r${LEER}f / (kein Match für "rm -rf")
# Die Shell ersetzt ${LEER} durch nichts: rm -rf /
```

**Nachher — alle Tricks werden erkannt:**

Der Guard normalisiert jetzt jeden Befehl **bevor** er ihn prüft. Die Normalisierung entfernt:
- Alle Quotes (`"`, `'`)
- Variablen-Referenzen (`${VAR}`, `$VAR`)
- ANSI-C Quoting (`$'\x20'`)
- Command-Substitutionen (`$(...)`, `` `...` ``)
- Backslash-Escapes (`\x`)

Dann prüft der Guard **beide Versionen** — den Originalbefehl und die normalisierte Version. Wenn eine von beiden gegen eine Regel verstößt, wird geblockt.

```bash
ord"er"cli --confirm
# Original:     ord"er"cli --confirm     → kein Match
# Normalisiert: ordercli --confirm       → MATCH → Geblockt!
```

---

### Fix 3 — `nodes`-Tool wird nicht geprüft

**Problem:** Der Guard prüft Befehle die über das `exec`- oder `bash`-Tool kommen. Aber Moltbot hat auch ein `nodes`-Tool, mit dem man auf entfernten Rechnern Befehle ausführen kann (`action: "run"`). Dieses Tool wird vom Guard komplett ignoriert — ein Agent kann darüber jeden beliebigen Befehl ausführen.

**Vorher — das nodes-Tool umgeht den Guard:**
```
Agent ruft Tool "bash" auf: ordercli --confirm
→ Guard prüft → Regel "ordercli-confirm" matcht → GEBLOCKT ✓

Agent ruft Tool "nodes" auf: action="run", rawCommand="ordercli --confirm"
→ Guard ignoriert "nodes" komplett → Befehl wird ausgeführt ✗
```

**Nachher — alle Tools werden geprüft:**

Der Guard erkennt jetzt auch das `nodes`-Tool. Wenn `action: "run"` ist, wird der Befehl aus `rawCommand` (oder `command`) extrahiert und gegen **dieselben Regeln** geprüft wie bei `exec` und `bash`:

```
Agent ruft Tool "nodes" auf: action="run", rawCommand="ordercli --confirm"
→ Guard extrahiert "ordercli --confirm"
→ Regel "ordercli-confirm" matcht → GEBLOCKT ✓

Agent ruft Tool "nodes" auf: action="status"
→ Kein Shell-Befehl, nur Status-Abfrage → Nicht geprüft, durchgelassen ✓
```

Geprüft werden `nodes`-Aufrufe **nur** wenn `action: "run"` ist. Andere Actions wie `status`, `list` oder `info` führen keine Shell-Befehle aus und werden nicht blockiert.

---

### Fix 4 — Kein Audit-Trail bei Blocks

**Problem:** Wenn der Guard einen Befehl blockt, wird das nur als Log-Meldung in die Konsole geschrieben. Beim nächsten Neustart des Gateway ist die Meldung weg. Ein Admin hat keine Möglichkeit nachzuvollziehen ob und wann ein Agent versucht hat gefährliche Befehle auszuführen.

**Vorher:**
```
Agent versucht: rm -rf /
→ Guard blockt den Befehl
→ Konsolenausgabe: "Command blocked by rule rm-rf-root"
→ Gateway wird neu gestartet
→ Keine Spur mehr. War da was? Niemand weiß es.
```

**Nachher — jeder Block wird dauerhaft protokolliert:**

Jeder geblockte Befehl wird in eine Audit-Datei geschrieben: `~/.clawdbot/security/audit.jsonl`

Die Datei ist im JSONL-Format (eine JSON-Zeile pro Eintrag) und wird nur angehängt, nie überschrieben:

```json
{"ts":1706620800,"event":"command_blocked","toolName":"bash","command":"rm -rf /","ruleName":"rm-rf-root"}
{"ts":1706620815,"event":"command_blocked","toolName":"nodes","command":"ordercli --confirm","ruleName":"ordercli-confirm"}
{"ts":1706621000,"event":"anomaly_detected","anomalyType":"too_many_tool_calls","reason":"50 calls in 60s exceeds limit of 30"}
```

**Was wird protokolliert:**
- `ts` — Unix-Zeitstempel (wann war es)
- `event` — Art des Events (`command_blocked`, `anomaly_detected`, `cost_limit_exceeded`)
- `toolName` — Welches Tool wurde verwendet (`bash`, `exec`, `nodes`)
- `command` — Der geblockte Befehl
- `ruleName` — Welche Regel hat gegriffen

Die Datei hat restriktive Berechtigungen (nur der Besitzer kann lesen, `0600`) und das Verzeichnis ebenfalls (`0700`).

---

### Fix 5 — Anomaly-Erkennung blockt nicht

**Problem:** Neben dem regelbasierten Guard gibt es einen Anomaly Detector. Er erkennt ungewöhnliches Verhalten, z.B. wenn ein Agent ungewöhnlich viele Tool-Calls in kurzer Zeit macht. Man kann konfigurieren was bei einer Anomaly passieren soll: `"log"` (nur protokollieren), `"warn"` (warnen) oder `"abort"` (abbrechen). Aber selbst bei `"abort"` wird der Befehl trotzdem ausgeführt — der Abort-Modus hat nie wirklich funktioniert.

**Vorher — abort blockt nicht:**
```yaml
# Konfiguration:
anomalyDetection:
  action: abort              # "abort" sollte blocken
  maxToolCallsPerMinute: 30
```
```
Agent macht 50 Tool-Calls in einer Minute (Limit: 30)
→ Anomaly erkannt!
→ Log-Meldung: "anomaly detected: too many tool calls"
→ Befehl wird trotzdem ausgeführt    ← Bug: abort tut nichts
```

**Nachher — abort blockt tatsächlich:**
```
Agent macht 50 Tool-Calls in einer Minute (Limit: 30)
→ Anomaly erkannt!
→ Log-Meldung: "anomaly detected: too many tool calls"
→ Audit-Log Eintrag wird geschrieben
→ Befehl wird GEBLOCKT                ← Jetzt korrekt
```

**Die drei Stufen im Überblick:**

| Stufe | Was passiert | Befehl |
|-------|-------------|--------|
| `action: "log"` | Nur ein Debug-Log wird geschrieben. Kein Block, keine Warnung. | Wird ausgeführt |
| `action: "warn"` | Warnung im Log + Eintrag im Audit-Log. Kein Block. | Wird ausgeführt |
| `action: "abort"` | Warnung im Log + Eintrag im Audit-Log + **Block**. | Wird **NICHT** ausgeführt |

---

### Fix 6 — Kosten-Tracking geht bei Neustart verloren

**Problem:** Moltbot kann pro Agent-Run, pro Session und pro Tag ein Kostenlimit setzen (in USD). Aber die Zähler werden nur im Arbeitsspeicher gehalten. Bei jedem Gateway-Neustart oder Absturz fangen alle Zähler wieder bei $0.00 an. Ein Agent kann sein Tageslimit umgehen indem er einfach den Gateway neu startet.

**Vorher — Neustart umgeht das Limit:**
```
Tageslimit: $5.00

Session 1: Agent verbraucht $4.50
→ Gateway wird neu gestartet (oder stürzt ab)

Session 2: Zähler steht bei $0.00   ← Alles vergessen!
→ Agent kann weitere $5.00 ausgeben
→ Tatsächlich verbraucht: $9.50 — fast das Doppelte des Limits
```

**Nachher — Zähler überleben Neustarts:**
```
Tageslimit: $5.00

Session 1: Agent verbraucht $4.50
→ Kosten werden in ~/.clawdbot/cost-tracking.json gespeichert
→ Gateway wird neu gestartet

Session 2: Zähler wird aus Datei geladen → $4.50
→ Agent hat noch $0.50 übrig
→ Nach $0.50 wird der Run abgebrochen
```

**Wie funktioniert der Reset?**
- **Session-Zähler:** Wird zurückgesetzt wenn eine neue Session-ID kommt (= der Nutzer startet eine neue Konversation)
- **Tages-Zähler:** Wird zurückgesetzt wenn sich das UTC-Datum ändert (= Mitternacht UTC)
- **Run-Zähler:** Wird bei jedem neuen Run auf $0 gesetzt (kein Speicherbedarf)

---

## Kostenlimits konfigurieren

Mit Fix 6 werden Kosten jetzt persistent gespeichert. Damit das Tracking greift, musst du Limits in deiner Moltbot-Konfiguration hinterlegen.

**Konfiguration per CLI:**

```bash
moltbot config set agents.defaults.costLimits.perRun 0.50
moltbot config set agents.defaults.costLimits.perSession 2.00
moltbot config set agents.defaults.costLimits.perDay 5.00
moltbot config set agents.defaults.costLimits.action abort
```

**Oder direkt in der Config-Datei** (`~/.clawdbot/config.yaml`):

```yaml
agents:
  defaults:
    costLimits:
      perRun: 0.50       # Max USD pro einzelnem Agent-Run
      perSession: 2.00   # Max USD pro Session (über alle Runs)
      perDay: 5.00       # Max USD pro Tag (UTC-Datum)
      action: abort      # "abort" = stoppt den Run, "warn" = nur Warnung
```

**Felder (alle optional — setze nur was du brauchst):**

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `perRun` | Zahl (USD) | Maximale Kosten pro einzelnem Agent-Run. Wird der Wert überschritten, stoppt der Run. |
| `perSession` | Zahl (USD) | Maximale Kosten über alle Runs einer Session hinweg. Wird bei neuer Session-ID zurückgesetzt. |
| `perDay` | Zahl (USD) | Maximale Kosten pro Kalendertag (UTC). Wird um Mitternacht UTC automatisch zurückgesetzt. |
| `action` | `"abort"` oder `"warn"` | Was passiert wenn ein Limit erreicht wird. Standard: `"abort"` (Run wird gestoppt). |

**Beispiel — nur Tageslimit:**

```yaml
agents:
  defaults:
    costLimits:
      perDay: 10.00
```

Der Agent kann pro Tag maximal $10 ausgeben. Danach wird jeder weitere Run abgebrochen bis zum nächsten Tag (UTC Mitternacht).

**Wo werden die Kosten gespeichert?**

Die aktuellen Zähler liegen in `~/.clawdbot/cost-tracking.json`. Diese Datei wird automatisch verwaltet — nicht manuell bearbeiten.

---

## Installationsanleitung

Wähle die Anleitung die zu deiner Installation passt:

---

### Ich nutze die macOS App (Moltbot.app)

Die macOS App startet einen Gateway-Prozess der JavaScript-Dateien aus einem lokalen Verzeichnis ausführt. Der Fix patcht diese Dateien direkt.

**Installieren:**

```bash
# 1. Fix herunterladen
git clone https://github.com/provimedia/moltbot_security_fix.git
cd moltbot_security_fix

# 2. Finde dein Moltbot-Verzeichnis:
#    npm:      /usr/local/lib/node_modules/moltbot
#    Homebrew: $(brew --prefix)/lib/node_modules/moltbot
#    git:      ~/moltbot

# 3. Patch ausführen (Pfad anpassen!)
./patch-dist.sh /usr/local/lib/node_modules/moltbot

# 4. Gateway neu starten
moltbot gateway restart
```

**Deinstallieren (Originalzustand wiederherstellen):**

```bash
cd moltbot_security_fix
./unpatch-dist.sh /usr/local/lib/node_modules/moltbot
moltbot gateway restart
```

---

### Ich habe Moltbot per npm/pnpm global installiert

**Installieren:**

```bash
# 1. Fix herunterladen
git clone https://github.com/provimedia/moltbot_security_fix.git
cd moltbot_security_fix

# 2. Patch ausführen
./patch-dist.sh /usr/local/lib/node_modules/moltbot

# 3. Gateway neu starten
moltbot gateway restart
```

Falls du nicht weißt wo Moltbot installiert ist:
```bash
which moltbot
# oder
npm list -g moltbot
```

**Deinstallieren (Originalzustand wiederherstellen):**

```bash
cd moltbot_security_fix
./unpatch-dist.sh /usr/local/lib/node_modules/moltbot
moltbot gateway restart
```

---

### Ich habe das Git-Repo geklont (Entwickler)

Du hast den Quellcode und kannst neu bauen.

**Installieren (Variante A: Install-Script, empfohlen):**

```bash
# 1. Fix herunterladen
git clone https://github.com/provimedia/moltbot_security_fix.git
cd moltbot_security_fix

# 2. TypeScript-Dateien in dein Repo kopieren
./install.sh ~/moltbot

# 3. Neu bauen und testen
cd ~/moltbot
pnpm build
pnpm test
```

**Installieren (Variante B: Git-Patch):**

```bash
# 1. In dein Moltbot-Repo wechseln
cd ~/moltbot

# 2. Patch anwenden
git apply ~/moltbot_security_fix/security-fix.patch

# 3. Neu bauen und testen
pnpm build
pnpm test
```

**Deinstallieren (Originalzustand wiederherstellen):**

Bei Variante A:
```bash
cd moltbot_security_fix
./uninstall.sh ~/moltbot
cd ~/moltbot
pnpm build
```

Bei Variante B:
```bash
cd ~/moltbot
git apply -R ~/moltbot_security_fix/security-fix.patch
pnpm build
```

---

### Ich betreibe einen Server / VPS (Linux)

**Installieren:**

```bash
# 1. Auf dem Server einloggen
ssh user@dein-server

# 2. Fix herunterladen
git clone https://github.com/provimedia/moltbot_security_fix.git
cd moltbot_security_fix

# 3a. Bei npm-Installation:
./patch-dist.sh /usr/lib/node_modules/moltbot

# 3b. Bei Git-Clone-Installation:
./install.sh /pfad/zu/moltbot
cd /pfad/zu/moltbot && pnpm build

# 4. Gateway neu starten
moltbot gateway restart
# oder:
systemctl restart moltbot-gateway
```

Falls du nicht weißt wo Moltbot installiert ist:
```bash
which moltbot
```

**Deinstallieren (Originalzustand wiederherstellen):**

```bash
cd moltbot_security_fix

# Bei npm-Installation:
./unpatch-dist.sh /usr/lib/node_modules/moltbot

# Bei Git-Clone-Installation:
./uninstall.sh /pfad/zu/moltbot
cd /pfad/zu/moltbot && pnpm build

# Gateway neu starten
moltbot gateway restart
```

---

### Für Maintainer: Sparkle App Update (automatisch an alle Nutzer)

So verteilst du den Fix als offizielles macOS-App-Update:

1. Fix ins Haupt-Repo mergen
2. Version in `package.json` hochzählen
3. App bauen und notarisieren:
   ```bash
   scripts/package-mac-dist.sh
   ```
4. Appcast generieren:
   ```bash
   scripts/make_appcast.sh
   ```
5. Release auf GitHub hochladen
6. `appcast.xml` pushen — Sparkle liefert das Update automatisch an alle Nutzer aus

---

## Was ist im Paket enthalten?

```
README.md                                      # Diese Anleitung
install.sh                                     # Installiert TypeScript-Quellen
uninstall.sh                                   # Stellt TypeScript-Originale wieder her
patch-dist.sh                                  # Patcht kompilierte JS-Dateien
unpatch-dist.sh                                # Stellt kompilierte JS-Originale wieder her
security-fix.patch                             # Git-Patch (für git apply)

src/                                           # TypeScript-Quellen (11 Dateien)
  security/dangerous-command-guard.ts          #   Fix 1 + 2
  security/dangerous-command-guard.test.ts     #   Tests
  security/register-builtin-guards.ts          #   Fix 3 + 4 + 5
  security/register-builtin-guards.test.ts     #   Tests
  security/anomaly-detector.ts                 #   Fix 5
  security/anomaly-detector.test.ts            #   Tests
  security/audit-log.ts                        #   Fix 4 (neu)
  security/audit-log.test.ts                   #   Tests
  infra/cost-tracker.ts                        #   Fix 6 (neu)
  infra/cost-tracker.test.ts                   #   Tests
  agents/pi-embedded-runner/run/attempt.ts     #   Fix 6

dist/                                          # Kompilierte JS-Dateien (6 Dateien)
  security/dangerous-command-guard.js
  security/register-builtin-guards.js
  security/anomaly-detector.js
  security/audit-log.js
  infra/cost-tracker.js
  agents/pi-embedded-runner/run/attempt.js
```

## Prüfung / Verifikation

Nach der Installation (nur bei Source-Installationen mit `pnpm`):

```bash
pnpm vitest run \
  src/security/dangerous-command-guard.test.ts \
  src/security/anomaly-detector.test.ts \
  src/security/register-builtin-guards.test.ts \
  src/security/audit-log.test.ts \
  src/infra/cost-tracker.test.ts
```

Alle 84 Tests müssen bestehen (0 Failures).
