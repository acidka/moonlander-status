// SPDX-License-Identifier: GPL-2.0-or-later
// Claude Code status lights for the ZSA Moonlander (QMK / ZSA fork).
//
// The host (the Claude Code mod) sends 32-byte Raw HID reports:
//
//   [0] 0xC1 magic
//   [1] command   0x00 CLEAR (give the keys back to the normal RGB effect)
//                 0x01 SET   (paint the Claude keys)
//                 0x02 PING  (answer only)
//   [2] red    } SET only
//   [3] green  }
//   [4] blue   }
//   [5] effect    0 solid, 1 breathe, 2 blink
//   [6] state id  (informational, echoed back)
//
// Every report starting with 0xC1 is answered with
//   [0xC1, command, 0x00 ok / 0xFF bad command, CLAUDE_STATUS_PROTOCOL, state id]
#pragma once

#include <stdbool.h>
#include <stdint.h>

#define CLAUDE_STATUS_MAGIC 0xC1
#define CLAUDE_STATUS_PROTOCOL 1

// Handles one Raw HID report. Returns true when it was a Claude report
// (it has answered it), false when the report belongs to someone else (Oryx).
bool claude_status_hid_receive(uint8_t *data, uint8_t length);

// Paints the Claude keys within [led_min, led_max); call it after anything
// else that paints LEDs (claude_oryx.c calls it after the layer colors).
void claude_status_render(uint8_t led_min, uint8_t led_max);
