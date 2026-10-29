import { requireNativeModule } from "expo";

/** AnkiDroid's ContentProvider. JSON strings follow Core's `AnkiDroidDeck` and `AnkiDroidSource`. */
interface NativeAnkiDroid {
  status: () => { versionCode: number; permission: "granted" | "denied" } | null;
  requestPermission: () => "granted" | "prompted" | "settings";
  decks: () => Promise<string>;
  readDeck: (deckId: number) => Promise<string>;
  /** `AnkiDroidCard[]` of these notes. */
  cards: (noteIds: number[]) => Promise<string>;
  /** Answers a card; resolves with it as read back (`AnkiDroidCard`), or "null" when it's gone. */
  answer: (noteId: number, ord: number, ease: number, timeTakenMs: number) => Promise<string>;
}
export default requireNativeModule<NativeAnkiDroid>("AnkiDroid");
