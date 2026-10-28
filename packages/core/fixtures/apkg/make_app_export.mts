// Builds app.apkg, a deck the app made and studied, exported with Core's own writer:
//
//   node make_app_export.mts OUT_DIR
//   python through_anki.py OUT_DIR/app.apkg OUT_DIR/through-anki.apkg   # anki 26.09.3
//
// through-anki.apkg is that export imported into Anki with its learning progress and presets,
// then exported by Anki as Latest. The tests read both back.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { zipSync } from "fflate";
import { Collection, uuid7, writeApkg, type LogEntry } from "../../src/index.ts";

const OUT = resolve(process.argv[2] ?? ".");
const NOW = 1_790_000_000_000;
const DAY = 86_400_000;
let n = 0;
const random = () => new Uint8Array(16).fill(n++);
const collection = new Collection({ deviceId: "fixture", now: () => NOW - 40 * DAY, random });
const deck = collection.createDeck("Inglês");
const phrasal = collection.createDeck("Inglês::Phrasal verbs");
const sun = collection.addBasicNote(deck.id, '<img src="sol.png"> sun', "sol");
const up = collection.addBasicNote(phrasal.id, "give up", "desistir");
collection.addBasicNote(deck.id, "new", "novo");
const state = collection.snapshot();
const card = (noteId: string) => state.cards.find((c) => c.fields.noteId.value === noteId)!.id;
type Body = LogEntry extends infer E
  ? E extends LogEntry
    ? Omit<E, "id" | "cardId" | "at">
    : never
  : never;
const entry = (cardId: string, at: number, body: Body): LogEntry => ({
  id: uuid7(at, random()),
  cardId,
  at,
  ...body,
});
const review = (cardId: string, at: number, grade: 1 | 2 | 3 | 4) =>
  entry(cardId, at, { kind: "review", grade, durationMs: 5000, origin: "phone" });
const start = NOW - 30 * DAY;
const log = [
  review(card(sun.id), start, 3),
  review(card(sun.id), start + DAY, 3),
  review(card(sun.id), start + 6 * DAY, 4),
  review(card(up.id), start, 3),
  entry(card(up.id), start + DAY, { kind: "reset" }),
  review(card(up.id), start + 2 * DAY, 3),
  entry(card(up.id), start + 3 * DAY, { kind: "setDueDate", due: NOW + 3 * DAY }),
];
const PNG = Uint8Array.from(
  Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
      "1f15c4890000000d49444154789c6360f8cfc0f01f0005000201e2e0a4b10000000049454e44ae426082",
    "hex",
  ),
);
const entries = await writeApkg(
  {
    createSqlite: async () => {
      const path = join(mkdtempSync(join(tmpdir(), "app-export-")), "collection.anki21");
      const db = new DatabaseSync(path);
      return {
        run: async (sql: string, params: readonly SQLInputValue[] = []) => {
          db.prepare(sql).run(...params);
        },
        export: async () => {
          db.close();
          return new Uint8Array(readFileSync(path));
        },
      };
    },
    media: async (name) => (name === "sol.png" ? PNG : undefined),
  },
  { collection: state, log, deckId: deck.id, now: NOW },
);
writeFileSync(join(OUT, "app.apkg"), zipSync(entries));
