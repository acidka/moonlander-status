#!/usr/bin/env bash
# Steps the Moonlander's Claude keys through every status, for a video.
# Writes the same state file the mod writes; the watcher pushes each change
# to the keyboard within ~50 ms.
#
#   demo_states.sh [seconds per status] [rounds]     (defaults: 4 s, 1 round)
set -euo pipefail

hold=${1:-4}
rounds=${2:-1}
state="$HOME/.cache/claude-moonlander/state"

# Same colors as STATES in hooks/register.ts: r g b effect id
steps=(
    "0 255 40 solid 1|Idle: waiting for your prompt (green)"
    "217 90 30 breathe 2|Thinking (orange, breathing)"
    "0 90 255 solid 3|Running a tool (blue)"
    "255 200 0 blink 4|Waiting for you: permission / question (yellow, blinking)"
    "255 0 0 solid 5|Error (red)"
    "clear|Session ended: back to your normal colors"
)

[[ -f "$state.status" ]] || echo "warning: the watcher does not seem to run (no $state.status)" >&2

for ((r = 1; r <= rounds; r++)); do
    for step in "${steps[@]}"; do
        echo "${step%%|*}" > "$state"
        echo "  ${step#*|}"
        sleep "$hold"
    done
done

echo "0 255 40 solid 1" > "$state"
echo "Done: back to idle (green)."
