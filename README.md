# Claude status on a ZSA Moonlander

Keys you choose on a [ZSA Moonlander](https://www.zsa.io/moonlander) light up
according to what [Claude Code](https://claude.com/claude-code) is doing:

| Claude is…                                            | Keys                     |
| ----------------------------------------------------- | ------------------------ |
| idle, waiting for your prompt                         | green, solid             |
| thinking                                              | Claude orange, breathing |
| running a tool                                        | blue, solid              |
| waiting for you (permission, question, plan approval) | yellow, blinking         |
| stopped on an error or refusal                        | red, solid               |
| session ended                                         | back to your normal RGB  |

```
Claude Code ──hooks──▶ moonlander-status mod ──writes──▶ ~/.cache/claude-moonlander/state
                                                            │
                         bin/moonlander_status.py watch ◀───┘
                                       │ Raw HID (usage page 0xFF60), 32-byte reports
                                       ▼
                    Moonlander firmware: claude_status.c paints the keys
```

Colors and effects are sent by the host, so changing them never needs a
reflash. Which keys light up is set in the firmware.

It works on top of your own Oryx layout: Oryx live training and Keymapp keep
working.

## Layout of this repo

```
firmware/
  src/             claude_status.c/.h, claude_oryx.c (the firmware add-on)
  make_keymap.sh   Oryx source + add-on -> QMK keymap folder
  flash.sh         flashes a build and checks the keyboard answers
mod/moonlander-status/
  hooks/           the Claude Code mod (register.ts)
  bin/             host helper (moonlander_status.py), LaunchAgent installer, demo
.claude-plugin/    plugin marketplace manifest
```

## Requirements

- ZSA Moonlander, rev A or rev B, with a layout made in [Oryx](https://configure.zsa.io/).
- macOS (the watcher runs as a LaunchAgent). The helper itself also works on
  Linux; add a udev rule for vendor `3297` (ZSA documents one for Keymapp).
- Python 3 with [`hidapi`](https://pypi.org/project/hidapi/).
- [QMK CLI](https://docs.qmk.fm/) and ZSA's QMK fork to build the firmware.
- `dfu-util` (`brew install dfu-util`) or [Keymapp](https://www.zsa.io/flash) to flash.

## 1. Firmware

The firmware is your Oryx layout plus `firmware/src/`. Oryx's `zsa/oryx`
module owns `raw_hid_receive`, so the keymap links with
`-Wl,--wrap=raw_hid_receive`; `claude_oryx.c` takes only the Claude reports
(first byte `0xC1`, which Oryx never uses) and passes every other report on to
Oryx. Oryx paints layer colors on the last render pass, so the Claude keys are
painted from `rgb_matrix_indicators_kb`, after it.

1. In Oryx, open your layout and choose **Download source**. Unzip it.
2. Build the keymap folder from it (re-run after every layout change):
   ```sh
   firmware/make_keymap.sh path/to/zsa_moonlander_..._source firmware/keymaps/claude
   ```
   `firmware/keymaps/`, `firmware/build/` and `oryx_firmware/` are git-ignored,
   so your layout stays out of the repo.
3. Choose the keys (optional) at the end of `firmware/keymaps/claude/config.h`.
   Positions are `{row, col}`: left half rows 0–5, right half rows 6–11,
   columns 0–6. The default is both thumb clusters, including the big red keys:
   ```c
   #define CLAUDE_STATUS_KEYS {{5, 0}, {5, 1}, {5, 2}, {5, 3}, {11, 3}, {11, 4}, {11, 5}, {11, 6}}
   #define CLAUDE_STATUS_BLINK_MS 400       // blink half-period
   #define CLAUDE_STATUS_BREATHE_SHIFT 3     // bigger = slower breathing
   ```
4. Set up ZSA's QMK fork (use the branch matching the firmware badge Oryx shows
   for your layout; `firmware25` at the time of writing) and link the keymap in:
   ```sh
   brew install qmk/qmk/qmk          # or: python3 -m pip install qmk
   git clone --recurse-submodules -b firmware25 https://github.com/zsa/qmk_firmware.git ~/zsa_qmk
   qmk setup -H ~/zsa_qmk -y
   ln -s "$PWD/firmware/keymaps/claude" ~/zsa_qmk/keyboards/zsa/moonlander/keymaps/claude
   ```
5. Build for your board's revision (on the sticker under the keyboard, or in
   Keymapp) and copy the result into `firmware/build/`:
   ```sh
   (cd ~/zsa_qmk && qmk compile -kb zsa/moonlander/revb -km claude)   # or reva
   mkdir -p firmware/build && cp ~/zsa_qmk/zsa_moonlander_revb_claude.bin firmware/build/
   ```
6. Flash it:
   ```sh
   firmware/flash.sh        # detects the revision, waits for the bootloader, flashes, then pings
   ```
   Rev B boards use ZSA's bootloader and take the firmware at `0x08002000`;
   `flash.sh` handles this. Never write a rev B build at `0x08000000`, that
   overwrites the bootloader. Flashing the `.bin` with Keymapp works too.

To go back to stock firmware, flash your Oryx `.bin` with Keymapp.
RGB has to be on (the keyboard's RGB toggle) for the keys to show anything.

## 2. Host helper

The helper needs Python with `hidapi`, in the place the LaunchAgent looks:

```sh
python3 -m venv ~/.claude-moonlander-venv
~/.claude-moonlander-venv/bin/pip install hidapi
```

Check the keyboard answers:

```sh
~/.claude-moonlander-venv/bin/python mod/moonlander-status/bin/moonlander_status.py ping   # exit 0 = firmware OK
~/.claude-moonlander-venv/bin/python mod/moonlander-status/bin/moonlander_status.py demo   # cycles the colors
```

Claude Code's sandbox cannot open HID devices, so the keyboard is driven by a
LaunchAgent outside it. The mod only writes `~/.cache/claude-moonlander/state`;
the watcher pushes every change to the keyboard. Install it (remove with
`--uninstall`):

```sh
mod/moonlander-status/bin/install_agent.sh
```

macOS hidapi opens devices exclusively, so the watcher opens the keyboard per
send and closes it right away; Keymapp keeps working alongside it.

## 3. The Claude Code mod

This repo is a Claude Code plugin marketplace. Install the mod once, for every
future session:

```sh
claude plugin marketplace add acidka/<this-repo>      # or a local clone: claude plugin marketplace add .
claude plugin install moonlander-status@keyboard --scope user
```

- `/moonlander` says whether the watcher runs and the keyboard answers.
- The status line shows `⌨ Moonlander watcher not running` or
  `⌨ Moonlander not answering` when something is off.
- Colors: edit `STATES` at the top of `mod/moonlander-status/hooks/register.ts`,
  then run `/reload-plugins`.
- Several Claude sessions at once: the last session that changed state wins.
- `mod/moonlander-status/bin/demo_states.sh` steps through every status, handy
  for a video.

## License

[GPL-2.0-or-later](LICENSE), same as QMK.
