package analyzer

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// LiveReading is one polled snapshot from `dumpsys battery`.
type LiveReading struct {
	Serial          string  `json:"serial"`
	TimestampMs     int64   `json:"timestampMs"`
	Level           int     `json:"level"`
	VoltageMv       int     `json:"voltageMv"`
	TempDeciC       int     `json:"tempDeciC"`
	TempC           float64 `json:"tempC"`
	Status          int     `json:"status"`
	StatusLabel     string  `json:"statusLabel"`
	Health          int     `json:"health"`
	Plugged         bool    `json:"plugged"`
	AcPowered       bool    `json:"acPowered"`
	UsbPowered      bool    `json:"usbPowered"`
	WirelessPowered bool    `json:"wirelessPowered"`
	Present         bool    `json:"present"`
	Technology      string  `json:"technology,omitempty"`
}

var (
	reLevel      = regexp.MustCompile(`(?m)^\s*level:\s*(\d+)`)
	reVoltage    = regexp.MustCompile(`(?m)^\s*voltage:\s*(\d+)`)
	reTemp       = regexp.MustCompile(`(?m)^\s*temperature:\s*(\d+)`)
	reStatus     = regexp.MustCompile(`(?m)^\s*status:\s*(\d+)`)
	reHealth     = regexp.MustCompile(`(?m)^\s*health:\s*(\d+)`)
	rePresent    = regexp.MustCompile(`(?m)^\s*present:\s*(true|false)`)
	reTechnology = regexp.MustCompile(`(?m)^\s*technology:\s*(.+)`)
	reAc         = regexp.MustCompile(`(?m)AC powered:\s*(true|false)`)
	reUsb        = regexp.MustCompile(`(?m)USB powered:\s*(true|false)`)
	reWireless   = regexp.MustCompile(`(?m)Wireless powered:\s*(true|false)`)
)

func statusLabel(s int) string {
	switch s {
	case 1:
		return "unknown"
	case 2:
		return "charging"
	case 3:
		return "discharging"
	case 4:
		return "not charging"
	case 5:
		return "full"
	default:
		return fmt.Sprintf("status %d", s)
	}
}

func boolFromMatch(m []string) bool {
	return len(m) == 2 && strings.EqualFold(m[1], "true")
}

func intFromMatch(m []string) int {
	if len(m) < 2 {
		return 0
	}
	n, _ := strconv.Atoi(strings.TrimSpace(m[1]))
	return n
}

// parseDumpsysBattery parses the text of `dumpsys battery` into a LiveReading.
func parseDumpsysBattery(serial, out string) LiveReading {
	r := LiveReading{Serial: serial, TimestampMs: time.Now().UnixMilli()}
	r.Level = intFromMatch(reLevel.FindStringSubmatch(out))
	r.VoltageMv = intFromMatch(reVoltage.FindStringSubmatch(out))
	r.TempDeciC = intFromMatch(reTemp.FindStringSubmatch(out))
	r.TempC = float64(r.TempDeciC) / 10.0
	r.Status = intFromMatch(reStatus.FindStringSubmatch(out))
	r.StatusLabel = statusLabel(r.Status)
	r.Health = intFromMatch(reHealth.FindStringSubmatch(out))
	if m := rePresent.FindStringSubmatch(out); len(m) == 2 {
		r.Present = boolFromMatch(m)
	} else {
		r.Present = true
	}
	if m := reTechnology.FindStringSubmatch(out); len(m) == 2 {
		r.Technology = strings.TrimSpace(m[1])
	}
	r.AcPowered = boolFromMatch(reAc.FindStringSubmatch(out))
	r.UsbPowered = boolFromMatch(reUsb.FindStringSubmatch(out))
	r.WirelessPowered = boolFromMatch(reWireless.FindStringSubmatch(out))
	r.Plugged = r.AcPowered || r.UsbPowered || r.WirelessPowered
	return r
}

// trimCheckinHistory keeps header lines (9,0,i / 9,hsp etc) plus the last
// keepH history rows (9,h,…). Full history is ~390k lines / 30 MB / 48s
// parse; trimmed (~50k) parses in <8s and keeps the last ~1-2 days.
func trimCheckinHistory(s string, keepH int) string {
	lines := strings.Split(s, "\n")
	var header []string
	var hLines []string
	for _, ln := range lines {
		if strings.HasPrefix(ln, "9,h,") {
			hLines = append(hLines, ln)
		} else {
			header = append(header, ln)
		}
	}
	if len(hLines) <= keepH {
		return s
	}
	// Ensure we keep a TIME anchor: the first h line is the TIME record.
	firstH := hLines[0]
	tail := hLines[len(hLines)-keepH:]
	kept := append(header, firstH)
	kept = append(kept, tail...)
	return strings.Join(kept, "\n")
}

// LiveBatteryHandler serves GET /api/adb/live?serial=XYZ — one cheap
// `dumpsys battery` poll, parsed as JSON for the live chart.
func LiveBatteryHandler(w http.ResponseWriter, r *http.Request) {
	serial := r.URL.Query().Get("serial")
	if serial == "" {
		http.Error(w, "missing ?serial= parameter", http.StatusBadRequest)
		return
	}
	if !serialRE.MatchString(serial) {
		http.Error(w, fmt.Sprintf("invalid serial %q", serial), http.StatusBadRequest)
		return
	}
	out, err := runAdb(r, 6*time.Second, "-s", serial, "shell", "dumpsys", "battery")
	if err != nil {
		http.Error(w, fmt.Sprintf("live poll failed for %q: %v", serial, err), http.StatusBadGateway)
		return
	}
	if strings.TrimSpace(out) == "" {
		http.Error(w, fmt.Sprintf("empty dumpsys battery output for %q", serial), http.StatusBadGateway)
		return
	}
	reading := parseDumpsysBattery(serial, out)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(reading)
}

// LiveReportHandler is the heavy live poll — same data as a bugreport but
// assembled live from `dumpsys batterystats --checkin` + battery + getprop
// and fed through the full AnalyzeAndResponse pipeline. Frontend polls this
// every 10-15s for a truly live Historian view (System/App stats + timeline).
func LiveReportHandler(w http.ResponseWriter, r *http.Request) {
	serial := r.URL.Query().Get("serial")
	if serial == "" {
		http.Error(w, "missing ?serial= parameter", http.StatusBadRequest)
		return
	}
	if !serialRE.MatchString(serial) {
		http.Error(w, fmt.Sprintf("invalid serial %q", serial), http.StatusBadRequest)
		return
	}
	getpropOut, _ := runAdb(r, 8*time.Second, "-s", serial, "shell", "getprop")
	// Use `-c --history` so Battery History timeline is included; bare
	// `--checkin` / `-c` alone only emits aggregated stats, leaving the
	// Historian timeline empty (as seen on ZD222SSQG6). Trim to the last
	// 50k history lines so live polling stays under ~5 MB / ~8s parse.
	checkinOut, err := runAdb(r, 30*time.Second, "-s", serial, "shell", "dumpsys", "batterystats", "-c", "--history")
	if err != nil || strings.TrimSpace(checkinOut) == "" {
		http.Error(w, fmt.Sprintf("live report failed — dumpsys batterystats --checkin empty on %q: %v", serial, err), http.StatusBadGateway)
		return
	}
	checkinOut = trimCheckinHistory(checkinOut, 50000)
	if err != nil || strings.TrimSpace(checkinOut) == "" {
		http.Error(w, fmt.Sprintf("live report failed — dumpsys batterystats --checkin empty on %q: %v", serial, err), http.StatusBadGateway)
		return
	}
	batteryDump, _ := runAdb(r, 8*time.Second, "-s", serial, "shell", "dumpsys", "battery")
	batterystatsDump, _ := runAdb(r, 25*time.Second, "-s", serial, "shell", "dumpsys", "batterystats")

	sdk := "34"
	if m := regexp.MustCompile(`\[ro\.build\.version\.sdk\]:\s*\[(\d+)\]`).FindStringSubmatch(getpropOut); len(m) == 2 {
		sdk = m[1]
	}
	model := "unknown device"
	if m := regexp.MustCompile(`\[ro\.product\.model\]:\s*\[(.+?)\]`).FindStringSubmatch(getpropOut); len(m) == 2 {
		model = m[1]
	}
	fp := fmt.Sprintf("live/%s:user/release-keys", serial)
	if m := regexp.MustCompile(`\[ro\.build\.fingerprint\]:\s*\[(.+?)\]`).FindStringSubmatch(getpropOut); len(m) == 2 {
		fp = m[1]
	}
	tz := "UTC"
	if m := regexp.MustCompile(`\[persist\.sys\.timezone\]:\s*\[(.+?)\]`).FindStringSubmatch(getpropOut); len(m) == 2 {
		tz = m[1]
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	var b strings.Builder
	b.WriteString(fmt.Sprintf("== dumpstate: %s\n", now))
	b.WriteString(fmt.Sprintf("Build fingerprint: '%s'\n", fp))
	b.WriteString(fmt.Sprintf("[ro.build.version.sdk]: [%s]\n", sdk))
	b.WriteString(fmt.Sprintf("[ro.product.model]: [%s]\n", model))
	b.WriteString("DeviceID: 0\n")
	b.WriteString(fmt.Sprintf("[persist.sys.timezone]: [%s]\n", tz))
	if getpropOut != "" {
		b.WriteString("\n------ SYSTEM PROPERTIES ------\n")
		b.WriteString(getpropOut)
		if !strings.HasSuffix(getpropOut, "\n") {
			b.WriteString("\n")
		}
	}
	b.WriteString("\n------ CHECKIN BATTERYSTATS ------\n")
	b.WriteString(checkinOut)
	if !strings.HasSuffix(checkinOut, "\n") {
		b.WriteString("\n")
	}
	b.WriteString("\n------ DUMP OF SERVICE batterystats ------\n")
	if batterystatsDump != "" {
		b.WriteString(batterystatsDump)
		if !strings.HasSuffix(batterystatsDump, "\n") {
			b.WriteString("\n")
		}
	} else {
		b.WriteString(checkinOut)
		b.WriteString("\n")
	}
	if batteryDump != "" {
		b.WriteString("\n------ DUMP OF SERVICE battery ------\n")
		b.WriteString(batteryDump)
		if !strings.HasSuffix(batteryDump, "\n") {
			b.WriteString("\n")
		}
	}
	synth := b.String()
	name := fmt.Sprintf("live-%s-%s.txt", serial, time.Now().Format("20060102-150405"))
	storeLastReport(name, []byte(synth))
	files := map[string]UploadedFile{
		bugreportFT: {FileType: bugreportFT, FileName: name, Contents: []byte(synth)},
	}
	AnalyzeAndResponse(w, r, files)
}
