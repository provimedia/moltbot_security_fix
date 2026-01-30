# Moltbot Security Fix Package

Dieses Paket behebt 6 Sicherheitsprobleme im Moltbot Agent Security Layer.

## Was wird gefixt?

### Fix 1 — `rm -rf /*` wird nicht erkannt

**Problem:** Der Command Guard erkennt `rm -rf /` nur wenn danach ein Leerzeichen folgt. Varianten wie `rm -rf /*` oder `rm -rf /` am Zeilenende werden durchgelassen.

**Beispiel:**
```
rm -rf /     # wird erkannt (Leerzeichen danach)
rm -rf /*    # wird NICHT erkannt — löscht alles!
rm -rf /     # wird NICHT erkannt — Zeilenende statt Leerzeichen
```

**Lösung:** Das Regex-Pattern prüft jetzt auch auf `/*` und Zeilenende:
```
Vorher:  rm\s+-[rR]f\s+/\s
Nachher: rm\s+-[rR]f\s+/(?:\s|\*|$)
```

---

### Fix 2 — Regex-Bypasses mit Quotes und Variablen

**Problem:** Ein Angreifer kann gefährliche Kommandos durch Shell-Tricks am Guard vorbeischleusen. Quotes, Variablen oder Escape-Sequenzen verändern den String, sodass das Regex-Pattern nicht mehr greift — die Shell führt den Befehl aber trotzdem aus.

**Beispiel:**
```bash
ord"er"cli --confirm         # Shell entfernt die Quotes → ordercli --confirm
ordercli$'\x20'--confirm     # ANSI-C Escape für Leerzeichen → ordercli --confirm
rm -r${X}f /                 # Leere Variable → rm -rf /
```

**Lösung:** Vor der Prüfung wird der Befehl normalisiert — Quotes, Variablen, Backticks und Escape-Sequenzen werden entfernt. Es wird sowohl der Originalbefehl als auch die normalisierte Version geprüft. Wenn eine von beiden matcht, wird geblockt.

---

### Fix 3 — `nodes`-Tool wird nicht geprüft

**Problem:** Der Guard prüft nur Befehle die über `exec` oder `bash` ausgeführt werden. Das `nodes`-Tool kann mit `action: "run"` ebenfalls beliebige Shell-Kommandos ausführen — ohne jede Prüfung.

**Beispiel:**
```json
{
  "toolName": "nodes",
  "params": {
    "action": "run",
    "rawCommand": "ordercli --confirm"
  }
}
// → Wird NICHT geprüft, Befehl läuft durch!
```

**Lösung:** Der Guard extrahiert jetzt auch Kommandos aus `nodes`-Tool-Aufrufen (bei `action: "run"`) und prüft sie gegen alle Regeln. Andere Actions wie `status` oder `list` sind nicht betroffen.

---

### Fix 4 — Kein Audit-Trail bei Blocks

**Problem:** Wenn ein gefährlicher Befehl geblockt wird, gibt es keinen persistenten Nachweis. Logs gehen beim Neustart verloren. Ein Admin kann nicht nachvollziehen ob und wann Angriffe stattfanden.

**Beispiel:**
```
Agent versucht: rm -rf /
→ Command wird geblockt
→ Nur eine Konsolenausgabe, kein Logfile
→ Nach Gateway-Neustart: keine Spur mehr
```

**Lösung:** Jeder Block wird jetzt in `~/.clawdbot/security/audit.jsonl` protokolliert — als append-only JSONL mit Zeitstempel, Tool-Name, Kommando und Regel:
```json
{"ts":1706620800,"event":"command_blocked","toolName":"bash","command":"rm -rf /","ruleName":"rm-rf-root"}
```

---

### Fix 5 — Anomaly-Erkennung blockt nicht

**Problem:** Der Anomaly Detector kann auf `action: "abort"` konfiguriert werden, gibt bei erkannten Anomalien aber nur eine Warnung aus. Der Befehl wird trotzdem ausgeführt.

**Beispiel:**
```yaml
anomalyDetection:
  action: abort              # Soll blocken...
  maxToolCallsPerMinute: 30
```
```
Agent macht 50 Tool-Calls in einer Minute
→ Anomaly erkannt
→ Log-Meldung: "anomaly detected"
→ Befehl wird trotzdem ausgeführt!  # Bug
```

**Lösung:** Bei `action: "abort"` wird jetzt tatsächlich geblockt. Der Detector hat eine neue `shouldBlock()`-Methode die im Guard abgefragt wird:
- `action: "log"` → nur Debug-Log (wie bisher)
- `action: "warn"` → Warnung + Audit-Log, kein Block
- `action: "abort"` → Warnung + Audit-Log + **Block**

---

### Fix 6 — Kosten-Tracking geht bei Neustart verloren

**Problem:** Session- und Tageskosten werden nur im Arbeitsspeicher gehalten. Bei jedem Gateway-Neustart oder neuer Session starten die Zähler bei 0. Ein Agent kann sein Tageslimit umgehen indem er den Gateway neu startet.

**Beispiel:**
```
Session 1: $4.50 verbraucht (Limit: $5.00)
→ Gateway-Neustart
Session 2: Zähler steht bei $0.00
→ Agent kann weitere $5.00 ausgeben — Tageslimit ignoriert
```

**Lösung:** Session- und Tageskosten werden persistent in `~/.clawdbot/cost-tracking.json` gespeichert. Beim Start werden die letzten Werte geladen. Der Session-Zähler wird nur bei neuer Session-ID zurückgesetzt, der Tages-Zähler nur beim Datumswechsel (UTC).

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
