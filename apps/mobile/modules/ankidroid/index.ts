import { requireNativeModule } from "expo";

/** AnkiDroid's ContentProvider. JSON strings follow Core's `AnkiDroidDeck` and `AnkiDroidSource`. */
interface NativeAnkiDroid {
  status: () => { versionCode: number; permission: "granted" | "denied" } | null;
  requestPermission: () => "granted" | "prompted" | "settings";
  decks: () => Promise<string>;
  readDeck: (deckId: number) => Promise<string>;
}
export default requireNativeModule<NativeAnkiDroid>("AnkiDroid");
