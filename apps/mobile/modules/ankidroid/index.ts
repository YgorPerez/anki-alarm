import { requireNativeModule } from "expo";

/** AnkiDroid's ContentProvider. JSON strings follow Core's `AnkiDroidDeck` and `AnkiDroidSource`. */
interface NativeAnkiDroid {
  suspend: (noteId: number, ord: number) => Promise<string>;
  status: () => { versionCode: number; permission: "granted" | "denied" } | null;
  requestPermission: () => "granted" | "prompted" | "settings";
  decks: () => Promise<string>;
  readDeck: (deckId: number) => Promise<string>;
  /** `AnkiDroidCard[]` of these notes. */
  cards: (noteIds: number[]) => Promise<string>;
  /** Answers a card; resolves with it as read back (`AnkiDroidCard`), or "null" when it's gone. */
  answer: (noteId: number, ord: number, ease: number, timeTakenMs: number) => Promise<string>;
  /** Buries a card; resolves with it as read back (`AnkiDroidCard`), or "null" when it's gone. */
  bury: (noteId: number, ord: number) => Promise<string>;
  /** Starts AnkiDroid's `DO_SYNC` Activity; resolves with "null". It reports no sync result. */
  requestSync: () => Promise<string>;
}
export default requireNativeModule<NativeAnkiDroid>("AnkiDroid");
