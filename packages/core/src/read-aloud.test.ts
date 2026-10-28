import { describe, expect, it } from "vite-plus/test";
import {
  alarmFromRecord,
  alarmSession,
  Collection,
  newAlarm,
  readAlarm,
  readAloudFor,
  stampAlarm,
} from "./index.ts";

const now = new Date(2026, 9, 28, 7).getTime();
let seed = 0;
const collection = () =>
  new Collection({ deviceId: "a", now: () => now, random: () => new Uint8Array(16).fill(seed++) });

/** The session's first card for a deck holding one Basic note. */
function firstCard(front: string, deckName = "Palavras", setup?: (c: Collection) => void) {
  const c = collection();
  const deck = c.createDeck(deckName);
  c.addBasicNote(deck.id, front, "verso");
  setup?.(c);
  const next = alarmSession({
    collection: c.snapshot(),
    log: [],
    deckId: deck.id,
    need: 1,
    ringId: "ring",
    now,
  }).next!;
  return {
    note: next.note,
    type: next.noteType,
    ordinal: next.card.fields.ordinal.value,
    deckName: next.deckName,
    language: next.language,
  };
}

describe("read aloud", () => {
  it("plays the front's own audio, in order, before any speech", () => {
    expect(readAloudFor(firstCard("gato [sound:gato.mp3] [sound:miau.ogg]"))).toEqual({
      clips: ["gato.mp3", "miau.ogg"],
      text: "gato",
      language: "pt-BR",
    });
  });

  it("speaks the front as plain text when it has no audio", () => {
    expect(
      readAloudFor(firstCard("<b>o&nbsp;gato</b><br>preto &amp; branco<div>dorme</div>")),
    ).toEqual({ clips: [], text: "o gato preto & branco dorme", language: "pt-BR" });
  });

  it("reads nothing for a front with no text and no audio", () => {
    expect(readAloudFor(firstCard('<img src="gato.png">'))).toBeNull();
  });
});

const deckId = (c: Collection, name: string) =>
  c.snapshot().decks.find((d) => d.fields.name.value === name)!.id;

describe("a deck's language", () => {
  it("is pt-BR until the deck gets one", () => {
    expect(firstCard("gato").language).toBe("pt-BR");
  });

  it("is the one set on the deck", () => {
    const card = firstCard("cat", "Words", (c) => c.setDeckLanguage(deckId(c, "Words"), "en-US"));
    expect(readAloudFor(card)?.language).toBe("en-US");
  });

  it("comes from the nearest parent deck when a subdeck has none", () => {
    const card = firstCard("chat", "Langues::Français::Verbes", (c) => {
      c.createDeck("Langues");
      c.createDeck("Langues::Français");
      c.setDeckLanguage(deckId(c, "Langues"), "en-US");
      c.setDeckLanguage(deckId(c, "Langues::Français"), "fr-FR");
    });
    expect(card.language).toBe("fr-FR");
  });

  it("accepts only a language tag", () => {
    const c = collection();
    const deck = c.createDeck("Words");
    expect(() => c.setDeckLanguage(deck.id, "english")).toThrow("Invalid deck language");
    expect(() => c.setDeckLanguage("missing", "en-US")).toThrow("Invalid deck language");
  });

  it("is a clocked deck property, so it syncs like the others", () => {
    const c = collection();
    const deck = c.createDeck("Words");
    c.setDeckLanguage(deck.id, "en-US");
    const stored = c.snapshot().decks[0]!.fields.language;
    expect(stored?.value).toBe("en-US");
    expect(stored?.hlc.deviceId).toBe("a");
  });
});

describe("the alarm's read aloud option", () => {
  it("is off for a new alarm and for alarms saved before it existed", () => {
    expect(newAlarm("a").readAloud).toBe(false);
    const { readAloud: _readAloud, ...legacy } = newAlarm("a");
    expect(readAlarm(legacy).readAloud).toBe(false);
    expect(readAlarm({ ...legacy, readAloud: "yes" }).readAloud).toBe(false);
  });

  it("keeps its value through storage and sync", () => {
    const alarm = { ...newAlarm("a"), readAloud: true };
    expect(readAlarm(alarm).readAloud).toBe(true);
    const env = { deviceId: "a", now: () => now, random: () => new Uint8Array(16) };
    expect(alarmFromRecord(stampAlarm(undefined, alarm, env)).readAloud).toBe(true);
  });
});
