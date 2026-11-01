
2026-11-01 — Interactive timeline + parity; adb direct pull + save; scrollable app stats — 250ff8e
- Timeline: SERIES_META with semantic color + English description per lane, grouped legend by category with filters, enriched tooltips (seriesName — desc + value/opt/time). Jump nav with version chip.
- App stats: fixed UNKNOWN names — wire name is string not string[] (proto optional string), added child/head_child fallback, searchable (name/UID), sortable (App/UID/power/CPU), sticky-header paginated table max-height 560px, power mini-bars, detail drawer with version + wakelock/sensor/process scroll areas.
- Checkin v36: controller floats coerced via parseIntLoose ("0.0"), max version 36. ADB: adb bugreport now targets directory not file prefix + `adb pull` fallback parsing `/data/...bugreport*.zip` from error (fixed ZD222SSQG6 Win copy failure). Save-to-computer via `/api/adb/last-report` + object URL. System stats + aggregated checkin restored.
- Verified: `go vet` 0, `go test -count=1` 13 pkgs ok, `web` tsc+vite build ok (277.99kB), live on :9998 with ZD222SSQG6 motorola_razr_2025; pushed to origin/master.
