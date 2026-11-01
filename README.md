# Battery Historian (modernized)

Battery Historian is a tool to inspect battery-related information and events
on an Android device running Android 5.0 Lollipop (API level 21) and later,
while the device was not plugged in. It lets you visualize system and
application-level events on a zoomable timeline, see aggregated statistics
since the device was last fully charged, and inspect the battery metrics of a
chosen app. It can also A/B-compare two bug reports.

This is a modernized fork of [google/battery-historian](https://github.com/google/battery-historian)
(last upstream release: I/O 2017). Everything outdated has been upgraded:

| Area | Was (2017) | Now |
| --- | --- | --- |
| Go build | GOPATH, Go ≥1.8.1, no modules | Go modules (`go 1.27`), one-command build |
| Protobuf | `github.com/golang/protobuf` (pre-2020 API), GOPATH-only proto imports | `google.golang.org/protobuf` v1.36, regenerated with protoc 36, repo-relative proto imports |
| Bugreport formats | Battery-stats checkin v11–21 only; service dumps matched only the pre-Android-7 `DUMP OF SERVICE x:` header | Checkin **v11–36** (current AOSP) with the new `fgs` (foreground service), `rpm` (Resource Power Manager) sections and background-partial wakelocks parsed into the proto; both `DUMP OF SERVICE x:` **and** modern `------ DUMP OF SERVICE x ------` headers matched, so package/UID, appops and sensor extraction work on every modern bug report |
| Python | Python 2.7 required (v1 plot + kernel trace) | Python 3 only, and only for the optional kernel-trace converter; the Python-2 v1 plot is retired (`scripts/legacy/`) |
| Frontend | ~14k lines of Closure JS + jQuery + Flot + d3 from CDNs (some dead), built with a 2017 Closure compiler jar | React 19 + TypeScript (strict) + Vite SPA, canvas timeline with wheel-zoom/drag-pan, served from `web/dist` — no CDNs, 77 KB gzipped |
| HTTP server | `http.ListenAndServe`, no timeouts | `http.Server` with read/write/idle timeouts |
| Reflection | Positional Go-struct reflection over generated protos | `protoreflect`-based parsing keyed by proto field names |

## Getting started

### From source

Prerequisites:

* [Go](https://go.dev/dl/) 1.27 or newer
* [Node.js](https://nodejs.org/) 20+ with npm (only to build the UI once)
* Python 3 (optional — only for kernel-trace timestamp conversion)

```bash
git clone https://github.com/xxmafiaxxx/battery-historian.git
cd battery-historian

# Build the UI (once, or after changing web/)
cd web && npm ci && npm run build && cd ..

# Run
go run ./cmd/battery-historian [--port 9999]
```

Open <http://localhost:9999>, upload a bug report, done. The previous
Closure-based UI is still available at [`/legacy/`](http://localhost:9999/legacy/)
(it additionally requires `go run setup.go` to fetch Closure assets).

### With Docker

```bash
docker build -t battery-historian .
docker run -p 9999:9999 battery-historian
```

### Command-line tools

```bash
# Aggregated system stats from a bug report
go run ./cmd/checkin-parse --input=bugreport.txt

# Timeline analysis
go run ./cmd/history-parse --summary=totalTime --input=bugreport.txt

# Diff two bug reports
go run ./cmd/checkin-delta --input=bugreport_1.txt,bugreport_2.txt
```

### Development (UI hot reload)

```bash
cd web
npm run dev        # Vite dev server on :5173, proxying API calls to :9999
```

## How to take a bug report

Enable USB debugging under `Settings > System > Developer Options`, then:

```bash
# Android 7.0+
adb bugreport bugreport.zip

# Android 6.0 and lower
adb bugreport > bugreport.txt
```

Upload `bugreport.zip` (or `bugreport.txt`) at <http://localhost:9999>.

### Wakelock analysis

By default Android does not record per-wakelock timestamps. For detailed
wakelock info on the timeline, enable full wakelock reporting before your
experiment (short runs only — the history log overflows in a few hours):

```bash
adb shell dumpsys batterystats --reset
adb shell dumpsys batterystats --enable full-wake-history
```

### Power monitor analysis

Power monitor files should contain lines of the form
`<timestamp epoch seconds (fractional)> <amps> [volts]` or
`<timestamp epoch ms> <milliamps> [millivolts]`, consistent throughout the
file. Reset batterystats before logging, and take a bug report right after
logging stops so the timelines align.

## Tests

```bash
go test ./...           # Go backend (parser regression suites)
cd web && npm test      # UI data layer (vitest)
```

## Project layout

```
cmd/               CLI entry points (server + checkin/history/delta tools)
analyzer/          HTTP handlers, upload flow, orchestration
checkinparse/      CHECKIN BATTERYSTATS parser (v11–36) → batterystats proto
parseutils/        battery-history timeline parser → CSV for the UI
pb/                proto definitions and generated code (protoc 36)
web/               React/TypeScript UI (Vite; `npm run build` → web/dist)
historianutils/    shared helpers
scripts/           kernel_trace.py (Python 3); legacy/ holds the retired v1 plot
templates/         Go HTML templates for the legacy UI
```

## Support

If you've found an error, please file an issue on
[the fork's issue tracker](https://github.com/xxmafiaxxx/battery-historian/issues)
or the [upstream project](https://github.com/google/battery-historian/issues).

## License

Copyright 2016 Google, Inc. Licensed under the Apache License, Version 2.0
(see [LICENSE](LICENSE)).
