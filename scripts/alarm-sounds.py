"""Writes the bundled alarm sounds (Core's BUNDLED_SOUNDS) as looping mono WAVs.

They are synthesized here so the repository owns them outright. Run from the repository root:
python3 scripts/alarm-sounds.py
"""

import math
import struct
import wave
from pathlib import Path

RATE = 22050
OUT = Path("apps/mobile/modules/alarm-native/android/src/main/res/raw")


def silence(seconds):
    return [0.0] * int(RATE * seconds)


def note(freq, seconds, partials, attack, decay):
    """A tone from (ratio, gain) partials with a linear attack and an exponential decay."""
    out = []
    for i in range(int(RATE * seconds)):
        t = i / RATE
        envelope = min(1.0, t / attack) * math.exp(-t / decay)
        out.append(envelope * sum(g * math.sin(2 * math.pi * freq * r * t) for r, g in partials))
    return out


def mix(length, *placed):
    out = [0.0] * int(RATE * length)
    for start, samples in placed:
        offset = int(RATE * start)
        for i, sample in enumerate(samples[: len(out) - offset]):
            out[offset + i] += sample
    return out


def dawn():
    # A rising C-major pentatonic arpeggio of soft, warm tones.
    warm = [(1, 1.0), (2, 0.25), (3, 0.08)]
    steps = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]
    return mix(4.0, *[(i * 0.5, note(f, 1.4, warm, 0.04, 0.45)) for i, f in enumerate(steps)])


def chimes():
    # Three bells: inharmonic partials with a long ring.
    bell = [(1, 1.0), (2.76, 0.45), (5.4, 0.2), (8.93, 0.08)]
    return mix(3.0, *[(i * 0.6, note(f, 1.8, bell, 0.005, 0.5)) for i, f in enumerate([987.77, 783.99, 1174.66])])


def classic():
    # The digital alarm clock: four quick beeps, then a pause.
    beep = [(1, 1.0), (3, 0.2)]
    return mix(1.0, *[(i * 0.12, note(2048.0, 0.07, beep, 0.003, 1.0)) for i in range(4)])


def write(name, samples):
    peak = max(abs(s) for s in samples) or 1.0
    gain = 10 ** (-1 / 20) / peak  # -1 dBFS
    # Fade the last 20 ms so the loop point doesn't click.
    fade = int(RATE * 0.02)
    for i in range(fade):
        samples[-1 - i] *= i / fade
    with wave.open(str(OUT / f"alarm_{name}.wav"), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(b"".join(struct.pack("<h", round(s * gain * 32767)) for s in samples))


OUT.mkdir(parents=True, exist_ok=True)
for name, make in [("dawn", dawn), ("chimes", chimes), ("classic", classic)]:
    write(name, make())
