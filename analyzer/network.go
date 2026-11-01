// Network domain extractor — mines URLs / hostnames from the raw bugreport
// so the UI can show "Sites visited" without needing Chrome history (which
// bugreports don't dump). Best-effort: any https?:// URL or Host: header
// visible in logcat/dumpsys will be counted. Pure stdlib.
package analyzer

import (
	"net/url"
	"regexp"
	"sort"
	"strings"
)

// NetworkSite is one hostname seen in the report.
type NetworkSite struct {
	Domain     string `json:"domain"`
	Count      int    `json:"count"`
	ExampleURL string `json:"exampleUrl"`
	Secure     bool   `json:"secure"` // any https seen
}

var (
	// https?://host/path — capture the full URL first, then parse host.
	urlRE = regexp.MustCompile(`(?i)https?://[^\s"'<>\],\)]+`)
	// Host: example.com  (HTTP header lines in logcat/dumpsys)
	hostHeaderRE = regexp.MustCompile(`(?i)(?:^|\n)\s*Host:\s*([a-z0-9.-]+\.[a-z]{2,})`)
)

// ExtractNetworkSites scans the entire bugreport text for URLs/hosts.
// Returns at most 250 domains sorted by count desc.
func ExtractNetworkSites(contents string) []NetworkSite {
	if contents == "" {
		return nil
	}
	type agg struct {
		count int
		example string
		secure bool
	}
	m := make(map[string]*agg)

	for _, raw := range urlRE.FindAllString(contents, -1) {
		clean := strings.TrimRight(raw, ".,;!?)")
		u, err := url.Parse(clean)
		if err != nil || u.Hostname() == "" {
			continue
		}
		host := strings.ToLower(u.Hostname())
		if host == "localhost" || strings.HasPrefix(host, "127.") || host == "::1" {
			continue
		}
		if !strings.Contains(host, ".") {
			continue
		}
		// Skip obvious non-sites (android/internal, file names)
		if strings.HasSuffix(host, ".png") || strings.HasSuffix(host, ".jpg") || strings.HasSuffix(host, ".zip") {
			continue
		}
		a := m[host]
		if a == nil {
			m[host] = &agg{count: 1, example: clean, secure: u.Scheme == "https"}
		} else {
			a.count++
			if u.Scheme == "https" {
				a.secure = true
			}
		}
	}
	for _, hm := range hostHeaderRE.FindAllStringSubmatch(contents, -1) {
		if len(hm) < 2 {
			continue
		}
		host := strings.ToLower(strings.TrimSpace(hm[1]))
		if _, ok := m[host]; ok {
			continue
		}
		m[host] = &agg{count: 1, example: "http://" + host + "/"}
	}

	if len(m) == 0 {
		return nil
	}
	out := make([]NetworkSite, 0, len(m))
	for domain, a := range m {
		out = append(out, NetworkSite{Domain: domain, Count: a.count, ExampleURL: a.example, Secure: a.secure})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Domain < out[j].Domain
	})
	if len(out) > 250 {
		out = out[:250]
	}
	return out
}
