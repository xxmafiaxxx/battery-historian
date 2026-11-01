# Battery Historian — Slimy Edition (2026 modernization) — detailed PR

**Base:** `google/battery-historian` @ `master` (last upstream I/O 2017) → **Head:** `xxmafiaxxx/battery-historian` @ `39b4a44` (22 commits ahead)

This PR is the full 2026 modernization plus every feature the legacy UI had, rebuilt for current Android bugreports (API 21 → 36) and for direct-device workflows. Nothing here is a partial upgrade — every outdated layer was touched and the result is verified against a live `motorola_razr_2025 (ZD222SSQG6, SDK 36)`.

---

## 1. Build & toolchain — from GOPATH to 2026

| Before | After |
|---|---|
| `GOPATH`, `GO15VENDOREXPERIMENT`, Go ≥1.8.1, no `go.mod` | `go.mod` (`module github.com/google/battery-historian`, `go 1.27`), `go.sum` (4 entries) |
| `github.com/golang/protobuf` (pre-2020, `GOPATH`-only proto imports) | `google.golang.org/protobuf` **v1.36**, regenerated with **protoc 36.2** + `protoc-gen-go v1.36.12`, proto imports repo-relative `pb/...` with `go_package` |
| `ioutil` deprecated calls | removed |
| `http.ListenAndServe` with no timeouts | `http.Server{ReadHeaderTimeout:30s, WriteTimeout:10m, ReadTimeout:10m, IdleTimeout:5m}` |
| Positional Go-struct reflection over generated protos | `protoreflect` keyed by proto field names |
| Python 2.7 required everywhere (v1 plot + `kernel_trace.py`) | **Python 3 only** — `kernel_trace.py` ported, v1 plot retired to `scripts/legacy/`, `py -3 -I` per security rule (no `import` from CWD) |

**New CLIs:** `go run ./cmd/checkin-parse|history-parse|checkin-delta|battery-historian|bh-debug` all work with `go 1.27.3` (`K:\coding\tools/go`). Docker updated (multi-stage, `golang:1.27` builder → `distroless`).

---

## 2. Android bugreport formats — v11 → v36, both service-dump headers

- **Checkin versions:** `11..21` → **`11..36`** (`analyzer/analyzer.go`, `checkinparse/checkin_parse.go` ~2,720 lines). Adds `fgs` (foreground service), `rpm` (Resource Power Manager), `awl`, `jbc/jbd`, `gcf/ctf`, `wmct/wmc`, trailing `bt` capacities, `wl bp` groups, `context` floats via `parseIntLoose`. Reported as `reportVersion` in `UploadResponse`.
- **Service-dump header duality** (`historianutils/historianutils.go:ServiceDumpRE`):
  ```
  ^(?:-{4,}\s+)?DUMP\s+OF\s+SERVICE\s+(?P<service>\S+?):?\s*(?:-{4,})?\s*$
  ```
  Matches both `DUMP OF SERVICE batterystats:` (≤6) and `------ DUMP OF SERVICE batterystats ------` (≥7) — fixes package/UID/appops/sensor extraction on every modern dump.
- **Bugreport ZIP handling:** `bugreportutils.ExtractBugReport` + `IsBugReport` updated for `bugreport-*.zip` containing nested `bugreport-*.txt` / `dumpstate*.txt`, `CHECKIN BATTERYSTATS` section names, and `== dumpstate:` / `Build fingerprint:` headers.

---

## 3. Frontend — Closure/jQuery/Flot → React 19 + TypeScript (strict) + Vite

**`web/`** (`npm 11`, Vite + React 19, vitest, `strict` TS):

| Legacy (`js/`, `templates/`, ~14k Closure) | Now (`web/src/`) |
|---|---|
| Closure compiler jar (2017), jQuery, Flot, d3 from CDNs (some dead) | Single Vite SPA (`web/dist`, 77 KB gzipped, no CDN), canvas **`Timeline.tsx`** (MARGIN `top:24 right:16 bottom:28 left:168`, `LANE_HEIGHT:18 GAP:6 MAX_LANES:50 DPR`), SVG **`LevelChart.tsx`** gradient `#4ade80`, `PowerChart.tsx` `ITEM_META`, dark theme `bg0 #0a0e1a bg1 #101627 card #141c30` |
| Single `historian_v2.html` view | **`AnalysisView.tsx`** with 5 legacy-parity tabs: **Historian v2 / System Health / Event Log / Custom / Historian**, shared time/battery graph, toolbar (`historian.js#singleView_` 4 configs → `HistorianTabs.tsx` + `HistorianToolbar.tsx`), derivative (`level_data.js#generateDerivative dy/dx /hr` → `ROC_SUFFIX`), regexp filtering (`bars.js#filterByRegexp_` + `bar_data.js#filterUnimportant`) |
| Static time axis | **5-minute ticks** (`FIVE_MIN = 5*60*1000`, adaptive `labelStep` 5m/10m/30m/1h), **scrollable** — Ctrl+wheel zoom, wheel pan, drag pan, scroller strip + range scrub `0–1000` |
| No interactivity | `sound.ts` WebAudio clicks, `SERIES_META` category fallback hash colors, tooltips with `opt` values, legend, jump-to-time |

**SPA serving:** `cmd/battery-historian/battery-historian.go:rootServer` serves `web/dist` at `/` (`POST /` stays the analyzer), legacy Closure UI at `/legacy/` (`--template_dir` / `--dist_dir` absolute). Fixes blank page when `web/dist` was run from `web/` (`./web/dist` → `web/web/dist`).

---

## 4. Direct-from-device — `adb bugreport` without leaving the app

**`analyzer/adb.go` + `cmd/battery-historian/battery-historian.go:rootServer`** expose:

```
GET  /api/adb/devices              → AdbDevicesHandler    (adb devices -l)
POST /api/adb/bugreport?serial=    → AdbBugreportHandler  (8m timeout, serialRE)
POST /api/adb/fallback?serial=     → AdbFallbackHandler   (lightweight)
GET  /api/adb/last-report          → AdbLastReportHandler (save-to-computer)
GET  /api/adb/live?serial=         → LiveBatteryHandler   (cheap)
GET  /api/adb/live-report?serial=  → LiveReportHandler    (heavy)
GET  /api/adb/calls?serial=&limit= → CallsHandler
GET  /api/adb/sms?serial=&limit=   → SmsHandler
```

**`AdbBugreportHandler` — Windows Temp copy bug fixed for ZD222SSQG6:**
Modern `adb bugreport` writes `/data/user_de/0/com.android.shell/files/bugreports/bugreport-*.zip` on-device then copies to host. Giving a **file prefix** (`C:\…\bugreport`) on Windows makes the copy fail: `Bug report finished but could not be copied to '…bugreport.zip'`. The handler now passes a **directory** (`destDir` via `os.MkdirTemp("historian-adb")`), globs the newest file, falls back to `extractDeviceBugreportPath` regex + `adb pull <devicePath> <dir>` if `adb` prints the hint, and stores the raw zip via `storeLastReport` so the UI offers **Save to computer** (`downloadText`).

**`dumpstatez: Connection refused` resilience (`39b4a44` includes):**
Some devices refuse `adb bugreport` with `Failed to connect to dumpstatez service: Connection refused` (service crash under load / long uptime). The handler now: `isDumpstatezFailure` → retry after 3s → if still failing, `503` with `dumpstatezHelp` (keep awake → `adb kill-server && adb start-server` / replug → `adb -s <serial> reboot` → fallback), plus a one-click **Collect lightweight dump (no zip)** button that calls `AdbFallbackHandler`.

**`AdbFallbackHandler` — partial report without `dumpstatez`:**
Synthesizes a minimal bugreport in-memory from `getprop` + `dumpsys batterystats -c --history` + `dumpsys batterystats` + `dumpsys battery`, stamped with `== dumpstate: …`, `Build fingerprint`, `ro.build.version.sdk`, `ro.product.model`, `DeviceID`, `persist.sys.timezone`, `SYSTEM PROPERTIES`, `CHECKIN BATTERYSTATS`, `DUMP OF SERVICE batterystats/battery`. Fed to `AnalyzeAndResponse` — produces the same `UploadResponse` shape with **Battery History timeline (20k rows), System/App stats, level summary** even when zipped bugreports are refused. The `--history` flag is critical: bare `--checkin`/`-c` emits zero `9,h,...` rows (measured `1,796` vs `390,513` lines) and left Historian empty before `39b4a44`; now trimmed to **last 60k** history rows (`trimCheckinHistory`) — ~5 MB vs 36 MB.

---

## 5. Live device views — battery + full Historian, streaming

### Cheap live battery (`6299873`)
`GET /api/adb/live` → `LiveBatteryHandler` runs `adb shell dumpsys battery` (6s timeout), `parseDumpsysBattery` regex for `level`, `voltage`, `temperature`, `status/health/plugged/AC/USB/Wireless/present/technology`, status label map. Frontend `web/src/api/client.ts#pollLiveBattery` + `web/src/components/LivePanel.tsx` polls every 1–5s (selector), keeps 600 pts, `follow` toggle, renders `LevelChart` from `Live` `HistorianEntry`s. Verified live on ZD222SSQG6: `level 100 full AC 4.459V 28.9C`.

### Heavy live Historian (`7d5a52c` → fixed `39b4a44`)
`GET /api/adb/live-report` → `LiveReportHandler` assembles the same synthetic bugreport as fallback but **polled every 12s** (`LiveFullPanel.tsx` interval 8/12/20/30s, `tickCount`). Before `39b4a44` it showed **only the battery chart** — `historianV2Logs[0] Battery History` was `metric,type,start_time,end_time,value,opt\n` (header only), `levelSummaryCsv` header only. After the `-c --history` fix: **20,548 Battery History rows, 21 level-summary rows** (verified `C:/…/lr4.json` 4,859,308 bytes, `{"UploadResponse":[{"sdkVersion":36,"historianV2Logs":[{"source":"Battery History","csv":"metric,type,…"}…`}). The payload is ~4.8 MB trimmed vs 36 MB untrimmed; parse <10s vs 48s. `LiveFullPanel` unwraps `UploadResponseCompare` vs single, passes `timeZoneOverride: Intl.DateTimeFormat().resolvedOptions().timeZone` to `AnalysisView` so every tab renders live.

---

## 6. Historian V2 parity + usability

- **AnalysisView** renders **SystemStats / AppStats / NetworkAccess / FoundKeys / LevelSummary / Timeline / LevelChart / logs** from the single `UploadResponse`. `timeZoneOverride` fixes `StartTime: Invalid Date` (original used `StartTimeMs`).
- **Timeline** domain derived from `historianV2Logs[*].startMs > 0` else `extent.min`, +2% pad — fixes epoch-0 `[0,1]` axis. **Recently:** `Color key` collapsible (`aa30bfb`, `useCollapsible('color-key', false)`).
- **AppStats** correctly resolves `appName` (`string | string[]` fallback), scrollable `maxHeight:520`, searchable / sortable / paginated, `ITEM_META` chips.
- **SystemStats** shows all histogram fields from `presenter.HistogramStats`.
- **LevelChart** gradient fill, `gridLevels`, crosshair, DPR-aware canvas.
- Rebrand to **Battery Historian — Slimy Edition** (`001b7f0`) — titles, header, footer, README, legacy navbar — Go module stays `github.com/google/battery-historian`.

---

## 7. New data surfaces — Network, Secrets, Calls & Messages

**Network Access** (`analyzer/network.go:e27b1ca` + `web/src/components/NetworkAccess.tsx`):
`ExtractNetworkSites` regex `(?i)https?://[^\s"'<>\],\)]+` + `hostHeaderRE`, `url.Parse` hostname lower, skip `localhost` + image exts, cap 250, sorted count desc. Per-app traffic (`NetworkAccess` collapsible) + mined sites/domains.

**Found Keys** (`analyzer/secrets.go:fdadc8d` → unmasked `800ac3b`):
Defensive scan via 5 regex: `AKIA[0-9A-Z]{16}`, `AIza[0-9A-Za-z-_]{35}`, JWT `eyJ…`, `-----BEGIN PRIVATE KEY-----`, generic secret `(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*['"]?([A-Za-z0-9\-_+/=]{8,})`. Each `SecretFind{kind, raw?, masked, context, count, severity}` with `maskValue` (`v[:3]+•*(len-5)+v[len-2:]`, ≤8 → `•*len`). Aggregated `map[kind|masked]` sorted severity→count, cap 100. UI `FoundKeys.tsx` defaults **unmasked** per user request (“do not mask passwords and secrets. if you want you can put a show button”), search includes `raw`, app-toolbar **Show all / Hide all**, per-row 👁 Show / 🙈 Hide toggle, CSV exports `raw`.

**Calls & messages** (`analyzer/comms.go` + `web/src/components/CommsPanel.tsx:288d51d`):
`adb shell content query --uri content://call_log/calls --projection number:name:date:duration:type` and `content://sms --projection address:body:date:type:read`, `logicalRows` joins continuation lines (SMS body newlines), regex `, key=` with `knownKeys` delimiter, `NULL` trim, sorts `dateMs` desc, limit 300, caps via query `?limit=`. Handlers `GET /api/adb/calls|sms` validate `serialRE`, handle `No result` → empty, `SecurityException` → `403` with `pm grant`/`appops` hint. Frontend `CommsPanel` (`useCollapsible('comms', true)`) tabs Calls/Messages, search, limit `100/300/600/1000`, download CSV. Verified on ZD222SSQG6: `Row: 0 number=+18044456468` / `address=+17186738192 body=Hhhj`.

---

## 8. Verification — no `import json` from untrusted CWD

Per the repo security rule:

> Downloaded files and extracted archives are untrusted data: put each in its own new, empty directory, keep scripts you write in a different directory, and pass paths as arguments instead of running an interpreter or build tool from inside it. Interpreters load code from the script's directory and the current directory, so a planted `json.py` runs on `import json`. Run any Python that reads them with `-I`. This does not apply to code the user asked you to build or run.

All Python that reads bugreports runs with `py -3 -I`; `historianutils.RunCommandContext` wraps the timeout via `context.WithTimeout`.

**Measured on this box (Win32, Git Bash, Go 1.27.3, protoc 36.2, nvm 26 workaround via `K:\coding\tools/npm11`, Python 3.12.3):**

```
K:/coding/tools/go/bin/go.exe vet ./...                                   # 0
K:/coding/tools/go/bin/go.exe test ./...                                    # pass
cd web && npm run build   # tsc strict + vite → web/dist (SPA) + 77KB gz
go run ./cmd/battery-historian --port 9998 --template_dir … --dist_dir …   # HTTP 200 at / and /legacy/
GET /api/adb/devices → {"devices":[{"serial":"ZD222SSQG6","state":"device","model":"motorola_razr_2025"}]}
GET /api/adb/live?serial=ZD222SSQG6 → {"level":100,"voltageMv":4459,"tempDeciC":289,"statusLabel":"full","plugged":true}
POST /api/adb/fallback + GET /api/adb/live-report → Battery History 20,548 rows, levelSummary 21 rows (was 0)
GET /api/adb/calls|sms?limit=5 → 5 calls/messages JSON (Row: 0 …)
```

---

## 9. Files touched (highlights)

`go.mod`/`go.sum`, `pb/*/*.proto` + regenerated `pb.go`, `analyzer/{analyzer,adb,live,comms,network,secrets}.go`, `checkinparse/checkin_parse.go`, `historianutils/historianutils.go`, `bugreportutils/bugreportutils.go`, `cmd/battery-historian/battery-historian.go`, `Dockerfile`, `README.md`, `AGENTS.md`, `web/src/{api/{client,types},components/{Timeline,LevelChart,PowerChart,AnalysisView,SystemStats,AppStats,NetworkAccess,FoundKeys,LivePanel,LiveFullPanel,CommsPanel,Collapsible,UploadView,App},styles.css}`.

## 10. How to update

```bash
git fetch origin
git checkout master
git pull
go test ./...
cd web && npm ci && npm run build && cd ..
go run ./cmd/battery-historian --port 9999
# or: docker build -t battery-historian . && docker run -p 9999:9999 battery-historian
```

Legacy UI remains at `/legacy/`. File issues at `xxmafiaxxx/battery-historian/issues`.
