#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
/usr/bin/time -p pwd
PROJECT_DIR="$(pwd -P)"
DIST_DIR="$PROJECT_DIR/dist"
PORT="${PORT:-3000}"
export PORT
AGENTIC_OS_API_KEY="${AGENTIC_OS_API_KEY:-agentictemp}"
export AGENTIC_OS_API_KEY
AGENTIC_OS_DATA_DIR="${AGENTIC_OS_DATA_DIR:-$PROJECT_DIR/data}"
export AGENTIC_OS_DATA_DIR
/usr/bin/time -p mkdir -p "$AGENTIC_OS_DATA_DIR"
echo "data_dir=$AGENTIC_OS_DATA_DIR"
WEB_DIR="${OPENCODE_WEB_DIR:-/home/runner/work/_temp/omgithub-web}"
echo "project=$PROJECT_DIR port=$PORT dist=$DIST_DIR web_dir=$WEB_DIR"
/usr/bin/time -p mkdir -p "$DIST_DIR"
/usr/bin/time -p cp -r "$PROJECT_DIR/agentic_os/server/static/." "$DIST_DIR/"
/usr/bin/time -p test -f "$DIST_DIR/index.html"
/usr/bin/time -p mkdir -p "$WEB_DIR"
/usr/bin/time -p printf '{"project":"%s","directory":"%s"}' "$PROJECT_DIR" "$DIST_DIR" > "$WEB_DIR/deployment-output.json"
/usr/bin/time -p cat "$WEB_DIR/deployment-output.json"
echo ""
/usr/bin/time -p python3 -c "import agentic_os" || /usr/bin/time -p pip install -e .
/usr/bin/time -p python3 -c "import agentic_os; print('agentic_os import ok')"
exec /usr/bin/time -p python3 -m agentic_os.cli serve --host 0.0.0.0 --port "$PORT"
