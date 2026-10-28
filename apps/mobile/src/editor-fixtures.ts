import { Collection, replayCard, type LogEntry } from "@app/core";

/** A small collection for the editor stories: two decks, Basic and an imported note type. */
export function editorFixture() {
  let n = 0;
  const now = Date.now();
  const c = new Collection({
    deviceId: "storybook",
    now: () => now,
    random: () => new Uint8Array(16).fill(n++),
  });
  const words = c.createDeck("Palavras");
  c.createDeck("Verbos");
  const basic = c.addBasicNote(words.id, "casa", "house");
  const seeded = c.snapshot();
  const vocabulary = structuredClone(seeded.noteTypes[0]!);
  vocabulary.id = "018bcfe5-6800-7fff-bfff-0000000000bb";
  vocabulary.fields.name.value = "Vocabulário";
  vocabulary.fields.fieldNames.value = ["Palavra", "Pronúncia", "Significado", "Exemplo"];
  const withType = new Collection(
    { deviceId: "storybook", now: () => now, random: () => new Uint8Array(16).fill(n++) },
    { ...seeded, noteTypes: [...seeded.noteTypes, vocabulary] },
  );
  const note = withType.addNote(words.id, vocabulary.id, [
    "saudade",
    "sau-DA-dʒi",
    "longing",
    "Que saudade de casa.",
  ]);
  const state = withType.snapshot();
  const card = state.cards.find((x) => x.fields.noteId.value === basic.id)!;
  const log: LogEntry[] = [
    {
      kind: "review",
      id: "story-review",
      cardId: card.id,
      at: now - 86_400_000,
      grade: 3,
      durationMs: 4000,
      origin: "phone",
    },
  ];
  const memory = (cardId: string) => replayCard(cardId, log, state.presets[0]!, now);
  return { state, words, basic, note, card, memory };
}
