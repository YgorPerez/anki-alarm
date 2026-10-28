import { Directory, File, Paths } from "expo-file-system";

/**
 * Card media on the phone, one file per name, as notes reference them. Cards render with this
 * folder as their base URL. Media sync (#53) adds content hashes and R2.
 */
const directory = () => new Directory(Paths.document, "media");
export const mediaBaseUrl = () => directory().uri;

export async function storeMedia(files: readonly { name: string; bytes: Uint8Array }[]) {
  const folder = directory();
  folder.create({ idempotent: true, intermediates: true });
  // One file at a time bounds memory.
  await files.reduce(
    (previous, { name, bytes }) =>
      previous.then(() => {
        const file = new File(folder, name);
        file.create({ overwrite: true });
        return file.write(bytes);
      }),
    Promise.resolve(),
  );
}

/** The picked file's bytes, or null when the picker is cancelled. */
export async function pickFile(): Promise<Uint8Array | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ["*/*"] });
  if (picked.canceled) return null;
  return picked.result.bytes();
}
