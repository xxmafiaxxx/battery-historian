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
	"time"

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

	// Modern adb appends .zip to the destination; pre-7 adb writes plain text
	// to the exact name. Handle both after the run.
	dest := filepath.Join(dir, "bugreport")
	args := []string{"-s", serial, "bugreport", dest}
	if _, err := runAdb(r, adbBugreportTimeout, args...); err != nil {
		http.Error(w, fmt.Sprintf("adb bugreport failed for device %q: %v", serial, err), http.StatusInternalServerError)
		return
	}

	found := ""
	for _, candidate := range []string{dest + ".zip", dest + ".txt", dest} {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() && info.Size() > 0 {
			found = candidate
			break
		}
	}
	if found == "" {
		// Last resort: adb may have written with a timestamped name into dest's
		// directory.
		matches, _ := filepath.Glob(filepath.Join(dir, "bugreport*"))
		for _, m := range matches {
			if info, err := os.Stat(m); err == nil && !info.IsDir() && info.Size() > 0 {
				found = m
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

	files := map[string]UploadedFile{
		bugreportFT: {
			FileType: bugreportFT,
			FileName: filepath.Base(found),
			Contents: contents,
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
