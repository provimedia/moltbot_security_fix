# Moltbot Security Fix Package

Dieses Paket behebt 6 Sicherheitsprobleme im Moltbot Agent Security Layer.

## Was wird gefixt?

| # | Problem | Loesung |
|---|---------|---------|
| 1 | `rm -rf /*` wird nicht erkannt | Pattern erkennt jetzt auch `/*` und Zeilenende |
| 2 | Regex-Bypasses mit Quotes/Variablen | Shell-Normalisierung entfernt Tricks vor der Pruefung |
| 3 | `nodes`-Tool wird nicht geprueft | Kommandos ueber das nodes-Tool werden jetzt auch geblockt |
| 4 | Kein Audit-Trail bei Blocks | Alle Blocks werden in `~/.clawdbot/security/audit.jsonl` protokolliert |
| 5 | Anomaly-Erkennung blockt nicht | Bei `action: "abort"` wird jetzt tatsaechlich geblockt |
| 6 | Kosten-Tracking geht bei Neustart verloren | Session- und Tageskosten werden persistent gespeichert |

---

## Installationsanleitung

Waehle die Anleitung die zu deiner Installation passt:

---

### Ich nutze die macOS App (Moltbot.app)

Die macOS App startet einen Gateway-Prozess der JavaScript-Dateien aus einem lokalen Verzeichnis ausfuehrt. Der Fix patcht diese Dateien direkt.

**Installieren:**

```bash
# 1. Fix herunterladen
git clone https://github.com/provimedia/moltbot_security_fix.git
cd moltbot_security_fix

# 2. Finde dein Moltbot-Verzeichnis:
#    npm:      /usr/local/lib/node_modules/moltbot
#    Homebrew: $(brew --prefix)/lib/node_modules/moltbot
#    git:      ~/moltbot

# 3. Patch ausfuehren (Pfad anpassen!)
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

# 2. Patch ausfuehren
./patch-dist.sh /usr/local/lib/node_modules/moltbot

# 3. Gateway neu starten
moltbot gateway restart
```

Falls du nicht weisst wo Moltbot installiert ist:
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

Falls du nicht weisst wo Moltbot installiert ist:
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

### Fuer Maintainer: Sparkle App Update (automatisch an alle Nutzer)

So verteilst du den Fix als offizielles macOS-App-Update:

1. Fix ins Haupt-Repo mergen
2. Version in `package.json` hochzaehlen
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
security-fix.patch                             # Git-Patch (fuer git apply)

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

## Pruefung / Verifikation

Nach der Installation (nur bei Source-Installationen mit `pnpm`):

```bash
pnpm vitest run \
  src/security/dangerous-command-guard.test.ts \
  src/security/anomaly-detector.test.ts \
  src/security/register-builtin-guards.test.ts \
  src/security/audit-log.test.ts \
  src/infra/cost-tracker.test.ts
```

Alle 84 Tests muessen bestehen (0 Failures).
