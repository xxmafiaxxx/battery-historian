# Battery Historian — Full Modernization Plan

## Context

`K:\coding\appDev\battery-historian` is Google's Battery Historian, frozen at the **I/O 2017 release**. Today it is broken in ways that matter:

- **Build**: GOPATH-era Go (no `go.mod`), needs Go ≥1.8.1 + Java + **Python 2.7 explicitly** + Closure compiler `v20170409`. `setup.go` clones `closure-library` at unpinned HEAD. None of this runs as documented on a 2026 machine.
- **Frontend**: ~14k lines of Closure JS (`js/`) + jQuery 1.11 / Bootstrap 3.3 / Flot 0.8 / d3 4.9 loaded from CDNs — some now **dead links** (the Flot orderBars lib's personal domain is gone), so the served page can't even load all its JS.
- **Parsing**: checkin parser supports battery-stats report versions **11–21**; AOSP today is at **version 36** (~30 new/renamed data categories: `fgs`, `awl`, `dc`, `lv`, `rpm`, `ctf`, `jbc`, `cam`, `fla`, `vid`, `aud`, `blem`, `gcf`, …). Worse, `historianutils.ServiceDumpRE` only matches the pre-Android-7 header `DUMP OF SERVICE x:` — modern bugreports use `------ DUMP OF SERVICE x ------`, so **package/UID, appops and sensor extraction silently return nothing on every modern bugreport**.
- **Python**: `scripts/historian.py` (v1 plot, invoked per-upload) is Python-2-only → fails on any modern box; `kernel_trace.py` same.

Your decisions: **full UI rewrite (React/TS)**, **real bugreport + synthetic fixtures** for testing, **also a Dockerfile**. Work is phased so there's a working tool after every phase; the legacy Closure UI stays reachable until the React UI reaches parity.

## Phase A — Build & Go modernization

1. `go.mod` (module `github.com/google/battery-historian`, go 1.22+) — internal imports already use that path, so no import churn.
2. Protobuf: add `go_package` to the 6 `.proto` files in `pb/`, regenerate with modern `protoc-gen-go`, switch all imports `github.com/golang/protobuf/proto` → `google.golang.org/protobuf/proto`, migrate call sites (`proto.Int`→`proto.Int32`, `proto.Float`→`proto.Float32/64`, `proto.Marshal` error handling — 251/234/84 call sites, mechanical). *Fallback if protoc fights the box: `github.com/golang/protobuf` v1.5.4 shim, zero code churn.*
3. `ioutil` → `os`/`io` (8 files), `%w` error wrapping where returned, `http.Server` with read/write timeouts in `cmd/battery-historian/battery-historian.go`.
4. Gate: `go build ./... && go vet ./... && go test ./...` green (13 existing test files, incl. the 6k-line `parseutils_test.go` regression net).

## Phase B — Modern bugreport format support (the "debug recent files" core)

5. `historianutils/historianutils.go`: `ServiceDumpRE` accepts **both** header styles (`DUMP OF SERVICE x:` and `------ DUMP OF SERVICE x ------`). Fixes `bugreportutils.extractSensorInfo` and `packageutils/package_extractor.go` (package/appops) on modern bugreports — unit tests for both formats.
6. `checkinparse/checkin_parse.go`: `maxParseReportVersion` 21 → **36** (warn-only above); verify per-version field gates against AOSP `BatteryStats.java` `dumpCheckin` (v22–36 changes to `cpu`, `st`, `nt`, `bt`, `br`, …); add parsers for new categories that map to real value: `fgs` (foreground services), `awl`, `dc`, `lv`, `rpm`, `ctf`, `jbc`, `cam`/`fla`/`vid`/`aud`, `blem`, `gcf` — extending `pb/batterystats_proto/batterystats.proto` where a category deserves a proto field; unknown categories keep degrading to warnings (already the behavior).
7. `analyzer/analyzer.go`: when checkin extraction is empty or version unsupported, set an explicit `Note`/`CriticalError` (fields already exist in `uploadResponse`) instead of silent degradation.
8. Synthetic fixtures under `checkinparse/testdata/` + `bugreportutils` tests: a minimal **v36 checkin** section and a **modern-header** bugreport skeleton (modeled on AOSP source, not copied from any device).

## Phase C — Python 3, retire the v1 plot

9. Port `scripts/kernel_trace.py` (229 lines) to Python 3 — still needed for the kernel-trace upload path.
10. Stop invoking `historian.py` in `analyzer.go` (`generateHistorianPlot`) — the v1 HTML plot is superseded by the rewritten UI; move the script to `scripts/legacy/` with a README note rather than porting 1,596 dead lines. Removes Python 2 and, with Phase D, Java/Closure entirely from the runtime.

## Phase D — Full UI rewrite (React/TypeScript/Vite)

11. Scaffold `web/` — Vite + React + TypeScript + d3 v7 + TanStack Table, vitest; all deps via npm with committed lockfile (no CDNs). Go server keeps the existing JSON API (`POST /` → `uploadResponse` / `uploadResponseCompare`) and serves `web/dist`; extend `uploadResponse` JSON only where Go templates previously filled gaps (e.g., compare page's server-side `html` blob → render from `combinedCheckin` JSON instead).
12. Port the data layer to TS with vitest unit tests, using existing `*_test.js` as the spec: `data.js` (1,874 lines CSV/event model), `level_data.js`, `series_level.js`, `level_summary.js`, `time.js`, `utils.js`, `metrics.js` (decoders).
13. Timeline component (the big one): d3 v7 port of `bars.js` (1,779) + `level.js` (1,127) + `historian_v2.js` — pan/zoom, activity bars, battery-level series, notes, power-monitor overlay, category visibility menu, tooltips.
14. Views: Upload, System stats, App stats, Histograms, Summaries, Compare (A/B diff) — replacing `templates/*.html` + `tables.js`/`app_stats.js`/`histogramstats.js` (2,347). Legacy Closure UI stays served at `/legacy/` (with `setup.go` fixed minimally: pin closure-library to a release tag, vendor the two dead-CDN scripts locally) until you sign off parity.
15. Build wiring: `web/dist` built by npm; `battery-historian.go` gains `--dist_dir` and serves it at `/`.

## Phase E — Docker, docs, e2e

16. Multi-stage `Dockerfile`: node build stage (SPA) → Go build stage → slim runtime (python3 for kernel trace only). README rewritten for 2026 (Go install, `npm ci && npm run build`, `go run ./cmd/battery-historian`, `docker run`); remove G+/Java/Python-2 instructions.
17. **Verification end-to-end**: Go gate green; vitest green; server smoke locally + in Docker: upload (a) an old-format fixture, (b) the synthetic v36 fixture, (c) your real modern bugreport → timeline renders events, system/app stats tables populated, version warning surfaces cleanly for anything unparseable. Browser visual pass on the React UI before calling Phase D done.

## Order & checkpoints

A → B → C → D → E. After each phase the repo builds and the tool runs. Largest-risk item is D.13 (timeline port); D.11–12 (tables + data layer) land first so the tool is usable before the timeline exists in React.

**Note on test data**: I don't have your real bugreport yet — drop it anywhere and tell me the path when we get to Phase B verification (it will not be committed).