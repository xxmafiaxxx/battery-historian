// Temporary debug runner #3: full ParseBatteryStats after the float fix.
package main

import (
	"fmt"
	"os"

	"github.com/google/battery-historian/bugreportutils"
	"github.com/google/battery-historian/checkinparse"
	"github.com/google/battery-historian/checkinutil"
	"github.com/google/battery-historian/packageutils"

	sessionpb "github.com/google/battery-historian/pb/session_proto"
	"google.golang.org/protobuf/proto"
)

func main() {
	b, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	bs := bugreportutils.ExtractBatterystatsCheckin(string(b))
	pkgs, _ := packageutils.ExtractAppsFromBugReport(string(b))

	var ctr checkinutil.IntCounter
	cp := checkinparse.CreateBatteryReport(&sessionpb.Checkin{Checkin: proto.String(bs)})
	stats, warnings, errs := checkinparse.ParseBatteryStats(&ctr, cp, pkgs)
	fmt.Println("stats nil:", stats == nil)
	fmt.Println("reportVersion:", stats.GetReportVersion())
	fmt.Println("warnings:", len(warnings))
	for i, w := range warnings {
		if i >= 10 {
			fmt.Println("  ... more")
			break
		}
		fmt.Println("  W:", w)
	}
	fmt.Println("errors:", len(errs))
	for i, e := range errs {
		if i >= 20 {
			fmt.Println("  ... more")
			break
		}
		fmt.Println("  E:", e)
	}
	if stats != nil {
		sys := stats.GetSystem()
		fmt.Println("power items:", len(sys.GetPowerUseItem()),
			"| kernel wakelocks:", len(sys.GetKernelWakelock()),
			"| rpm:", len(sys.GetResourcePowerManager()))
		fmt.Println("apps:", len(stats.GetApp()))
	}
}
