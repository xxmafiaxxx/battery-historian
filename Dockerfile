# Battery Historian — modernized build.
# Multi-stage: build the React UI, build the Go server, ship a small runtime
# with Python 3 (only needed for the optional kernel-trace converter).

# --- Stage 1: build the SPA -------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- Stage 2: build the Go server -------------------------------------------
FROM golang:1.27-alpine AS server
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -o /battery-historian ./cmd/battery-historian

# --- Stage 3: runtime --------------------------------------------------------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates python3 && adduser -D historian
COPY --from=server /battery-historian /battery-historian
COPY --from=web /src/web/dist /app/web/dist
# The Go binary parses templates at startup and serves static assets;
# scripts/ carries the Python 3 kernel-trace converter.
COPY templates /app/templates
COPY static /app/static
COPY scripts /app/scripts
USER historian
WORKDIR /app
EXPOSE 9999
# The legacy Closure UI additionally needs compiled/ + third_party/ built by
# `go run setup.go`; this image ships the modern UI only.
ENTRYPOINT ["/battery-historian"]
CMD ["--port", "9999", "--dist_dir", "/app/web/dist", "--template_dir", "/app/templates", "--static_dir", "/app/static", "--scripts_dir", "/app/scripts"]
