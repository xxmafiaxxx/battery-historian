package analyzer

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// CallRecord is one row from content://call_log/calls.
type CallRecord struct {
	Number      string `json:"number"`
	Name        string `json:"name"`
	DateMs      int64  `json:"dateMs"`
	Date        string `json:"date"`
	DurationSec int    `json:"durationSec"`
	Type        int    `json:"type"`
	TypeLabel   string `json:"typeLabel"`
}

// SmsRecord is one row from content://sms.
type SmsRecord struct {
	Address   string `json:"address"`
	Body      string `json:"body"`
	DateMs    int64  `json:"dateMs"`
	Date      string `json:"date"`
	Type      int    `json:"type"`
	TypeLabel string `json:"typeLabel"`
	Read      int    `json:"read"`
}

func callTypeLabel(t int) string {
	switch t {
	case 1:
		return "incoming"
	case 2:
		return "outgoing"
	case 3:
		return "missed"
	case 4:
		return "voicemail"
	case 5:
		return "rejected"
	case 6:
		return "blocked"
	default:
		return fmt.Sprintf("type %d", t)
	}
}

func smsTypeLabel(t int) string {
	switch t {
	case 1:
		return "inbox"
	case 2:
		return "sent"
	case 3:
		return "draft"
	default:
		return fmt.Sprintf("type %d", t)
	}
}

// logicalRows joins continuation lines (SMS body may contain newlines) into
// single logical "Row: N ..." strings.
func logicalRows(out string) []string {
	lines := strings.Split(out, "\n")
	var rows []string
	var cur string
	for _, l := range lines {
		trim := strings.TrimSpace(l)
		if strings.HasPrefix(trim, "Row:") {
			if cur != "" {
				rows = append(rows, cur)
			}
			cur = trim
		} else if cur != "" {
			// continuation of previous row (body newline)
			cur += "\n" + l
		}
	}
	if cur != "" {
		rows = append(rows, cur)
	}
	return rows
}

// parseCallRows parses content query output for calls.
func parseCallRows(out string) []CallRecord {
	if strings.Contains(out, "No result found") {
		return nil
	}
	rows := logicalRows(out)
	var recs []CallRecord
	for _, r := range rows {
		// strip "Row: N "
		if idx := strings.Index(r, " "); idx >= 0 {
			// find second space after Row: N
			rest := r[idx+1:]
			if idx2 := strings.Index(rest, " "); idx2 >= 0 {
				r = rest[idx2+1:]
			} else {
				r = rest
			}
		}
		// r is "number=..., name=..., date=..., duration=..., type=..."
		// fields may contain commas; parse by known keys.
		m := map[string]string{}
		// extract with regex that finds key= value until next ", key=" or end
		// known keys for calls
		keys := []string{"number", "name", "date", "duration", "type"}
		for i, k := range keys {
			re := regexp.MustCompile(regexp.QuoteMeta(k) + `=`)
			loc := re.FindStringIndex(r)
			if loc == nil {
				continue
			}
			start := loc[1]
			end := len(r)
			// find start of next key
			for _, nk := range keys[i+1:] {
				nre := regexp.MustCompile(`,\s*` + regexp.QuoteMeta(nk) + `=`)
				nloc := nre.FindStringIndex(r[start:])
				if nloc != nil {
					candidate := start + nloc[0]
					if candidate < end {
						end = candidate
					}
				}
			}
			m[k] = strings.TrimSpace(r[start:end])
		}
		num := m["number"]
		name := m["name"]
		if name == "NULL" {
			name = ""
		}
		dateStr := m["date"]
		durStr := m["duration"]
		typeStr := m["type"]
		var dateMs int64
		var dur int
		var typ int
		if v, err := strconv.ParseInt(dateStr, 10, 64); err == nil {
			dateMs = v
		}
		if v, err := strconv.Atoi(durStr); err == nil {
			dur = v
		}
		if v, err := strconv.Atoi(typeStr); err == nil {
			typ = v
		}
		if num == "" && name == "" && dateMs == 0 {
			continue
		}
		var dateLabel string
		if dateMs > 0 {
			dateLabel = time.UnixMilli(dateMs).Format("2006-01-02 15:04:05")
		}
		recs = append(recs, CallRecord{
			Number:      num,
			Name:        name,
			DateMs:      dateMs,
			Date:        dateLabel,
			DurationSec: dur,
			Type:        typ,
			TypeLabel:   callTypeLabel(typ),
		})
	}
	// sort newest first
	sort.Slice(recs, func(i, j int) bool { return recs[i].DateMs > recs[j].DateMs })
	return recs
}

func parseSmsRows(out string) []SmsRecord {
	if strings.Contains(out, "No result found") {
		return nil
	}
	rows := logicalRows(out)
	var recs []SmsRecord
	for _, r := range rows {
		if idx := strings.Index(r, " "); idx >= 0 {
			rest := r[idx+1:]
			if idx2 := strings.Index(rest, " "); idx2 >= 0 {
				r = rest[idx2+1:]
			} else {
				r = rest
			}
		}
		// keys in projection order: address, body, date, type, read (read optional)
		// body may contain ", date=" so we must locate date/type with lookahead
		m := map[string]string{}
		// helper to extract between key= and next known delimiter
		extract := func(key string, nextKeys []string, src string) string {
			re := regexp.MustCompile(regexp.QuoteMeta(key) + `=`)
			loc := re.FindStringIndex(src)
			if loc == nil {
				return ""
			}
			start := loc[1]
			end := len(src)
			for _, nk := range nextKeys {
				nre := regexp.MustCompile(`,\s*` + regexp.QuoteMeta(nk) + `=`)
				nloc := nre.FindStringIndex(src[start:])
				if nloc != nil {
					cand := start + nloc[0]
					if cand < end {
						end = cand
					}
				}
			}
			return src[start:end]
		}
		m["address"] = extract("address", []string{"body", "date", "type", "read"}, r)
		m["body"] = extract("body", []string{"date", "type", "read"}, r)
		m["date"] = extract("date", []string{"type", "read"}, r)
		m["type"] = extract("type", []string{"read"}, r)
		m["read"] = extract("read", nil, r)

		addr := m["address"]
		body := m["body"]
		dateStr := m["date"]
		typeStr := m["type"]
		readStr := m["read"]
		if addr == "NULL" {
			addr = ""
		}
		var dateMs int64
		var typ, read int
		if v, err := strconv.ParseInt(strings.TrimSpace(dateStr), 10, 64); err == nil {
			dateMs = v
		}
		if v, err := strconv.Atoi(strings.TrimSpace(typeStr)); err == nil {
			typ = v
		}
		if v, err := strconv.Atoi(strings.TrimSpace(readStr)); err == nil {
			read = v
		}
		if addr == "" && body == "" && dateMs == 0 {
			continue
		}
		var dateLabel string
		if dateMs > 0 {
			dateLabel = time.UnixMilli(dateMs).Format("2006-01-02 15:04:05")
		}
		recs = append(recs, SmsRecord{
			Address:   addr,
			Body:      body,
			DateMs:    dateMs,
			Date:      dateLabel,
			Type:      typ,
			TypeLabel: smsTypeLabel(typ),
			Read:      read,
		})
	}
	sort.Slice(recs, func(i, j int) bool { return recs[i].DateMs > recs[j].DateMs })
	return recs
}

// CallsHandler serves GET /api/adb/calls?serial=X&limit=300
func CallsHandler(w http.ResponseWriter, r *http.Request) {
	serial := r.URL.Query().Get("serial")
	if serial == "" {
		http.Error(w, "missing ?serial=", http.StatusBadRequest)
		return
	}
	if !serialRE.MatchString(serial) {
		http.Error(w, fmt.Sprintf("invalid serial %q", serial), http.StatusBadRequest)
		return
	}
	limit := 300
	if s := r.URL.Query().Get("limit"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v > 0 && v <= 2000 {
			limit = v
		}
	}
	out, err := runAdb(r, 25*time.Second, "-s", serial, "shell", "content", "query", "--uri", "content://call_log/calls", "--projection", "number:name:date:duration:type")
	if err != nil {
		msg := err.Error()
		if strings.Contains(strings.ToLower(msg), "permission") || strings.Contains(msg, "SecurityException") {
			http.Error(w, "call log permission denied — this device blocks shell from reading call history. Try: adb shell pm grant com.android.shell android.permission.READ_CALL_LOG ; adb shell appops set com.android.shell READ_CALL_LOG allow", http.StatusForbidden)
			return
		}
		http.Error(w, fmt.Sprintf("failed to query call log on %q: %v", serial, err), http.StatusBadGateway)
		return
	}
	recs := parseCallRows(out)
	if recs == nil {
		recs = []CallRecord{}
	}
	if len(recs) > limit {
		recs = recs[:limit]
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"calls": recs, "count": len(recs)})
}

// SmsHandler serves GET /api/adb/sms?serial=X&limit=300
func SmsHandler(w http.ResponseWriter, r *http.Request) {
	serial := r.URL.Query().Get("serial")
	if serial == "" {
		http.Error(w, "missing ?serial=", http.StatusBadRequest)
		return
	}
	if !serialRE.MatchString(serial) {
		http.Error(w, fmt.Sprintf("invalid serial %q", serial), http.StatusBadRequest)
		return
	}
	limit := 300
	if s := r.URL.Query().Get("limit"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v > 0 && v <= 2000 {
			limit = v
		}
	}
	out, err := runAdb(r, 25*time.Second, "-s", serial, "shell", "content", "query", "--uri", "content://sms", "--projection", "address:body:date:type:read")
	if err != nil {
		msg := err.Error()
		if strings.Contains(strings.ToLower(msg), "permission") || strings.Contains(msg, "SecurityException") {
			http.Error(w, "sms permission denied — this device blocks shell from reading SMS. Try: adb shell pm grant com.android.shell android.permission.READ_SMS ; adb shell appops set com.android.shell READ_SMS allow", http.StatusForbidden)
			return
		}
		http.Error(w, fmt.Sprintf("failed to query sms on %q: %v", serial, err), http.StatusBadGateway)
		return
	}
	recs := parseSmsRows(out)
	if recs == nil {
		recs = []SmsRecord{}
	}
	if len(recs) > limit {
		recs = recs[:limit]
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"messages": recs, "count": len(recs)})
}
