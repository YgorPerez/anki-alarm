// Card media on the phone: `Paths.document/media/<name>`, as fields reference them. Cards load them
// from here (StudyScreen's base URL), ClientData records each file's SHA-256 and sync copies every
// file the decks use, so an alarm never waits on the network (ADR 0001 › Media).
import { MediaStorageRefused, type MediaFiles } from "@app/client-data";
import { CryptoDigestAlgorithm, digest } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

const mediaDirectory = () => new Directory(Paths.document, "media");

export function mediaUrl(name: string) {
  const base = mediaDirectory().uri;
  return `${base.endsWith("/") ? base : `${base}/`}${encodeURIComponent(name)}`;
}
export const mediaBaseUrl = () => mediaUrl("");

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The phone's media files for `clientDataLayer`. Names are checked by ClientData first. */
export const phoneMediaFiles: MediaFiles = {
  read: async (name) => {
    const file = new File(mediaDirectory(), name);
    return file.exists ? file.bytes() : null;
  },
  write: async (name, bytes) => {
    try {
      const directory = mediaDirectory();
      directory.create({ intermediates: true, idempotent: true });
      await new File(directory, name).write(bytes);
    } catch (error) {
      // A full disk: sync says so instead of failing quietly.
      if (/ENOSPC|no space/i.test(String(error)))
        throw new MediaStorageRefused({ message: String(error) });
      throw error;
    }
  },
  // A copy: digest takes an ArrayBuffer-backed view.
  sha256: async (bytes) => hex(await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes))),
};
