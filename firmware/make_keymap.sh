#!/usr/bin/env bash
# Builds a QMK keymap folder from an Oryx "Download source" folder plus the
# Claude status code. Re-run it whenever you change the layout in Oryx.
#
#   firmware/make_keymap.sh <oryx *_source folder> <output keymap folder>
#   e.g. firmware/make_keymap.sh ~/Downloads/zsa_moonlander_..._source firmware/keymaps/claude
#
# Then copy (or symlink) the output into
#   <zsa qmk_firmware>/keyboards/zsa/moonlander/keymaps/<name>
set -euo pipefail

src=${1:?oryx source folder (the one with keymap.c, rules.mk, config.h)}
out=${2:?output keymap folder}
here=$(cd "$(dirname "$0")" && pwd)

for f in keymap.c rules.mk config.h; do
    [[ -f "$src/$f" ]] || { echo "missing $src/$f" >&2; exit 1; }
done

mkdir -p "$out"
cp "$src"/keymap.c "$src"/rules.mk "$src"/config.h "$out"/
[[ -f "$src/keymap.json" ]] && cp "$src/keymap.json" "$out"/
cp "$here"/src/claude_status.c "$here"/src/claude_status.h "$here"/src/claude_oryx.c "$out"/


cat >> "$out/rules.mk" <<'EOF'

# --- Claude Code status lights ---
RAW_ENABLE = yes
SRC += claude_status.c claude_oryx.c
# zsa/oryx owns raw_hid_receive; route it through claude_oryx.c first.
EXTRALDFLAGS += -Wl,--wrap=raw_hid_receive
EOF

cat >> "$out/config.h" <<'EOF'

// --- Claude Code status lights ---
// Keys that show Claude's status, {row, col}: left half rows 0-5, right half
// rows 6-11, columns 0-6. Default: both thumb clusters (8 keys):
//   left:  {5,0} {5,1} {5,2}  + {5,3} big red key
//   right: {11,4} {11,5} {11,6} + {11,3} big red key
// (The left top row instead: {0,0} ... {0,6}.)
#define CLAUDE_STATUS_KEYS {{5, 0}, {5, 1}, {5, 2}, {5, 3}, {11, 3}, {11, 4}, {11, 5}, {11, 6}}
EOF

echo "keymap written to $out"
