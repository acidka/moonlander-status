// SPDX-License-Identifier: GPL-2.0-or-later
// Claude Code status lights for the ZSA Moonlander. See claude_status.h.
#include <string.h>
#include QMK_KEYBOARD_H
#include "raw_hid.h"
#include <lib/lib8tion/lib8tion.h>
#include "claude_status.h"

// Which keys show Claude's status, as {row, col} matrix positions.
// Moonlander matrix: left half rows 0-5, right half rows 6-11, cols 0-6.
// Row 0 / row 6 are the top rows. Override in config.h, e.g.
//   #define CLAUDE_STATUS_KEYS {{0, 0}, {6, 6}}
#ifndef CLAUDE_STATUS_KEYS
// Left half, top row: the 7 keys from the outer edge to the inner column.
#    define CLAUDE_STATUS_KEYS {{0, 0}, {0, 1}, {0, 2}, {0, 3}, {0, 4}, {0, 5}, {0, 6}}
#endif

// Blink half-period and breathe speed, milliseconds-ish.
#ifndef CLAUDE_STATUS_BLINK_MS
#    define CLAUDE_STATUS_BLINK_MS 400
#endif
#ifndef CLAUDE_STATUS_BREATHE_SHIFT
#    define CLAUDE_STATUS_BREATHE_SHIFT 3 // larger = slower (period ~ 256 << shift ms)
#endif

enum {
    CMD_CLEAR = 0x00,
    CMD_SET   = 0x01,
    CMD_PING  = 0x02,
};

enum {
    EFFECT_SOLID   = 0,
    EFFECT_BREATHE = 1,
    EFFECT_BLINK   = 2,
};

static const uint8_t claude_keys[][2] = CLAUDE_STATUS_KEYS;

static struct {
    bool    active;
    uint8_t r, g, b;
    uint8_t effect;
    uint8_t state;
} claude = {0};

bool claude_status_hid_receive(uint8_t *data, uint8_t length) {
    if (length < 7 || data[0] != CLAUDE_STATUS_MAGIC) {
        return false;
    }

    uint8_t status = 0x00;
    switch (data[1]) {
        case CMD_CLEAR:
            claude.active = false;
            claude.state  = 0;
            break;
        case CMD_SET:
            claude.r      = data[2];
            claude.g      = data[3];
            claude.b      = data[4];
            claude.effect = data[5];
            claude.state  = data[6];
            claude.active = true;
            break;
        case CMD_PING:
            break;
        default:
            status = 0xFF;
            break;
    }

    uint8_t command = data[1];
    memset(data, 0, length);
    data[0] = CLAUDE_STATUS_MAGIC;
    data[1] = command;
    data[2] = status;
    data[3] = CLAUDE_STATUS_PROTOCOL;
    data[4] = claude.state;
    raw_hid_send(data, length);
    return true;
}

// 0..255 brightness factor for the current effect.
static uint8_t claude_effect_level(void) {
    uint32_t now = timer_read32();
    switch (claude.effect) {
        case EFFECT_BREATHE: {
            // sin8 swings 0..255; keep a floor so the keys never go fully dark.
            uint8_t wave = sin8((uint8_t)(now >> CLAUDE_STATUS_BREATHE_SHIFT));
            return 40 + scale8(wave, 215);
        }
        case EFFECT_BLINK:
            return ((now / CLAUDE_STATUS_BLINK_MS) & 1) ? 255 : 0;
        default:
            return 255;
    }
}

void claude_status_render(uint8_t led_min, uint8_t led_max) {
    if (!claude.active) {
        return;
    }

    // Follow the keyboard's brightness setting, but never below a visible floor.
    uint8_t brightness = rgb_matrix_get_val();
    if (brightness < 64) brightness = 64;
    uint8_t level = scale8(claude_effect_level(), brightness);

    uint8_t r = scale8(claude.r, level);
    uint8_t g = scale8(claude.g, level);
    uint8_t b = scale8(claude.b, level);

    for (uint8_t i = 0; i < ARRAY_SIZE(claude_keys); i++) {
        uint8_t row = claude_keys[i][0];
        uint8_t col = claude_keys[i][1];
        if (row >= MATRIX_ROWS || col >= MATRIX_COLS) continue;

        uint8_t led = g_led_config.matrix_co[row][col];
        if (led == NO_LED || led < led_min || led >= led_max) continue;

        rgb_matrix_set_color(led, r, g, b);
    }
}
