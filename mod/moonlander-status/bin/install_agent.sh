#!/usr/bin/env bash
# Installs (or with --uninstall removes) a macOS LaunchAgent that keeps the
# Moonlander watcher running outside Claude Code's sandbox. The mod writes
# ~/.cache/claude-moonlander/state; this watcher pushes it to the keyboard.
set -euo pipefail

label=com.claude.moonlander-status
plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"
here=$(cd "$(dirname "$0")" && pwd)
helper="$here/moonlander_status.py"
python="$HOME/.claude-moonlander-venv/bin/python"
dir="$HOME/.cache/claude-moonlander"

launchctl bootout "$domain/$label" 2>/dev/null || true
if [[ "${1:-}" == "--uninstall" ]]; then
    rm -f "$plist"
    echo "Removed $label"
    exit 0
fi

[[ -x "$python" ]] || { echo "missing $python (python3 -m venv + pip install hidapi)" >&2; exit 1; }
"$python" -c "import hid" || { echo "$python has no hidapi: $python -m pip install hidapi" >&2; exit 1; }
mkdir -p "$dir" "$(dirname "$plist")"

cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>$python</string>
        <string>$helper</string>
        <string>watch</string>
        <string>$dir/state</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ProcessType</key><string>Background</string>
    <key>StandardOutPath</key><string>$dir/watcher.log</string>
    <key>StandardErrorPath</key><string>$dir/watcher.log</string>
</dict>
</plist>
EOF

launchctl bootstrap "$domain" "$plist"
echo "Installed $label (helper: $helper)"

for _ in $(seq 10); do
    sleep 1
    if [[ -f "$dir/state.status" ]]; then
        echo "Watcher: $(cat "$dir/state.status")"
        exit 0
    fi
done
echo "Watcher started but has not reported yet; see $dir/watcher.log" >&2
