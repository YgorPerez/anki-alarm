import type { AnkiPackage } from "@app/core";
import fixture from "../../core/fixtures/ankidroid-deck.json" with { type: "json" };

/** The same deck exported from AnkiDroid, before it is linked on this phone. */
export const unlinkedAnkiDroidDeck = (source = fixture.source): AnkiPackage => ({
  version: 2,
  noteTypes: source.noteTypes.map((t) => ({
    id: t.id,
    name: t.name,
    mtime: 0,
    kind: "standard",
    css: t.css,
    fields: t.fieldNames.split("\u001f").map((name, i) => ({ name, id: String(i) })),
    templates: t.templates.map((template) => ({ ...template, id: String(template.ord) })),
  })),
  decks: source.decks.map((d) => ({
    id: d.id,
    name: d.name,
    mtime: 0,
    presetId: 1,
    desiredRetention: null,
  })),
  presets: [
    {
      id: 1,
      name: "Default",
      mtime: 0,
      newPerDay: 20,
      reviewsPerDay: 200,
      desiredRetention: 0.9,
      learningSteps: [1, 10],
    },
  ],
  notes: source.notes.map((n) => ({
    id: n.id,
    guid: n.guid,
    noteTypeId: n.noteTypeId,
    mtime: 0,
    tags: [],
    fields: n.fields.split("\u001f"),
  })),
  cards: source.cards.map((c) => ({
    id: c.id,
    noteId: c.noteId,
    deckId: c.deckId,
    ordinal: c.ord,
    mtime: 0,
    suspended: false,
    buried: false,
  })),
  revlog: [
    {
      id: 1760000000000,
      cardId: 9002,
      at: 1760000000000,
      kind: "review",
      grade: 3,
      durationMs: 2000,
    },
  ],
});
