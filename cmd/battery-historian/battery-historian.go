// Copyright 2016 Google Inc. All Rights Reserved.
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

// Historian v2 analyzes bugreports and outputs battery analysis results.
package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"time"

	"github.com/google/battery-historian/analyzer"
)

var (
	optimized = flag.Bool("optimized", true, "Whether to output optimized js files. Disable for local debugging.")
	port      = flag.Int("port", 9999, "service port")

	compiledDir   = flag.String("compiled_dir", "./compiled", "Directory containing compiled js file for Historian v2 (legacy UI).")
	adbPath       = flag.String("adb_path", "adb", "Path to the adb binary used by the pull-from-device feature.")
	distDir       = flag.String("dist_dir", "./web/dist", "Directory containing the built React UI (web/dist).")
	jsDir         = flag.String("js_dir", "./js", "Directory containing uncompiled js files for Historian v2.")
	scriptsDir    = flag.String("scripts_dir", "./scripts", "Directory containing Historian and kernel trace Python scripts.")
	staticDir     = flag.String("static_dir", "./static", "Directory containing static files.")
	templateDir   = flag.String("template_dir", "./templates", "Directory containing HTML templates.")
	thirdPartyDir = flag.String("third_party_dir", "./third_party", "Directory containing third party files for Historian v2.")

	// resVersion should be incremented whenever the JS or CSS files are modified.
	resVersion = flag.Int("res_version", 2, "The current version of JS and CSS files. Used to force JS and CSS reloading to avoid cache issues when rolling out new versions.")
)

type analysisServer struct{}

func (s *analysisServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	log.Printf("Trace starting analysisServer processing for: %s", r.Method)
	defer log.Printf("Trace finished analysisServer processing for: %s", r.Method)

	switch r.Method {
	case "GET":
		analyzer.UploadHandler(w, r)
	case "POST":
		r.ParseForm()
		analyzer.HTTPAnalyzeHandler(w, r)
	default:
		http.Error(w, fmt.Sprintf("Method %s not allowed", r.Method), http.StatusMethodNotAllowed)
	}
}

func compiledPath() string {
	dir := *compiledDir
	if dir == "" {
		dir = "./compiled"
	}
	return dir
}

func jsPath() string {
	dir := *jsDir
	if dir == "" {
		dir = "./js"
	}
	return dir
}

func staticPath() string {
	dir := *staticDir
	if dir == "" {
		dir = "./static"
	}
	return dir
}

func thirdPartyPath() string {
	dir := *thirdPartyDir
	if dir == "" {
		dir = "./third_party"
	}
	return dir
}

func distPath() string {
	dir := *distDir
	if dir == "" {
		dir = "./web/dist"
	}
	return dir
}

func initFrontend() {
	urlDirs := map[string]string{
		"compiled":    compiledPath(),
		"static":      staticPath(),
		"third_party": thirdPartyPath(),
	}

	// The legacy Closure UI lives entirely under /legacy/.
	for _, p := range []string{"/legacy/"} {
		http.Handle(p, &analysisServer{})

		for u, f := range urlDirs {
			url := path.Join(p, u) + "/"
			http.Handle(url, http.StripPrefix(url, http.FileServer(http.Dir(f))))
		}
		if *optimized == false {
			// Need to handle calls to fetch closure library and js files.
			j := path.Join(p, "js") + "/"
			http.Handle(j, http.StripPrefix(j, http.FileServer(http.Dir(jsPath()))))
		}
	}

	// The modern SPA is served from the root. POST / remains the analysis
	// endpoint so both UIs use the same API contract.
	http.Handle("/", &rootServer{dist: distPath()})
}

// rootServer serves the compiled React app for GET requests and forwards
// analysis POSTs to the analyzer handler.
type rootServer struct {
	dist string
}

func (s *rootServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Direct-from-device endpoints (see analyzer/adb.go).
	if r.URL.Path == "/api/adb/devices" && r.Method == "GET" {
		analyzer.AdbDevicesHandler(w, r)
		return
	}
	if r.URL.Path == "/api/adb/bugreport" && r.Method == "POST" {
		analyzer.AdbBugreportHandler(w, r)
		return
	}
	if r.URL.Path == "/api/adb/fallback" && r.Method == "POST" {
		analyzer.AdbFallbackHandler(w, r)
		return
	}
	if r.URL.Path == "/api/adb/live" && r.Method == "GET" {
		analyzer.LiveBatteryHandler(w, r)
		return
	}
	if r.URL.Path == "/api/adb/last-report" && r.Method == "GET" {
		analyzer.AdbLastReportHandler(w, r)
		return
	}
	switch r.Method {
	case "POST":
		r.ParseForm()
		analyzer.HTTPAnalyzeHandler(w, r)
	case "GET", "HEAD":
		serveSPA(w, r, s.dist)
	default:
		http.Error(w, fmt.Sprintf("Method %s not allowed", r.Method), http.StatusMethodNotAllowed)
	}
}

// serveSPA serves files from the built SPA directory, falling back to
// index.html for client-side routed paths. Cleaning the URL before joining
// prevents path traversal outside dist.
func serveSPA(w http.ResponseWriter, r *http.Request, dir string) {
	name := filepath.Clean("/" + r.URL.Path)
	p := filepath.Join(dir, filepath.FromSlash(name))
	if info, err := os.Stat(p); err == nil && !info.IsDir() {
		http.ServeFile(w, r, p)
		return
	}
	index := filepath.Join(dir, "index.html")
	if _, err := os.Stat(index); err != nil {
		http.Error(w, "SPA build not found; run `npm run build` in web/ or use /legacy/", http.StatusNotFound)
		return
	}
	http.ServeFile(w, r, index)
}

func main() {
	flag.Parse()

	initFrontend()
	analyzer.InitTemplates(*templateDir)
	analyzer.SetScriptsDir(*scriptsDir)
	analyzer.SetResVersion(*resVersion)
	analyzer.SetIsOptimized(*optimized)
	analyzer.SetAdbPath(*adbPath)
	log.Println("Listening on port: ", *port)
	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", *port),
		ReadHeaderTimeout: 30 * time.Second,
		// Writes can take a while: uploads are large bug reports and analysis runs
		// several parsers, so the write timeout is generous.
		WriteTimeout: 10 * time.Minute,
		ReadTimeout:  10 * time.Minute,
		IdleTimeout:  5 * time.Minute,
	}
	log.Fatal(srv.ListenAndServe())
}
