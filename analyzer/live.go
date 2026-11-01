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
