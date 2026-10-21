#!/usr/bin/env python3
"""Send Claude Code status colors to a ZSA Moonlander over Raw HID.

    moonlander_status.py set <r> <g> <b> <effect> [state-id]   effect: solid|breathe|blink
    moonlander_status.py clear
    moonlander_status.py ping
    moonlander_status.py watch <file>  keep applying <file> ("clear" or "r g b effect id")
    moonlander_status.py list          show matching HID interfaces
    moonlander_status.py demo          cycle through a few colors

Needs the `hidapi` package (pip install hidapi). Exit codes: 0 ok, 2 no
keyboard found, 3 keyboard did not answer (firmware without claude_status),
4 hidapi missing, 1 usage error.
"""
import sys
import time

ZSA_VID = 0x3297
RAW_USAGE_PAGE = 0xFF60
RAW_USAGE = 0x61
REPORT = 32
MAGIC = 0xC1
EFFECTS = {"solid": 0, "breathe": 1, "blink": 2}

try:
    import hid
except ImportError:
    sys.stderr.write("hidapi missing: python3 -m pip install hidapi\n")
    sys.exit(4)


def interfaces():
    return [
        d for d in hid.enumerate(ZSA_VID, 0)
        if d.get("usage_page") == RAW_USAGE_PAGE and d.get("usage") == RAW_USAGE
    ]


def send(payload):
    found = interfaces()
    if not found:
        sys.stderr.write("no Moonlander raw HID interface found (is RAW_ENABLE on?)\n")
        return 2
    code = 3
    for info in found:
        dev = hid.device()
        try:
            for attempt in range(10):  # the watcher may hold it for a moment
                try:
                    dev.open_path(info["path"])
                    break
                except OSError:
                    if attempt == 9:
                        raise
                    time.sleep(0.1)
            packet = bytes(payload) + bytes(REPORT - len(payload))
            dev.write(b"\x00" + packet)  # leading 0 = report id
            # Oryx shares the interface: skip its events, wait for our answer.
            deadline = time.monotonic() + 0.5
            while time.monotonic() < deadline:
                reply = dev.read(REPORT, 100)
                if not reply:
                    continue
                if reply[0] == MAGIC:
                    code = 0 if reply[2] == 0 else 3
                    break
                if reply[0] == 0xFF and reply[1] == 0xFF:
                    sys.stderr.write("Oryx answered 'unknown command': flash the claude_status firmware\n")
                    break
        except OSError as err:
            sys.stderr.write(f"{info.get('product_string')}: {err}\n")
        finally:
            dev.close()
    if code == 3:
        sys.stderr.write("keyboard did not answer; is the claude_status firmware flashed?\n")
    return code


def parse_state(text):
    """`clear` or `<r> <g> <b> <effect> <id>` -> report payload, None if unreadable."""
    parts = text.split()
    if parts == ["clear"]:
        return [MAGIC, 0x00]
    if len(parts) == 5:
        try:
            r, g, b, state = (max(0, min(255, int(v))) for v in (*parts[:3], parts[4]))
        except ValueError:
            return None
        return [MAGIC, 0x01, r, g, b, EFFECTS.get(parts[3], 0), state]
    return None


class Link:
    """Sends one report per open: hidapi opens a device exclusively on macOS,
    so holding it open would lock out Keymapp and the `ping`/`demo` commands."""

    def close(self):
        pass

    def write(self, payload):
        for _ in range(3):
            found = interfaces()
            if not found:
                return False
            dev = hid.device()
            try:
                dev.open_path(found[0]["path"])
                dev.write(b"\x00" + bytes(payload) + bytes(REPORT - len(payload)))
                dev.read(REPORT, 100)  # drain the answer
                return True
            except OSError:
                time.sleep(0.1)  # someone else has it open; try again shortly
            finally:
                dev.close()
        return False


def watch(path):
    """Applies the state file to the keyboard whenever it changes.

    One watcher per machine drives the keyboard (an flock); the others wait
    their turn, so several Claude sessions can each start one.
    """
    import fcntl
    import os
    import signal

    stopping = []
    signal.signal(signal.SIGTERM, lambda *_: stopping.append(1))
    signal.signal(signal.SIGINT, lambda *_: stopping.append(1))

    lock = open(path + ".lock", "w")
    while not stopping:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except OSError:
            time.sleep(1)
    if stopping:
        return 0

    def report(ok):
        # Heartbeat for the mod: "<connected|no-keyboard> <unix time>".
        try:
            with open(path + ".status", "w") as f:
                f.write(f"{'connected' if ok else 'no-keyboard'} {int(time.time())}\n")
        except OSError:
            pass

    link = Link()
    seen = None
    sent = [MAGIC, 0x02]  # ping until the first state arrives
    last_send = 0.0
    connected = None
    while not stopping:
        try:
            stamp = os.stat(path).st_mtime_ns
        except FileNotFoundError:
            stamp = None
        if stamp != seen:
            seen = stamp
            try:
                with open(path) as f:
                    payload = parse_state(f.read())
            except OSError:
                payload = None
            if payload is not None:
                sent, last_send = payload, 0.0
        now = time.monotonic()
        # Re-send now and then: the keyboard forgets its state when replugged.
        if now - last_send > 5:
            ok = link.write(sent)
            last_send = now
            report(ok)
            if ok != connected:
                connected = ok
                print("connected" if ok else "no keyboard", flush=True)
        time.sleep(0.05)

    link.write([MAGIC, 0x00])
    link.close()
    try:
        os.remove(path + ".status")
    except OSError:
        pass
    return 0


def main(argv):
    if not argv:
        print(__doc__)
        return 1
    cmd = argv[0]
    if cmd == "set" and len(argv) >= 5:
        r, g, b = (max(0, min(255, int(v))) for v in argv[1:4])
        effect = EFFECTS.get(argv[4], 0)
        state = int(argv[5]) if len(argv) > 5 else 0
        return send([MAGIC, 0x01, r, g, b, effect, state])
    if cmd == "clear":
        return send([MAGIC, 0x00])
    if cmd == "ping":
        return send([MAGIC, 0x02])
    if cmd == "watch" and len(argv) == 2:
        return watch(argv[1])
    if cmd == "list":
        for d in interfaces():
            print(f"{d['vendor_id']:04x}:{d['product_id']:04x} {d.get('product_string')} {d['path']!r}")
        return 0
    if cmd == "demo":
        for rgb, eff in [((0, 255, 0), "solid"), ((0, 80, 255), "breathe"),
                         ((255, 160, 0), "solid"), ((255, 0, 0), "blink")]:
            rc = send([MAGIC, 0x01, *rgb, EFFECTS[eff], 0])
            if rc:
                return rc
            time.sleep(2)
        return send([MAGIC, 0x00])
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
