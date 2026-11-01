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
	if _, err := runAdb(r, adbBugreportTimeout, "-s", serial, "bugreport", destDir); err != nil {
		runErr = err
		// The error message on newer Android contains the on-device path;
		// attempt the suggested `adb pull` as a fallback.
		if devPath := extractDeviceBugreportPath(err.Error()); devPath != "" {
			if _, pullErr := runAdb(r, 2*time.Minute, "-s", serial, "pull", devPath, destDir); pullErr == nil {
				runErr = nil
			} else {
				runErr = fmt.Errorf("%v; pull fallback also failed: %v", err, pullErr)
			}
		}
	}
	if runErr != nil {
		http.Error(w, fmt.Sprintf("adb bugreport failed for device %q: %v", serial, runErr), http.StatusInternalServerError)
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
