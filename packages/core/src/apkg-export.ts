/* oxlint-disable unicorn/no-array-sort -- ES2022/Hermes target; only fresh copies are sorted. */
/* oxlint-disable eslint/no-await-in-loop -- Statements run in order, one media file at a time. */
import { APP_ID_KEY } from "./apkg.ts";
import { mediaReferences, safeMediaName } from "./media.ts";
import type { Card, CollectionState, Deck, Field, NoteType, Preset } from "./collection.ts";
import { importId, sha1, type ImportKind } from "./ids.ts";
import {
  deckPreset,
  isBuried,
  newPosition,
  replayEntries,
  studyDayStart,
  CardState,
  type LogEntry,
  type MemoryState,
} from "./study.ts";

/**
 * What the app gives Core to write an `.apkg`: an empty SQLite database to run Core's statements
 * in, and the bytes of a media file by name (undefined when the file is missing).
 */
export interface ApkgWriteHost {
  createSqlite: () => Promise<WritableDatabase>;
  media: (name: string) => Promise<Uint8Array | undefined>;
}
export interface WritableDatabase {
  run: (sql: string, params?: readonly (string | number | null)[]) => Promise<void>;
  /** The database file's bytes, in rollback-journal mode; the database can be closed after. */
  export: () => Promise<Uint8Array>;
}
export interface ApkgExportInput {
  collection: CollectionState;
  log: readonly LogEntry[];
  /** The deck to export, with its subdecks. */
  deckId: string;
  now: number;
}

/**
 * Writes a deck and its subdecks as a Legacy 2 package (`collection.anki21`, schema 11), with
 * note types, notes, cards, presets, media, review history and each card's schedule and FSRS
 * memory (docs/research/apkg-formats.md, section 5). Returns the zip entries for the app to zip.
 * Anki keeps the schedule when "Import any learning progress" and "Import deck presets" are
 * ticked. Importing the file back into the app finds the same records and reviews.
 */
export async function writeApkg(
  host: ApkgWriteHost,
  input: ApkgExportInput,
): Promise<Record<string, Uint8Array>> {
  const rows = collectionRows(input);
  const db = await host.createSqlite();
  for (const statement of SCHEMA) await db.run(statement);
  await db.run("BEGIN");
  await db.run("INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')", [
    rows.crt,
    input.now,
    input.now,
    rows.conf,
    rows.models,
    rows.decks,
    rows.dconf,
  ]);
  for (const [table, values] of [
    ["notes", rows.notes],
    ["cards", rows.cards],
    ["revlog", rows.revlog],
  ] as const)
    for (let i = 0; i < values.length; i += 100) {
      const batch = values.slice(i, i + 100);
      const row = `(${batch[0]!.map(() => "?").join(", ")})`;
      await db.run(`INSERT INTO ${table} VALUES ${batch.map(() => row).join(", ")}`, batch.flat());
    }
  await db.run("COMMIT");
  const entries: Record<string, Uint8Array> = {
    meta: new Uint8Array([0x08, 0x02]),
    "collection.anki21": await db.export(),
  };
  const map: Record<string, string> = {};
  for (const name of rows.media) {
    // A note could name any path; only bare file names in the media folder go in.
    const bytes = safeMediaName(name) === name ? await host.media(name) : undefined;
    if (!bytes) continue;
    const entry = String(Object.keys(map).length);
    map[entry] = name;
    entries[entry] = bytes;
  }
  entries.media = new TextEncoder().encode(JSON.stringify(map));
  return entries;
}

/** The file name a deck exports as: `::` levels joined by dashes, no path characters. */
export const apkgFileName = (deckName: string) =>
  `${
    deckName
      .split("::")
      .join(" - ")
      // oxlint-disable-next-line no-control-regex -- control characters can't go in a file name.
      .replace(/[/\\:*?"<>|\u0000-\u001f]/g, "_")
      .trim() || "deck"
  }.apkg`;

/** Anki's schema-11 DDL, as `rslib/src/storage/schema11.sql` creates it. */
const SCHEMA = [
  "PRAGMA journal_mode = DELETE",
  "CREATE TABLE col (id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL, scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL, usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL, models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL)",
  "CREATE TABLE notes (id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld integer NOT NULL, csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL)",
  "CREATE TABLE cards (id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL, lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL)",
  "CREATE TABLE revlog (id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL, ease integer NOT NULL, ivl integer NOT NULL, lastIvl integer NOT NULL, factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL)",
  "CREATE TABLE graves (usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL)",
  "CREATE INDEX ix_notes_usn ON notes (usn)",
  "CREATE INDEX ix_cards_usn ON cards (usn)",
  "CREATE INDEX ix_revlog_usn ON revlog (usn)",
  "CREATE INDEX ix_cards_nid ON cards (nid)",
  "CREATE INDEX ix_cards_sched ON cards (did, queue, due)",
  "CREATE INDEX ix_revlog_cid ON revlog (cid)",
  "CREATE INDEX ix_notes_csum ON notes (csum)",
];
type Value = string | number;
/** Anki's day rollover, the hour the app's study day starts at too. */
const ROLLOVER = 4;
/** SM-2's starting ease, for users who import with FSRS off. */
const EASE = 2500;
/** The relearning step ts-fsrs uses: the preset has no relearning steps of its own. */
const RELEARNING_STEPS = [10];
const seconds = (ms: number) => Math.floor(ms / 1000);
const clockOf = (record: { fields: { [key: string]: Field<unknown> }; values?: Field<string>[] }) =>
  seconds(
    Math.max(
      0,
      ...Object.values(record.fields).map((f) => f.hlc.wallMs),
      ...(record.values ?? []).map((f) => f.hlc.wallMs),
    ),
  );
/** Whole local calendar days from one study day start to another (DST-proof). */
const daysBetween = (from: number, to: number) => {
  const a = new Date(from);
  const b = new Date(to);
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86_400_000,
  );
};
/** Anki's int64 ids as JSON numbers: the app keeps field and template ids as decimal strings. */
const ankiJson = (value: unknown) => JSON.stringify(value).replace(/"id":"(-?\d+)"/g, '"id":$1');
const stripHtml = (html: string) =>
  html
    .replace(/<img[^>]*?src=["']?([^"'\s>]+)[^>]*>/gi, " $1 ")
    .replace(/<[^>]*>/g, "")
    .replaceAll("&nbsp;", " ")
    .trim();

/**
 * Anki ids for the exported records, one space per table. Records from Anki keep theirs; the
 * app's own take their UUIDv7 time, as Anki's ids are creation times, moved on past ids taken.
 */
class Ids {
  private readonly taken = new Set<number>();
  claim(wanted: number) {
    let id = Math.max(2, Math.trunc(wanted));
    while (this.taken.has(id)) id++;
    this.taken.add(id);
    return id;
  }
}
const uuidTime = (uuid: string) => Number.parseInt(uuid.replaceAll("-", "").slice(0, 12), 16);

/** Plain rows and JSON for the schema-11 collection. */
function collectionRows({ collection, log, deckId, now }: ApkgExportInput) {
  const root = collection.decks.find((d) => d.id === deckId);
  if (!root) throw new Error("Deck missing");
  const prefix = `${root.fields.name.value}::`;
  const decks = collection.decks
    .filter((d) => d.id === deckId || d.fields.name.value.startsWith(prefix))
    .sort((a, b) => a.fields.name.value.localeCompare(b.fields.name.value));
  const deckIds = new Set(decks.map((d) => d.id));
  const cards = collection.cards
    .filter((c) => deckIds.has(c.fields.deckId.value))
    .sort((a, b) => a.id.localeCompare(b.id));
  const noteIds = new Set(cards.map((c) => c.fields.noteId.value));
  const notes = collection.notes
    .filter((n) => noteIds.has(n.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const typeIds = new Set(notes.map((n) => n.fields.noteTypeId.value));
  const types = collection.noteTypes.filter((t) => typeIds.has(t.id));
  const presetIds = new Set(decks.map((d) => d.fields.presetId.value));
  const presets = collection.presets.filter((p) => presetIds.has(p.id));

  /** The Anki id a record is written with, and the app id when that id wouldn't lead back. */
  const identify = <R extends { id: string; anki?: { id: number } }>(
    kind: ImportKind,
    records: R[],
    name: (record: R) => string | undefined,
    keep: (id: number) => boolean = () => true,
  ) => {
    const ids = new Ids();
    const result = new Map<string, { id: number; appId?: string }>();
    // Anki identities first, so the app's own records move around them.
    const own = (r: R) => r.anki !== undefined && keep(r.anki.id);
    for (const record of [...records.filter(own), ...records.filter((r) => !own(r))]) {
      const id = ids.claim(own(record) ? record.anki!.id : uuidTime(record.id));
      const back = importId(kind, id, name(record)) === record.id;
      result.set(record.id, back ? { id } : { id, appId: record.id });
    }
    return result;
  };
  const deckAnki = identify("deck", decks, (d) => d.fields.name.value);
  // Anki adds presets with INSERT OR IGNORE by id: id 1 would keep the target's Default.
  const presetAnki = identify(
    "preset",
    presets,
    (p) => p.fields.name.value,
    (id) => id !== 1,
  );
  const typeAnki = identify("noteType", types, () => undefined);
  const noteIdsAnki = new Ids();
  const noteAnki = new Map(
    [...notes.filter((n) => n.anki), ...notes.filter((n) => !n.anki)].map((n) => [
      n.id,
      noteIdsAnki.claim(n.anki?.id ?? uuidTime(n.id)),
    ]),
  );
  const cardIdsAnki = new Ids();
  for (const card of cards) if (card.anki) cardIdsAnki.claim(card.anki.id);
  const cardAnki = new Map(
    cards.map((c) => [
      c.id,
      c.anki?.id ??
        cardIdsAnki.claim(noteAnki.get(c.fields.noteId.value)! + c.fields.ordinal.value),
    ]),
  );

  const presetOf = new Map(
    decks.map((d) => {
      const preset = deckPreset(collection, d);
      if (!preset) throw new Error("Deck preset missing");
      return [d.id, preset];
    }),
  );
  const voided = new Set(log.filter((e) => e.kind === "void").map((e) => e.targetId));
  const own = new Map<string, LogEntry[]>();
  for (const entry of log) {
    if (!cardAnki.has(entry.cardId)) continue;
    const list = own.get(entry.cardId);
    if (list) list.push(entry);
    else own.set(entry.cardId, [entry]);
  }
  const replays = new Map(
    cards.map((card) => {
      const steps: { entry: LogEntry; before: MemoryState }[] = [];
      const preset = presetOf.get(card.fields.deckId.value)!;
      const memory = replayEntries(own.get(card.id) ?? [], preset, now, (entry, before) => {
        if (entry.kind !== "void") steps.push({ entry, before });
      });
      return [card.id, { steps, memory, preset }];
    }),
  );
  const crt = seconds(
    studyDayStart(
      Math.min(
        now,
        ...log.filter((e) => cardAnki.has(e.cardId)).map((e) => e.at),
        ...[...replays.values()].map((r) => r.memory.due.getTime()),
      ),
      ROLLOVER,
    ),
  );
  const dayNumber = (ms: number) => daysBetween(crt * 1000, studyDayStart(ms, ROLLOVER));
  const tomorrow = new Date(studyDayStart(now, ROLLOVER));
  tomorrow.setDate(tomorrow.getDate() + 1);

  const noteRows = notes.map((note) => {
    const values = note.values.map((v) => v.value);
    const sort = stripHtml(values[0] ?? "");
    const tags = note.fields.tags.value;
    return [
      noteAnki.get(note.id)!,
      note.anki?.guid ?? note.id,
      typeAnki.get(note.fields.noteTypeId.value)!.id,
      clockOf(note),
      -1,
      tags.length ? ` ${tags.join(" ")} ` : "",
      values.join("\u001f"),
      sort,
      new DataView(sha1(new TextEncoder().encode(sort)).buffer).getUint32(0),
      0,
      "",
    ];
  });

  const newOrder = cards
    .filter((c) => replays.get(c.id)!.memory.state === CardState.New)
    .map((c) => ({ id: c.id, at: newPosition(c, own.get(c.id) ?? [], voided) }))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const position = new Map(newOrder.map((c, i) => [c.id, i + 1]));
  const cardRows = cards.map((card) =>
    cardRow(card, replays.get(card.id)!, {
      id: cardAnki.get(card.id)!,
      noteId: noteAnki.get(card.fields.noteId.value)!,
      deckId: deckAnki.get(card.fields.deckId.value)!.id,
      position: position.get(card.id) ?? 0,
      dayNumber,
      tomorrow: tomorrow.getTime(),
      now,
    }),
  );

  const revlogIds = new Ids();
  const revlog: Value[][] = [];
  const entries = cards
    .flatMap((card) => {
      let lastIvl = 0;
      const { steps, memory } = replays.get(card.id)!;
      return steps.flatMap(({ entry, before }, i) => {
        const after = steps[i + 1]?.before ?? memory;
        const row = revlogRow(entry, before, after);
        if (!row) return [];
        const result = { at: entry.at, entry, card, row: { ...row, lastIvl } };
        lastIvl = row.ivl;
        return [result];
      });
    })
    .sort((a, b) => a.at - b.at || a.entry.id.localeCompare(b.entry.id));
  for (const { at, card, row } of entries)
    revlog.push([
      revlogIds.claim(at),
      cardAnki.get(card.id)!,
      -1,
      row.ease,
      row.ivl,
      row.lastIvl,
      row.factor,
      row.time,
      row.type,
    ]);

  const models = Object.fromEntries(
    types.map((type) => {
      const json = modelJson(type, typeAnki.get(type.id)!);
      return [String(json.id), json];
    }),
  );
  const deckJson = Object.fromEntries(
    decks.map((deck) => {
      const anki = deckAnki.get(deck.id)!;
      const presetId = presetAnki.get(deck.fields.presetId.value)!.id;
      return [String(anki.id), deckEntry(deck, anki, presetId)];
    }),
  );
  const dconf = Object.fromEntries(
    presets.map((preset) => {
      const anki = presetAnki.get(preset.id)!;
      return [String(anki.id), presetJson(preset, anki)];
    }),
  );
  const media = new Set<string>();
  for (const note of notes)
    for (const m of mediaReferences(note.values.map((v) => v.value))) media.add(m);
  for (const type of types)
    for (const m of mediaReferences(type.fields.templates.value.flatMap((t) => [t.front, t.back])))
      media.add(m);
  const first = deckAnki.get(root.id)!.id;
  const conf = {
    ...CONF,
    curDeck: first,
    activeDecks: [first],
    curModel: typeAnki.get(types[0]?.id ?? "")?.id ?? null,
    nextPos: newOrder.length + 1,
    creationOffset: new Date(crt * 1000).getTimezoneOffset(),
    rollover: ROLLOVER,
  };
  return {
    crt,
    conf: JSON.stringify(conf),
    models: ankiJson(models),
    decks: JSON.stringify(deckJson),
    dconf: JSON.stringify(dconf),
    notes: noteRows,
    cards: cardRows,
    revlog,
    media: [...media].sort(),
  };
}

/** Difficulty as Anki's FSRS revlog stores it in `factor`: 1–10 mapped to 100–1100. */
const difficultyFactor = (memory: MemoryState) =>
  Math.round(((memory.difficulty - 1) / 9) * 1000) + 100;
/** A revlog interval: days for a review card, negative seconds for a learning step. */
const interval = (memory: MemoryState, at: number) =>
  memory.state === CardState.Review
    ? Math.max(1, memory.scheduled_days)
    : -Math.max(0, Math.round((memory.due.getTime() - at) / 1000));

/** The revlog row of a log entry replay counted (voided ones never reach it). */
function revlogRow(entry: LogEntry, before: MemoryState, after: MemoryState) {
  switch (entry.kind) {
    case "review":
      return {
        ease: entry.grade,
        ivl: interval(after, entry.at),
        factor: difficultyFactor(after),
        time: Math.max(0, Math.min(Math.round(entry.durationMs), 2_147_483_647)),
        // Learn 0, review 1, relearn 2, from the state the answer found.
        type: before.state === CardState.Review ? 1 : before.state === CardState.Relearning ? 2 : 0,
      };
    // Anki's Forget: a manual entry with no ease factor.
    case "reset":
      return { ease: 0, ivl: 0, factor: 0, time: 0, type: 4 };
    // Anki's set due date: a manual entry with a factor and the interval in days or seconds.
    case "setDueDate": {
      const days = daysBetween(studyDayStart(entry.at), entry.due);
      const start = new Date(studyDayStart(entry.at));
      start.setDate(start.getDate() + days);
      const ivl =
        start.getTime() === entry.due && days >= 0
          ? days
          : -Math.max(1, Math.round((entry.due - entry.at) / 1000));
      return { ease: 0, ivl, factor: EASE, time: 0, type: 4 };
    }
    // A snapshot of AnkiDroid's state has no revlog row: the card's columns carry it.
    default:
      return undefined;
  }
}

function cardRow(
  card: Card,
  { memory, preset }: { memory: MemoryState; preset: Preset },
  at: {
    id: number;
    noteId: number;
    deckId: number;
    position: number;
    dayNumber: (ms: number) => number;
    tomorrow: number;
    now: number;
  },
): Value[] {
  const due = memory.due.getTime();
  const suspended = card.fields.suspended.value;
  const buried = isBuried(card, at.now);
  const learning = memory.state === CardState.Learning || memory.state === CardState.Relearning;
  // Learning steps due today are timestamps in queue 1; later ones day numbers in queue 3.
  const [type, queue, dueValue, ivl, factor] =
    memory.state === CardState.New
      ? [0, 0, at.position, 0, 0]
      : memory.state === CardState.Review
        ? [2, 2, at.dayNumber(due), Math.max(1, memory.scheduled_days), EASE]
        : [
            memory.state === CardState.Learning ? 1 : 3,
            due < at.tomorrow ? 1 : 3,
            due < at.tomorrow ? seconds(due) : at.dayNumber(due),
            memory.state === CardState.Relearning ? Math.max(1, memory.scheduled_days) : 0,
            EASE,
          ];
  const steps =
    memory.state === CardState.Relearning ? RELEARNING_STEPS : preset.fields.learningSteps.value;
  const left = learning ? Math.max(1, steps.length - memory.learning_steps) : 0;
  const weights = preset.fields.fsrsParameters.value;
  const data =
    memory.state === CardState.New
      ? {}
      : {
          s: Number(memory.stability.toFixed(4)),
          d: Number(memory.difficulty.toFixed(3)),
          dr: preset.fields.desiredRetention.value,
          decay: weights[20],
          ...(memory.last_review ? { lrt: seconds(memory.last_review.getTime()) } : {}),
        };
  return [
    at.id,
    at.noteId,
    at.deckId,
    card.fields.ordinal.value,
    clockOf(card),
    -1,
    type,
    // -3 is Anki's user-buried queue, which it empties at its next study day.
    suspended ? -1 : buried ? -3 : queue,
    dueValue,
    ivl,
    factor,
    memory.reps,
    memory.lapses,
    left,
    0,
    0,
    card.fields.flag.value,
    JSON.stringify(data),
  ];
}

const appIdOf = (anki: { appId?: string }) => (anki.appId ? { [APP_ID_KEY]: anki.appId } : {});

/** A kept Anki field or template id, while the note type still has as many as Anki gave it. */
const ankiId = (ids: string[] | undefined, i: number, count: number) =>
  ids?.length === count && /^-?\d+$/.test(ids[i] ?? "") ? ids[i]! : null;
function modelJson(type: NoteType, anki: { id: number; appId?: string }) {
  const f = type.fields;
  const fieldIds = type.anki?.fieldIds;
  const templateIds = type.anki?.templateIds;
  const cloze = f.kind.value === "cloze";
  return {
    id: anki.id,
    ...appIdOf(anki),
    name: f.name.value,
    type: cloze ? 1 : 0,
    mod: clockOf(type),
    usn: -1,
    sortf: 0,
    did: null,
    tmpls: f.templates.value.map((t, ord) => ({
      name: t.name,
      ord,
      qfmt: t.front,
      afmt: t.back,
      bqfmt: "",
      bafmt: "",
      did: null,
      bfont: "",
      bsize: 0,
      id: ankiId(templateIds, ord, f.templates.value.length),
    })),
    flds: f.fieldNames.value.map((name, ord) => ({
      name,
      ord,
      sticky: false,
      rtl: false,
      font: "Arial",
      size: 20,
      description: "",
      plainText: false,
      collapsed: false,
      excludeFromSearch: false,
      id: ankiId(fieldIds, ord, f.fieldNames.value.length),
      tag: null,
      preventDeletion: false,
    })),
    css: f.css.value,
    latexPre: LATEX_PRE,
    latexPost: "\\end{document}",
    latexsvg: false,
    req: cloze ? [[0, "any", [0]]] : f.templates.value.map((_, i) => [i, "any", [0]]),
  };
}

function deckEntry(deck: Deck, anki: { id: number; appId?: string }, presetId: number) {
  const override = deck.fields.desiredRetention.value;
  return {
    id: anki.id,
    ...appIdOf(anki),
    mod: clockOf(deck),
    name: deck.fields.name.value,
    usn: -1,
    lrnToday: [0, 0],
    revToday: [0, 0],
    newToday: [0, 0],
    timeToday: [0, 0],
    collapsed: false,
    browserCollapsed: false,
    desc: "",
    dyn: 0,
    conf: presetId,
    extendNew: 0,
    extendRev: 0,
    reviewLimit: null,
    newLimit: null,
    reviewLimitToday: null,
    newLimitToday: null,
    // Schema 11 keeps the deck's override as a whole percent.
    desiredRetention: override == null ? null : Math.round(override * 100),
  };
}

function presetJson(preset: Preset, anki: { id: number; appId?: string }) {
  const f = preset.fields;
  return {
    ...DCONF,
    id: anki.id,
    ...appIdOf(anki),
    mod: clockOf(preset),
    name: f.name.value,
    usn: -1,
    new: {
      ...DCONF.new,
      bury: f.buryNew.value,
      delays: f.learningSteps.value,
      perDay: f.newPerDay.value,
    },
    rev: { ...DCONF.rev, bury: f.buryReviews.value, perDay: f.reviewsPerDay.value },
    lapse: { ...DCONF.lapse, delays: RELEARNING_STEPS },
    buryInterdayLearning: f.buryLearning.value,
    fsrsParams6: f.fsrsParameters.value,
    desiredRetention: f.desiredRetention.value,
  };
}

/** A fresh schema-11 `col.conf`, as Anki 26.09 writes it. */
const CONF = {
  dueCounts: true,
  estTimes: true,
  sched2021: true,
  timeLim: 0,
  schedVer: 2,
  sortBackwards: false,
  newSpread: 0,
  sortType: "noteFld",
  collapseTime: 1200,
  addToCur: true,
  dayLearnFirst: false,
};
const LATEX_PRE =
  "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n";
/** Anki 26.09's default preset in schema-11 JSON: every key its importer requires. */
const DCONF = {
  maxTaken: 60,
  autoplay: true,
  timer: 0,
  replayq: true,
  new: { bury: false, delays: [1, 10], initialFactor: EASE, ints: [1, 4, 0], order: 1, perDay: 20 },
  rev: { bury: false, ease4: 1.3, ivlFct: 1, maxIvl: 36_500, perDay: 200, hardFactor: 1.2 },
  lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 },
  dyn: false,
  newMix: 0,
  newPerDayMinimum: 0,
  interdayLearningMix: 0,
  reviewOrder: 0,
  newSortOrder: 0,
  newGatherPriority: 0,
  buryInterdayLearning: false,
  fsrsWeights: [],
  fsrsParams5: [],
  fsrsParams6: [] as number[],
  desiredRetention: 0.9,
  ignoreRevlogsBeforeDate: "",
  easyDaysPercentages: [1, 1, 1, 1, 1, 1, 1],
  stopTimerOnAnswer: false,
  secondsToShowQuestion: 0,
  secondsToShowAnswer: 0,
  questionAction: 0,
  answerAction: 0,
  waitForAudio: true,
  sm2Retention: 0.9,
  weightSearch: "",
};
