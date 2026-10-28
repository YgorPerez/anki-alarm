/** The parts of expo-file-system the screens reach. Tests store media through `memoryAnkiDroid`. */
class Directory {
  readonly uri: string;
  constructor(...parts: (string | Directory)[]) {
    this.uri = `${parts.map((p) => (typeof p === "string" ? p : p.uri.replace(/\/$/, ""))).join("/")}/`;
  }
}
export const Paths = { document: new Directory("file:///data/user/0/app/files") };
/** Files aren't opened in screen tests. */
export const File = {};
export { Directory };
