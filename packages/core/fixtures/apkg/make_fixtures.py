"""Builds the .apkg fixtures with Anki itself.

    python make_fixtures.py OUT_DIR   # anki 26.09.3: latest.apkg and legacy2.apkg
    python make_fixtures.py OUT_DIR   # anki 2.1.49 (with protobuf 3.20): legacy1.apkg

Every package holds the same notes, cards, decks, preset, media and review log, so one set of
expectations covers the three formats. Review log rows are inserted with fixed ids.
"""

import os
import sys
import tempfile

import anki.buildinfo
from anki.collection import Collection

OUT = os.path.abspath(sys.argv[1])
MODERN = not anki.buildinfo.version.startswith("2.1.")
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360f8cfc0f01f0005000201e2e0a4b10000000049454e44ae426082"
)
MP3 = b"ID3\x03\x00\x00\x00\x00\x00\x00fixture audio"


def build(path):
    col = Collection(path)
    if not MODERN:
        col.conf["schedVer"] = 1
        col.setMod()
    col.media.write_data("gato.png", PNG)
    col.media.write_data("miau.mp3", MP3)

    did = col.decks.id("Português::Verbos")
    conf = col.decks.add_config_returning_id("Fixture preset")
    preset = col.decks.get_config(conf)
    preset["new"]["perDay"] = 7
    preset["rev"]["perDay"] = 70
    preset["new"]["delays"] = [2.0, 15.0]
    if MODERN:
        preset["desiredRetention"] = 0.85
    col.decks.update_config(preset)
    deck = col.decks.get(did)
    deck["conf"] = conf
    if MODERN:
        deck["desiredRetention"] = 80
    col.decks.save(deck)

    def add(model, fields, tags=()):
        note = col.new_note(col.models.by_name(model))
        for name, value in fields.items():
            note[name] = value
        note.tags = list(tags)
        col.add_note(note, did)
        return note

    basic = add(
        "Basic",
        {"Front": '<img src="gato.png"> gato', "Back": "cat [sound:miau.mp3]"},
        ["animal"],
    )
    reversed_ = add("Basic (and reversed card)", {"Front": "casa", "Back": "house"})
    add("Cloze", {"Text": "{{c1::Brasília}} é a capital do {{c2::Brasil::país}}"})

    suspended = [c for c in reversed_.cards() if c.ord == 1][0]
    col.sched.suspend_cards([suspended.id])

    card = basic.cards()[0].id
    # v1 learning "Good" is ease 2; Anki remaps it to 3 when it upgrades to v2.
    good_learning = 3 if MODERN else 2
    rows = [
        (1700000000000, good_learning, 0, 0, 0, 1200),
        (1700000600000, 3, 1, 0, 2500, 3400),
        (1700000700000, 3, 3, 0, 0, 800),  # cram: filtered deck without rescheduling
        (1700086400000, 1, 1, -600, 2300, 5000),
        (1700090000000, 0, 4, 0, 0, 0),  # Forget
        (1700100000000, 0, 4, 5, 2500, 0),  # Set due date
        (1700200000000, 0, 5, 10, 2500, 0),  # Rescheduled
    ]
    for rid, ease, kind, ivl, factor, taken in rows:
        col.db.execute(
            "insert into revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type)"
            " values (?, ?, -1, ?, ?, 0, ?, ?, ?)",
            rid,
            card,
            ease,
            ivl,
            factor,
            taken,
            kind,
        )
    return col


def main():
    os.makedirs(OUT, exist_ok=True)
    work = tempfile.mkdtemp()
    col = build(os.path.join(work, "collection.anki2"))
    if MODERN:
        from anki.import_export_pb2 import ExportAnkiPackageOptions

        for name, legacy in (("latest.apkg", False), ("legacy2.apkg", True)):
            col.export_anki_package(
                out_path=os.path.join(OUT, name),
                options=ExportAnkiPackageOptions(
                    with_scheduling=True, with_deck_configs=True, with_media=True, legacy=legacy
                ),
                limit=None,
            )
    else:
        from anki.exporting import AnkiPackageExporter

        exporter = AnkiPackageExporter(col)
        exporter.includeSched = True
        exporter.includeMedia = True
        path = os.path.join(OUT, "legacy1.apkg")
        exporter.exportInto(path)
        mark_v1(path)
    col.close()


def mark_v1(path):
    """2.1.49 writes a fresh `col.conf` with schedVer 2 into the package. Anki 2.0 packages, the
    ones that carry v1 review logs, had schedVer 1 there."""
    import json
    import sqlite3
    import zipfile

    work = tempfile.mkdtemp()
    with zipfile.ZipFile(path) as z:
        entries = {name: z.read(name) for name in z.namelist()}
    db_path = os.path.join(work, "collection.anki2")
    with open(db_path, "wb") as f:
        f.write(entries["collection.anki2"])
    db = sqlite3.connect(db_path)
    conf = json.loads(db.execute("select conf from col").fetchone()[0])
    conf["schedVer"] = 1
    db.execute("update col set conf = ?", (json.dumps(conf),))
    db.commit()
    db.close()
    with open(db_path, "rb") as f:
        entries["collection.anki2"] = f.read()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in entries.items():
            z.writestr(name, data)


main()
