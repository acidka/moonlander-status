#!/usr/bin/env bash
# Flashes the Claude-status firmware onto a ZSA Moonlander and checks it answers.
#
#   firmware/flash.sh                    # detects rev A / rev B from the connected board
#   firmware/flash.sh revb               # or say which
#   firmware/flash.sh revb path/to.bin   # and/or which file (default: firmware/build/zsa_moonlander_<rev>_claude.bin)
#
# Needs dfu-util (brew install dfu-util) and a Python with hidapi
# (~/.claude-moonlander-venv, see README).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
helper="$root/mod/moonlander-status/bin/moonlander_status.py"

if [[ -x "$here/tools/dfu-util" ]]; then
    dfu="$here/tools/dfu-util"
elif command -v dfu-util >/dev/null; then
    dfu=$(command -v dfu-util)
else
    echo "dfu-util not found: brew install dfu-util" >&2; exit 1
fi

# The mod looks for its Python (with hidapi) here.
if [[ ! -e "$HOME/.claude-moonlander-venv" && -x "$root/.venv/bin/python" ]]; then
    ln -s "$root/.venv" "$HOME/.claude-moonlander-venv"
    echo "Linked ~/.claude-moonlander-venv -> $root/.venv"
fi
py="$HOME/.claude-moonlander-venv/bin/python"

rev=${1:-}
if [[ -z "$rev" ]]; then
    # ioreg lists idProduct before idVendor within each device (ZSA = 0x3297 = 12951).
    pid=$(ioreg -p IOUSB -l -w0 | awk '/"idProduct" =/{p=$NF} /"idVendor" = 12951/{print p; exit}')
    case "$pid" in
        6505) rev=reva ;;   # 0x1969
        6514) rev=revb ;;   # 0x1972
        8195) rev=revb ;;   # 0x2003: rev B already sitting in ZSA's bootloader
        *) echo "Could not detect the Moonlander revision; run: $0 reva|revb" >&2; exit 1 ;;
    esac
fi
# Bootloaders differ (keyboards/zsa/moonlander/rev*/): rev A is the STM32's own
# DFU at 0x08000000; rev B is ZSA's bootloader, which lives in the first 8 KB
# and takes the firmware at 0x08002000. Never write rev B at 0x08000000.
case "$rev" in
    reva) dfu_id=0483:df11; dfu_addr=0x08000000 ;;
    revb) dfu_id=3297:2003; dfu_addr=0x08002000 ;;
    *) echo "unknown revision: $rev (reva|revb)" >&2; exit 1 ;;
esac
bin=${2:-"$here/build/zsa_moonlander_${rev}_claude.bin"}
[[ -f "$bin" ]] || { echo "missing $bin (build it first, see README)" >&2; exit 1; }
echo "Flashing $(basename "$bin")"

echo
echo "Put the keyboard in bootloader mode now:"
echo "  press your layout's QK_BOOT key,"
echo "  or press the reset pinhole next to the LEDs on the left half."
echo "Waiting up to 60 s for the bootloader..."
for _ in $(seq 120); do
    if "$dfu" -l 2>/dev/null | grep -qi "$dfu_id"; then
        found=1
        break
    fi
    sleep 0.5
done
[[ -n "${found:-}" ]] || { echo "No bootloader ($dfu_id) seen. Nothing was flashed." >&2; exit 1; }

"$dfu" -a 0 -d "$dfu_id" -s "$dfu_addr:leave" -D "$bin"

echo
if [[ ! -x "$py" ]]; then
    echo "Flashed. No $py to check the keyboard with; see README (host helper)."
    exit 0
fi
echo "Flashed. Waiting for the keyboard to come back..."
for _ in $(seq 30); do
    sleep 1
    if "$py" "$helper" ping 2>/dev/null; then
        echo "Keyboard answers the Claude protocol. Showing the colors:"
        "$py" "$helper" demo
        echo "Done."
        exit 0
    fi
done
echo "Flashed, but the keyboard did not answer a ping yet. Try: $py $helper ping" >&2
exit 1
