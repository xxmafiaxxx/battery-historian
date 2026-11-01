// Copyright 2026 Google Inc. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// ADB integration: list connected Android devices and pull bug reports
// directly, so the UI can display a fresh analysis without a manual
// `adb bugreport` round trip.

package analyzer

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/battery-historian/bugreportutils"
	"github.com/google/battery-historian/historianutils"
)

// adbPath is the adb binary to invoke. Overridable with --adb_path.
var adbPath = "adb"

// adbBugreportTimeout bounds a single `adb bugreport` run; large devices can
// legitimately take a few minutes.
const adbBugreportTimeout = 8 * time.Minute

// serialRE guards the -s argument: adb serials are IP:port, USB IDs or
// emulator names; nothing here needs shell metacharacters.
var serialRE = regexp.MustCompile(`^[A-Za-z0-9._:\-]{1,128}$`)

// SetAdbPath overrides the adb binary path. An empty string keeps the default.
func SetAdbPath(p string) {
	if p != "" {
		adbPath = p
	}
}

// AdbDevice is one row of `adb devices -l`.
type AdbDevice struct {
	Serial string `json:"serial"`
	State  string `json:"state"`
	Model  string `json:"model,omitempty"`
}

// AdbDevicesHandler lists devices visible to adb.
func AdbDevicesHandler(w http.ResponseWriter, r *http.Request) {
	out, err := runAdb(r, 15*time.Second, "devices", "-l")
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to run %q (is adb installed and on PATH, or set --adb_path?): %v", adbPath, err), http.StatusInternalServerError)
		return
	}
	devices := parseAdbDevices(out)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string][]AdbDevice{"devices": devices})
}

// parseAdbDevices parses the tabular output of `adb devices -l`.
func parseAdbDevices(out string) []AdbDevice {
	var devices []AdbDevice
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "List of devices") || strings.HasPrefix(line, "*") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		d := AdbDevice{Serial: fields[0], State: fields[1]}
		for _, f := range fields[2:] {
			if strings.HasPrefix(f, "model:") {
				d.Model = strings.TrimPrefix(f, "model:")
			}
		}
		devices = append(devices, d)
	}
	return devices
}

// isDumpstatezFailure reports whether an adb error looks like the dumpstatez
// service being down — the typical "Failed to connect to dumpstatez service:
// Connection refused" that happens under load or after a long uptime.
func isDumpstatezFailure(msg string) bool {
	lower := strings.ToLower(msg)
	return strings.Contains(lower, "dumpstatez") || strings.Contains(lower, "dumpstate") && strings.Contains(lower, "connection refused")
}

func dumpstatezHelp(serial string) string {
	return fmt.Sprintf(
		"device %q refused the zipped bugreport (dumpstatez: Connection refused).\n\n"+
			"This is the on-device bugreport service crashing — not a Historian bug. Try in order:\n"+
			"  1. Keep the phone awake + unlocked, re-accept the USB debugging prompt, then Retry.\n"+
			"  2. Restart adb:  adb kill-server && adb start-server  (or unplug/replug USB) and Retry.\n"+
			"  3. Reboot the phone:  adb -s %s reboot  — the service recovers after a reboot.\n"+
			"  4. If it keeps failing, use the lightweight fallback below (dumpsys batterystats only — no full bugreport, but you still get System/App stats + timeline).",
		serial, serial)
}

// AdbBugreportHandler runs `adb bugreport` on the requested device and feeds
// the result straight into the normal analysis pipeline, responding with the
// same JSON as a file upload.
func AdbBugreportHandler(w http.ResponseWriter, r *http.Request) {
	serial := r.URL.Query().Get("serial")
	if serial == "" {
		http.Error(w, "missing ?serial= parameter", http.StatusBadRequest)
		return
	}
	if !serialRE.MatchString(serial) {
		http.Error(w, fmt.Sprintf("invalid serial %q", serial), http.StatusBadRequest)
		return
	}

	dir, err := os.MkdirTemp("", "historian-adb")
	if err != nil {
		http.Error(w, fmt.Sprintf("could not create temp dir: %v", err), http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(dir)

	// `adb bugreport <path>`: when <path> is a directory adb writes a
	// timestamped bugreport-*.zip inside it; when it is a file prefix modern
	// adb wants to append .zip and on some Windows/driver combos the copy
	// back to the host fails with "could not be copied to '…bugreport.zip'.
	// Try to run 'adb pull /data/.../bugreport-*.zip <directory>'".  Pass a
	// directory so both flows work, and if the first attempt fails try the
	// suggested `adb pull` using the device path parsed from the error.
	destDir := dir
	destPrefix := filepath.Join(dir, "bugreport")
	var runErr error
	// Retry once after a short pause if dumpstatez is refusing — it often
	// recovers after a second.
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			time.Sleep(3 * time.Second)
		}
		if _, err := runAdb(r, adbBugreportTimeout, "-s", serial, "bugreport", destDir); err != nil {
			runErr = err
			if devPath := extractDeviceBugreportPath(err.Error()); devPath != "" {
				if _, pullErr := runAdb(r, 2*time.Minute, "-s", serial, "pull", devPath, destDir); pullErr == nil {
					runErr = nil
					break
				} else {
					runErr = fmt.Errorf("%v; pull fallback also failed: %v", err, pullErr)
				}
			}
			if isDumpstatezFailure(err.Error()) && attempt == 0 {
				continue
			}
			break
		} else {
			runErr = nil
			break
		}
	}
	if runErr != nil {
		if isDumpstatezFailure(runErr.Error()) {
			http.Error(w, dumpstatezHelp(serial)+fmt.Sprintf("\n\nRaw: %v", runErr), http.StatusBadGateway)
		} else {
			http.Error(w, fmt.Sprintf("adb bugreport failed for device %q: %v", serial, runErr), http.StatusInternalServerError)
		}
		return
	}

	found := ""
	// Prefer the most recent file in the temp dir (adb writes a timestamped name).
	matches, _ := filepath.Glob(filepath.Join(destDir, "*"))
	var bestTime time.Time
	for _, m := range matches {
		if info, err := os.Stat(m); err == nil && !info.IsDir() && info.Size() > 0 {
			if info.ModTime().After(bestTime) {
				bestTime = info.ModTime()
				found = m
			}
		}
	}
	if found == "" {
		// Extremely old adb that wrote to the exact prefix (no zip) — check prefix too.
		for _, candidate := range []string{destPrefix + ".zip", destPrefix + ".txt", destPrefix} {
			if info, err := os.Stat(candidate); err == nil && !info.IsDir() && info.Size() > 0 {
				found = candidate
				break
			}
		}
	}
	if found == "" {
		http.Error(w, fmt.Sprintf("adb finished but no bug report file was found for device %q", serial), http.StatusInternalServerError)
		return
	}

	contents, err := os.ReadFile(found)
	if err != nil {
		http.Error(w, fmt.Sprintf("could not read pulled bug report: %v", err), http.StatusInternalServerError)
		return
	}

	// Modern `adb bugreport` produces a zip; the analysis pipeline needs the
	// extracted main entry (the upload path does the same via bugreportutils).
	name := filepath.Base(found)
	entry, entryName, err := bugreportutils.ExtractBugReport(name, contents)
	if err != nil {
		http.Error(w, fmt.Sprintf("the pulled file %q did not contain a recognizable bug report (check that USB debugging is fully authorized): %v", name, err), http.StatusInternalServerError)
		return
	}

	// Remember the raw pulled file so the UI can offer "save to computer".
	storeLastReport(name, contents)

	files := map[string]UploadedFile{
		bugreportFT: {
			FileType: bugreportFT,
			FileName: entryName,
			Contents: []byte(entry),
		},
	}
	AnalyzeAndResponse(w, r, files)
}

// runAdb runs adb with the given arguments and a timeout, returning stdout.
func runAdb(r *http.Request, timeout time.Duration, args ...string) (string, error) {
	ctx := r.Context()
	if timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}
	out, err := historianutils.RunCommandContext(ctx, adbPath, args...)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("timed out after %s", timeout)
		}
		return "", err
	}
	return out, nil
}

// lastPulledReport keeps the most recently pulled raw bug report so the UI
// can offer a "save to computer" download.
var lastPulledReport struct {
	mu   sync.Mutex
	name string
	data []byte
}

func storeLastReport(name string, data []byte) {
	lastPulledReport.mu.Lock()
	defer lastPulledReport.mu.Unlock()
	lastPulledReport.name = name
	cp := make([]byte, len(data))
	copy(cp, data)
	lastPulledReport.data = cp
}

// extractDeviceBugreportPath pulls the on-device /data/.../bugreport-*.zip
// path out of the "Try to run 'adb pull /data/... <directory>'" hint that
// modern adb prints when the host copy fails.
func extractDeviceBugreportPath(msg string) string {
	// Look for "/data/…bugreport…zip" in the error text.
	for _, f := range strings.Fields(msg) {
		if strings.HasPrefix(f, "/data/") && strings.Contains(f, "bugreport") {
			// Trim trailing punctuation the shell error may attach.
			f = strings.Trim(f, "'\".,;")
			return f
		}
	}
	// Fallback: regex for the pull hint.
	re := regexp.MustCompile(`/data/[^\s'"]+bugreport[^\s'"]*\.zip`)
	if m := re.FindString(msg); m != "" {
		return m
	}
	return ""
}

// AdbFallbackHandler collects lightweight dumpsys data directly (no zipped
// bugreport) for when dumpstatez is refusing. It gathers `dumpsys
// batterystats --checkin`, stamps minimal bugreport headers so the normal
// parser accepts it, and runs the full analysis — the result is partial
// (no kernel/event logs) but System/App stats and timeline work.
func AdbFallbackHandler(w http.ResponseWriter, r *http.Request) {
	serial := r.URL.Query().Get("serial")
	if serial == "" {
		http.Error(w, "missing ?serial= parameter", http.StatusBadRequest)
		return
	}
	if !serialRE.MatchString(serial) {
		http.Error(w, fmt.Sprintf("invalid serial %q", serial), http.StatusBadRequest)
		return
	}
	getpropOut, _ := runAdb(r, 15*time.Second, "-s", serial, "shell", "getprop")
	// Include history so the fallback produces a real Battery History timeline;
	// bare `--checkin` omits `9,h,...` rows and leaves Historian empty.
	checkinOut, err := runAdb(r, 40*time.Second, "-s", serial, "shell", "dumpsys", "batterystats", "-c", "--history")
	if err != nil || strings.TrimSpace(checkinOut) == "" {
		http.Error(w, fmt.Sprintf("fallback collection failed — could not run dumpsys batterystats --checkin on %q: %v", serial, err), http.StatusInternalServerError)
		return
	}
	checkinOut = trimCheckinHistory(checkinOut, 60000)
	if err != nil || strings.TrimSpace(checkinOut) == "" {
		http.Error(w, fmt.Sprintf("fallback collection failed — could not run dumpsys batterystats --checkin on %q: %v", serial, err), http.StatusInternalServerError)
		return
	}
	// Best-effort extras (ignored on failure).
	batteryDump, _ := runAdb(r, 15*time.Second, "-s", serial, "shell", "dumpsys", "battery")
	batterystatsDump, _ := runAdb(r, 30*time.Second, "-s", serial, "shell", "dumpsys", "batterystats")

	// Derive minimal metadata from getprop; fall back to safe defaults.
	sdk := "34"
	if m := regexp.MustCompile(`\[ro\.build\.version\.sdk\]:\s*\[(\d+)\]`).FindStringSubmatch(getpropOut); len(m) == 2 {
		sdk = m[1]
	}
	model := "unknown device"
	if m := regexp.MustCompile(`\[ro\.product\.model\]:\s*\[(.+?)\]`).FindStringSubmatch(getpropOut); len(m) == 2 {
		model = m[1]
	}
	fp := fmt.Sprintf("fallback/%s:user/release-keys", serial)
	if m := regexp.MustCompile(`\[ro\.build\.fingerprint\]:\s*\[(.+?)\]`).FindStringSubmatch(getpropOut); len(m) == 2 {
		fp = m[1]
	}
	tz := "UTC"
	if m := regexp.MustCompile(`\[persist\.sys\.timezone\]:\s*\[(.+?)\]`).FindStringSubmatch(getpropOut); len(m) == 2 {
		tz = m[1]
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	// Synthesize a minimal bugreport that passes IsBugReport + ParseMetaInfo +
	// ExtractBatterystatsCheckin + battery history. The history fallback uses
	// the plain batterystats dump if available.
	var b strings.Builder
	b.WriteString(fmt.Sprintf("== dumpstate: %s\n", now))
	b.WriteString(fmt.Sprintf("Build fingerprint: '%s'\n", fp))
	b.WriteString(fmt.Sprintf("[ro.build.version.sdk]: [%s]\n", sdk))
	b.WriteString(fmt.Sprintf("[ro.product.model]: [%s]\n", model))
	b.WriteString("DeviceID: 0\n")
	b.WriteString(fmt.Sprintf("[persist.sys.timezone]: [%s]\n", tz))
	// Echo getprop so timezone/model detection is robust.
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
	name := fmt.Sprintf("fallback-%s-%s.txt", serial, time.Now().Format("20060102-150405"))
	storeLastReport(name, []byte(synth))
	files := map[string]UploadedFile{
		bugreportFT: {FileType: bugreportFT, FileName: name, Contents: []byte(synth)},
	}
	AnalyzeAndResponse(w, r, files)
}

// AdbLastReportHandler serves the most recently pulled raw bug report as a
// download. 404s when nothing has been pulled yet in this server's lifetime.
func AdbLastReportHandler(w http.ResponseWriter, r *http.Request) {
	lastPulledReport.mu.Lock()
	name, data := lastPulledReport.name, lastPulledReport.data
	lastPulledReport.mu.Unlock()
	if len(data) == 0 {
		http.Error(w, "no bug report has been pulled yet", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	w.Write(data)
}
