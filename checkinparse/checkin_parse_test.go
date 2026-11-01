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

package checkinparse

import (
	"strings"
	"testing"

	"google.golang.org/protobuf/proto"

	"github.com/google/battery-historian/checkinutil"

	bspb "github.com/google/battery-historian/pb/batterystats_proto"
	sessionpb "github.com/google/battery-historian/pb/session_proto"
)

// v36Checkin is a synthetic "CHECKIN BATTERYSTATS" section shaped like the
// output of modern Android (BatteryStats.CHECKIN_VERSION 36). It exercises
// the version bump, the new trailing fields on bt, the new fgs and rpm
// sections, and sections this parser recognizes but does not proto-encode.
const v36Checkin = `9,0,i,vers,36,36,BP3A.250705.014,BP3A.250705.014
9,0,l,bt,1,12345678,12340000,12400000,12360000,1750000000000,9000000,8900000,4820,4700,4900,150000
9,0,l,pws,4800,150,120,30
9,10007,l,fg,15000,3
9,10007,l,fgs,60000,2
9,10007,l,rpm,some_state,5000,10,4000,8
9,10007,l,rpm,some_state,1000,2,800,1
9,10007,l,rpm,some_voter,500,5,400,4
9,10007,l,awl,100000,50000
9,10007,l,jbc,7
9,10007,l,wmc,3
`

// parseCheckinLines runs the full checkin pipeline over the given lines and
// returns the parsed report along with all warnings and errors.
func parseCheckinLines(t *testing.T, checkin string) (*bspb.BatteryStats, []string, []error) {
	t.Helper()
	var ctr checkinutil.IntCounter
	s := &sessionpb.Checkin{Checkin: proto.String(checkin)}
	stats, warnings, errs := ParseBatteryStats(&ctr, CreateBatteryReport(s), nil)
	if stats == nil {
		t.Fatalf("ParseBatteryStats returned nil stats; warnings: %v; errs: %v", warnings, errs)
	}
	return stats, warnings, errs
}

func findApp(t *testing.T, stats *bspb.BatteryStats, uid int32) *bspb.BatteryStats_App {
	t.Helper()
	for _, app := range stats.GetApp() {
		if app.GetUid() == uid {
			return app
		}
	}
	t.Fatalf("no app with uid %d found in parsed stats", uid)
	return nil
}

func findRPM(t *testing.T, system *bspb.BatteryStats_System, name string) *bspb.BatteryStats_System_ResourcePowerManager {
	t.Helper()
	for _, r := range system.GetResourcePowerManager() {
		if r.GetName() == name {
			return r
		}
	}
	t.Fatalf("no ResourcePowerManager entry named %q found", name)
	return nil
}

func TestParseV36Checkin(t *testing.T) {
	stats, warnings, errs := parseCheckinLines(t, v36Checkin)

	if len(errs) > 0 {
		t.Errorf("unexpected errors parsing v36 checkin: %v", errs)
	}
	for _, w := range warnings {
		if strings.Contains(w, "unknown data category") {
			t.Errorf("recognized v36 section surfaced as unknown: %s", w)
		}
		if strings.Contains(w, "newer report version") {
			t.Errorf("v36 is the tested maximum, but got: %s", w)
		}
	}

	if got, want := stats.GetReportVersion(), int32(36); got != want {
		t.Errorf("report version = %d, want %d", got, want)
	}

	// App-level: fg and the new fgs section.
	app := findApp(t, stats, 10007)
	if got, want := app.GetForeground().GetTotalTimeMsec(), float32(15000); got != want {
		t.Errorf("fg total_time_msec = %v, want %v", got, want)
	}
	if got, want := app.GetForegroundService().GetTotalTimeMsec(), float32(60000); got != want {
		t.Errorf("fgs total_time_msec = %v, want %v", got, want)
	}
	if got, want := app.GetForegroundService().GetCount(), float32(2); got != want {
		t.Errorf("fgs count = %v, want %v", got, want)
	}

	// System-level: rpm lines with the same name accumulate into one entry.
	if got, want := len(stats.GetSystem().GetResourcePowerManager()), 2; got != want {
		t.Errorf("len(ResourcePowerManager) = %d, want %d", got, want)
	}
	state := findRPM(t, stats.GetSystem(), "some_state")
	if got, want := state.GetTotalTimeMsec(), float32(6000); got != want {
		t.Errorf("rpm some_state total_time_msec = %v, want %v", got, want)
	}
	if got, want := state.GetTotalCount(), float32(12); got != want {
		t.Errorf("rpm some_state total_count = %v, want %v", got, want)
	}
	if got, want := state.GetScreenOffTimeMsec(), float32(4800); got != want {
		t.Errorf("rpm some_state screen_off_time_msec = %v, want %v", got, want)
	}
	voter := findRPM(t, stats.GetSystem(), "some_voter")
	if got, want := voter.GetScreenOffCount(), float32(4); got != want {
		t.Errorf("rpm some_voter screen_off_count = %v, want %v", got, want)
	}

	// bt: leading fields parsed, trailing modern fields tolerated.
	b := stats.GetSystem().GetBattery()
	if got, want := b.GetStartCount(), float32(1); got != want {
		t.Errorf("bt start_count = %v, want %v", got, want)
	}
	if got, want := b.GetEstimatedBatteryCapacityMah(), int64(4820); got != want {
		t.Errorf("bt estimated_battery_capacity_mah = %d, want %d", got, want)
	}
	if got, want := b.GetMinLearnedBatteryCapacityUah(), int64(4700); got != want {
		t.Errorf("bt min_learned_battery_capacity_uah = %d, want %d", got, want)
	}
	if got, want := b.GetMaxLearnedBatteryCapacityUah(), int64(4900); got != want {
		t.Errorf("bt max_learned_battery_capacity_uah = %d, want %d", got, want)
	}
}

func TestParseUnknownSectionStillWarns(t *testing.T) {
	checkin := v36Checkin + "9,10007,l,notarealsection,1,2\n"
	_, warnings, _ := parseCheckinLines(t, checkin)
	found := false
	for _, w := range warnings {
		if strings.Contains(w, "unknown data category notarealsection") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected an 'unknown data category notarealsection' warning; got warnings: %v", warnings)
	}
}

func TestParseFutureVersionWarns(t *testing.T) {
	checkin := strings.Replace(v36Checkin, "i,vers,36,", "i,vers,99,", 1)
	_, warnings, _ := parseCheckinLines(t, checkin)
	found := false
	for _, w := range warnings {
		if strings.Contains(w, "newer report version 99") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected a 'newer report version 99 found' warning; got warnings: %v", warnings)
	}
}
