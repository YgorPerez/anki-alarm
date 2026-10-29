"""Taps the app's screens over adb, for the emulator ring scenarios (#42, after #6's ui.py).

    python3 -I ui.py -s SERIAL tap "Começar" [N]  # taps the Nth (default first) node with that text
    python3 -I ui.py -s SERIAL has "Começar"      # exit 0 if some node's text contains it
    python3 -I ui.py -s SERIAL texts              # prints every visible text
"""

import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

ADB = os.path.expanduser("~/Android/Sdk/platform-tools/adb")
args = sys.argv[1:]
serial = []
if args[:1] == ["-s"]:
    serial, args = ["-s", args[1]], args[2:]


def adb(*cmd: str) -> str:
    return subprocess.run([ADB, *serial, *cmd], capture_output=True, text=True, check=True).stdout


def nodes():
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
    root = ET.fromstring(adb("shell", "cat", "/sdcard/ui.xml"))
    for n in root.iter("node"):
        text = n.get("text") or n.get("content-desc") or ""
        if text:
            yield text, n.get("bounds")


def center(bounds: str):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", bounds))
    return (x1 + x2) // 2, (y1 + y2) // 2


verb, *rest = args
if verb == "texts":
    for text, _ in nodes():
        print(text)
elif verb == "has":
    sys.exit(0 if any(rest[0] in t for t, _ in nodes()) else 1)
elif verb == "tap":
    nth, seen, count = int(rest[1]) if len(rest) > 1 else 1, set(), 0
    for text, bounds in nodes():
        if text == rest[0] and bounds not in seen:
            seen.add(bounds)
            count += 1
            if count < nth:
                continue
            x, y = center(bounds)
            adb("shell", "input", "tap", str(x), str(y))
            print(f"tapped {text!r} at {x},{y}")
            break
    else:
        sys.exit(f"no node with text {rest[0]!r}")
