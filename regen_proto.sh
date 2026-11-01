#!/bin/bash

#
# Copyright 2015 Google Inc. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

# Regenerates the compiled Go files in pb/ after modifying a .proto file.
#
# Requires protoc (>= v25) and protoc-gen-go:
#   go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
# with $GOBIN (usually $GOPATH/bin) on your $PATH.
#
# Run from the repository root.

set -e
cd "$(dirname "$0")"

protoc -I . --go_out=. --go_opt=paths=source_relative \
  pb/batterystats_proto/batterystats.proto \
  pb/build_proto/build.proto \
  pb/metrics_proto/metrics_constants.proto \
  pb/session_proto/session.proto \
  pb/usagestats_proto/android_battery_usage.proto \
  pb/usagestats_proto/android_package_info.proto

echo "Regenerated pb/*.pb.go"
