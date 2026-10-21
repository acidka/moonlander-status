// SPDX-License-Identifier: GPL-2.0-or-later
// Glue for Oryx layouts (keymap.json "modules": ["zsa/oryx", ...]).
//
// Neither keymap.c nor the zsa/oryx module needs editing:
//
// raw_hid_receive: the zsa/oryx module owns it (Keymapp / Oryx live
//   training). rules.mk links with -Wl,--wrap=raw_hid_receive, so Claude
//   reports (first byte 0xC1, which Oryx never uses) are handled here and
//   everything else goes on to Oryx untouched.
//
// Indicators: Oryx's keymap.c paints the layer colors in
//   rgb_matrix_indicators_user, over all LEDs, on the last pass of each frame.
//   The Claude keys are painted right after it, so they win. (The _advanced
//   hook only covers one slice of LEDs per pass, so Oryx's full repaint
//   would hide the Claude keys.)
#include QMK_KEYBOARD_H
#include "claude_status.h"

void __real_raw_hid_receive(uint8_t *data, uint8_t length);

void __wrap_raw_hid_receive(uint8_t *data, uint8_t length) {
    if (!claude_status_hid_receive(data, length)) {
        __real_raw_hid_receive(data, length);
    }
}

// The keyboard level of the indicator chain (weak in quantum/rgb_matrix.c,
// not defined by keyboards/zsa/moonlander): layer colors first, then Claude.
bool rgb_matrix_indicators_kb(void) {
    bool result = rgb_matrix_indicators_user();
    claude_status_render(0, RGB_MATRIX_LED_COUNT);
    return result;
}
