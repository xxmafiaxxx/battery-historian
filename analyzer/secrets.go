package analyzer

import (
	"regexp"
	"sort"
	"strings"
)

// SecretFind is one potential secret/key sighting.
type SecretFind struct {
	Kind     string `json:"kind"`     // e.g. "AWS Access Key", "Private Key", "Generic Secret"
	Masked   string `json:"masked"`   // redacted value shown by default
	Context  string `json:"context"`  // short line snippet (also redacted if it contains the raw)
	Count    int    `json:"count"`
	Severity string `json:"severity"` // low/medium/high
}

var (
	// High-confidence patterns
	awsKeyRE       = regexp.MustCompile(`AKIA[0-9A-Z]{16}`)
	googleAPIRE    = regexp.MustCompile(`AIza[0-9A-Za-z\-_]{35}`)
	// JWT (header.payload.signature) — rough
	jwtRE = regexp.MustCompile(`eyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}`)
	// Private key blocks
	privKeyRE = regexp.MustCompile(`-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----`)
	// Generic: api_key / secret / token / password assignments with a value-looking token
	// Keep conservative to avoid flagging every "password: ****"
	genericSecretRE = regexp.MustCompile(`(?i)(api[_-]?key|secret|passwd|password|auth[_-]?token|bearer|access[_-]?token)[\s"':=]{1,12}([A-Za-z0-9_\-+/=]{12,64})`)
)

func maskValue(v string) string {
	if len(v) <= 8 {
		return strings.Repeat("•", len(v))
	}
	return v[:3] + strings.Repeat("•", len(v)-5) + v[len(v)-2:]
}

func maskContext(line, raw string) string {
	if raw != "" {
		return strings.ReplaceAll(line, raw, maskValue(raw))
	}
	return line
}

// ExtractSecrets scans the raw bugreport text for key-like strings.
// Defensive purpose: surface what would leak if you share this report.
// Returns at most 100 findings sorted by severity then count.
func ExtractSecrets(contents string) []SecretFind {
	if contents == "" {
		return nil
	}
	type agg struct {
		kind     string
		severity string
		masked   string
		context  string
		count    int
	}
	m := make(map[string]*agg) // key = kind|masked

	add := func(kind, severity, raw, line string) {
		// skip obvious placeholders
		lower := strings.ToLower(raw)
		if strings.Contains(lower, "example") || strings.Contains(lower, "placeholder") || strings.Contains(lower, "xxxx") {
			return
		}
		masked := maskValue(raw)
		key := kind + "|" + masked
		if a, ok := m[key]; ok {
			a.count++
			return
		}
		ctx := strings.TrimSpace(line)
		if len(ctx) > 120 {
			ctx = ctx[:120] + "…"
		}
		ctx = maskContext(ctx, raw)
		m[key] = &agg{kind: kind, severity: severity, masked: masked, context: ctx, count: 1}
	}

	lines := strings.Split(contents, "\n")
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "#") {
			continue
		}
		if awsKeyRE.MatchString(line) {
			for _, raw := range awsKeyRE.FindAllString(line, -1) {
				add("AWS Access Key", "high", raw, line)
			}
		}
		if googleAPIRE.MatchString(line) {
			for _, raw := range googleAPIRE.FindAllString(line, -1) {
				add("Google API Key", "high", raw, line)
			}
		}
		if jwtRE.MatchString(line) {
			for _, raw := range jwtRE.FindAllString(line, -1) {
				// JWTs are long; mask heavily
				add("JWT", "medium", raw[:30]+"…", line)
			}
		}
		if privKeyRE.MatchString(line) {
			add("Private Key Block", "high", "-----BEGIN PRIVATE KEY-----", line)
		}
		if genericSecretRE.MatchString(line) {
			for _, hm := range genericSecretRE.FindAllStringSubmatch(line, -1) {
				if len(hm) < 3 {
					continue
				}
				kindRaw := strings.ToLower(hm[1])
				val := hm[2]
				// ignore short or low-entropy
				if len(val) < 12 {
					continue
				}
				// ignore masked placeholder values like ********
				if strings.Count(val, "*") > 2 || strings.Count(val, "•") > 2 {
					continue
				}
				kind := "Generic Secret (" + kindRaw + ")"
				add(kind, "medium", val, line)
			}
		}
	}

	if len(m) == 0 {
		return nil
	}
	out := make([]SecretFind, 0, len(m))
	for _, a := range m {
		out = append(out, SecretFind{Kind: a.kind, Masked: a.masked, Context: a.context, Count: a.count, Severity: a.severity})
	}
	sort.Slice(out, func(i, j int) bool {
		sevRank := map[string]int{"high": 0, "medium": 1, "low": 2}
		if sevRank[out[i].Severity] != sevRank[out[j].Severity] {
			return sevRank[out[i].Severity] < sevRank[out[j].Severity]
		}
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Kind < out[j].Kind
	})
	if len(out) > 100 {
		out = out[:100]
	}
	return out
}
