"""Imports an .apkg the app exported into a fresh Anki collection and exports it back as Latest.

    python through_anki.py IN.apkg OUT.apkg   # anki 26.09.3

Both import options are ticked ("Import any learning progress", "Import deck presets") and FSRS
is on. Prints what Anki made of each card, as a manual check of the export: queue, due in days
from today, FSRS memory state and review log rows.
"""

import os
import sys
import tempfile

from anki.collection import (
    Collection,
    DeckIdLimit,
    ImportAnkiPackageOptions,
    ImportAnkiPackageRequest,
)
from anki.import_export_pb2 import ExportAnkiPackageOptions

IN, OUT = (os.path.abspath(p) for p in sys.argv[1:3])
col = Collection(os.path.join(tempfile.mkdtemp(), "collection.anki2"))
col.set_config("fsrs", True)
log = col.import_anki_package(
    ImportAnkiPackageRequest(
        package_path=IN,
        options=ImportAnkiPackageOptions(with_scheduling=True, with_deck_configs=True),
    )
).log
print("notes", len(log.new), "media", sorted(os.listdir(col.media.dir())))
today = col.sched.today
for cid in col.find_cards(""):
    card = col.get_card(cid)
    memory = card.memory_state
    print(
        col.decks.name(card.did),
        repr(card.note().fields[0]),
        "type",
        card.type,
        "queue",
        card.queue,
        "due",
        card.due - today if card.queue in (2, 3) else card.due,
        "ivl",
        card.ivl,
        "memory",
        memory and (round(memory.stability, 4), round(memory.difficulty, 3)),
        "revlog",
        col.db.list("select ease from revlog where cid = ? order by id", cid),
    )
for name in col.decks.all_names_and_ids():
    conf = col.decks.config_dict_for_deck_id(name.id)
    print(name.name, conf["name"], conf["desiredRetention"], len(conf["fsrsParams6"]))

root = min(col.decks.all_names_and_ids(skip_empty_default=True), key=lambda d: len(d.name))
col.export_anki_package(
    out_path=OUT,
    options=ExportAnkiPackageOptions(
        with_scheduling=True, with_deck_configs=True, with_media=True, legacy=False
    ),
    limit=DeckIdLimit(root.id),
)
col.close()
