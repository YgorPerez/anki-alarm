package expo.modules.alarmnative

import java.io.File
import java.io.InputStream

/** Keeps each alarm's sound in device-protected storage, so it plays before the first unlock. */
object SoundFile {
  /**
   * Copies [source] into [file] and returns it, or null to ring the phone's alarm sound: when there
   * is no source, or a new choice can't be read. An unchanged choice reuses its copy unless the
   * copy predates [staleBefore] (the last app update, which may change bundled sounds); if
   * refreshing it fails, the copy is still the chosen sound and stays.
   */
  fun freeze(source: String?, previous: String?, file: File, staleBefore: Long, open: (String) -> InputStream): File? {
    if (source == null) {
      file.delete()
      return null
    }
    val kept = source == previous && file.exists()
    if (kept && file.lastModified() >= staleBefore) return file
    val partial = File(file.path + ".partial")
    return try {
      open(source).use { input -> partial.outputStream().use { input.copyTo(it) } }
      check(partial.renameTo(file))
      file
    } catch (e: Exception) {
      partial.delete()
      if (kept) return file
      file.delete()
      null
    }
  }
}
