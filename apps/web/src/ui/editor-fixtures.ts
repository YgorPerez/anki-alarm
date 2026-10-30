import { browseCards, Collection, type CollectionState } from "@app/core";

/** A small collection for the editor stories: two decks, Basic and a vocabulary type. */
export function editorFixture() {
  let n = 0;
  const collection = new Collection({
    deviceId: "story",
    now: () => 1_800_000_000_000 + n,
    random: () => new Uint8Array(16).fill(n++),
  });
  const english = collection.createDeck("Inglês");
  const verbs = collection.createDeck("Inglês::Verbos");
  collection.addBasicNote(english.id, "cat", "gato");
  collection.addBasicNote(verbs.id, "to run", "correr");
  const basicId = collection.snapshot().noteTypes[0]!.id;
  collection.editNoteType(basicId, {
    name: "Basic",
    fields: [
      { name: "Front", from: 0 },
      { name: "Back", from: 1 },
    ],
    templates: [
      { name: "Card 1", front: "{{Front}}", back: "{{FrontSide}}<hr>{{Back}}", from: 0 },
      { name: "Reverse", front: "{{Back}}", back: "{{FrontSide}}<hr>{{Front}}" },
    ],
    css: ".card { text-align: center }",
  });
  const state: CollectionState = collection.snapshot();
  return {
    state,
    englishId: english.id,
    verbsId: verbs.id,
    rows: browseCards(state, "", Date.now()),
  };
}
