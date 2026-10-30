package expo.modules.ankidroid

import android.content.ContentResolver
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject

/**
 * Reads AnkiDroid's ContentProvider (`FlashCardsContract`, AnkiDroid 2.24+) into the JSON shapes
 * Core's `AnkiDroidDeck` and `AnkiDroidSource` describe. Column names come from the contract; we
 * don't depend on the `com.ichi2.anki:api` library. See docs/research/ankidroid-api.md.
 */
class AnkiDroidReader(private val resolver: ContentResolver, authority: String = AUTHORITY) {
  companion object {
    const val PACKAGE = "com.ichi2.anki"
    const val AUTHORITY = "$PACKAGE.flashcards"
    const val PERMISSION = "$PACKAGE.permission.READ_WRITE_DATABASE"
    private val DECK_COLUMNS = arrayOf("deck_id", "deck_name", "options", "deck_dyn")
    private val CARD_COLUMNS = arrayOf(
      "_id", "note_id", "ord", "deck_id", "original_deck_id", "reps", "lapses", "type", "queue",
      "due", "interval", "left", "fsrs_stability", "fsrs_difficulty", "last_review_time_secs",
    )
    private val NOTE_COLUMNS = arrayOf("_id", "guid", "mid", "mod", "tags", "flds")
    private val NOTE_TYPE_COLUMNS = arrayOf("_id", "name", "field_names", "css", "type")
    private val TEMPLATE_COLUMNS = arrayOf("ord", "card_template_name", "question_format", "answer_format")
    private const val CHUNK = 500
  }

  private val base = Uri.parse("content://$authority")

  /** Every deck; filtered decks are marked so they aren't offered. */
  fun decks(): JSONArray {
    val decks = JSONArray()
    query(Uri.withAppendedPath(base, "decks"), DECK_COLUMNS) { c ->
      decks.put(JSONObject()
        .put("id", c.getLong(0))
        .put("name", c.getString(1))
        .put("options", c.getString(2) ?: "{}")
        .put("filtered", c.getString(3).let { it == "true" || it == "1" }))
    }
    return decks
  }

  /** The deck, its subdecks, and their notes, note types and cards with scheduling. */
  fun read(deckId: Long): JSONObject {
    val allDecks = decks()
    val root = (0 until allDecks.length()).map { allDecks.getJSONObject(it) }.firstOrNull { it.getLong("id") == deckId }
      ?: throw IllegalArgumentException("AnkiDroid deck $deckId not found")
    val rootName = root.getString("name")
    val decks = (0 until allDecks.length()).map { allDecks.getJSONObject(it) }
      .filter { !it.getBoolean("filtered") && (it.getLong("id") == deckId || it.getString("name").startsWith("$rootName::")) }

    val cards = LinkedHashMap<Long, JSONObject>()
    for (deck in decks) {
      // `did:` matches a deck by id; cards are deduplicated in case it also matches subdecks.
      query(Uri.withAppendedPath(base, "cards"), CARD_COLUMNS, "did:${deck.getLong("id")}") { c ->
        cards[c.getLong(0)] = card(c)
      }
    }

    val notes = JSONArray()
    val noteTypeIds = LinkedHashSet<Long>()
    // notes_v2 takes a SQL WHERE on the notes table; ids are numbers we read, never user input.
    for (chunk in cards.values.map { it.getLong("noteId") }.distinct().chunked(CHUNK)) {
      query(Uri.withAppendedPath(base, "notes_v2"), NOTE_COLUMNS, "id IN (${chunk.joinToString(",")})") { c ->
        noteTypeIds += c.getLong(2)
        notes.put(JSONObject()
          .put("id", c.getLong(0))
          .put("guid", c.getString(1))
          .put("noteTypeId", c.getLong(2))
          .put("mod", c.getLong(3))
          .put("tags", c.getString(4) ?: "")
          .put("fields", c.getString(5) ?: ""))
      }
    }

    val noteTypes = JSONArray()
    for (id in noteTypeIds) {
      val model = Uri.withAppendedPath(Uri.withAppendedPath(base, "models"), id.toString())
      val templates = JSONArray()
      query(Uri.withAppendedPath(model, "templates"), TEMPLATE_COLUMNS) { c ->
        templates.put(JSONObject()
          .put("ord", c.getInt(0))
          .put("name", c.getString(1))
          .put("front", c.getString(2) ?: "")
          .put("back", c.getString(3) ?: ""))
      }
      query(model, NOTE_TYPE_COLUMNS) { c ->
        noteTypes.put(JSONObject()
          .put("id", c.getLong(0))
          .put("name", c.getString(1))
          .put("fieldNames", c.getString(2) ?: "")
          .put("css", c.getString(3) ?: "")
          .put("cloze", c.getInt(4) == 1)
          .put("templates", templates))
      }
    }

    return JSONObject()
      .put("deckId", deckId)
      .put("decks", JSONArray(decks))
      .put("noteTypes", noteTypes)
      .put("notes", notes)
      .put("cards", JSONArray(cards.values))
  }

  /** Every card of these notes, with scheduling, as Core's `AnkiDroidCard`. */
  fun cards(noteIds: List<Long>): JSONArray {
    val cards = JSONArray()
    for (chunk in noteIds.distinct().chunked(CHUNK)) {
      query(Uri.withAppendedPath(base, "cards"), CARD_COLUMNS, "nid:${chunk.joinToString(",")}") { c -> cards.put(card(c)) }
    }
    return cards
  }

  /**
   * Answers a card through AnkiDroid's scheduler, which writes a real revlog row stamped now, and
   * reads the card back. AnkiDroid returns success even when the answer failed: callers check reps.
   * null when AnkiDroid has no such card.
   */
  fun answer(noteId: Long, ord: Int, ease: Int, timeTakenMs: Long): JSONObject? {
    val values = ContentValues().apply {
      put("note_id", noteId)
      put("ord", ord)
      put("answer_ease", ease)
      // Without it AnkiDroid times the answer from its own timer start.
      put("time_taken", timeTakenMs)
    }
    resolver.update(Uri.withAppendedPath(base, "schedule"), values, null, null)
    val cards = cards(listOf(noteId))
    return (0 until cards.length()).map { cards.getJSONObject(it) }.firstOrNull { it.getInt("ord") == ord }
  }

  /** FlashCardsContract.ReviewInfo.SUSPEND is a write-only integer on /schedule. */
  fun suspendCard(noteId: Long, ord: Int): JSONObject? {
    val values = ContentValues().apply {
      put("note_id", noteId)
      put("ord", ord)
      put("suspended", 1)
    }
    resolver.update(Uri.withAppendedPath(base, "schedule"), values, null, null)
    val cards = cards(listOf(noteId))
    return (0 until cards.length()).map { cards.getJSONObject(it) }.firstOrNull { it.getInt("ord") == ord }
  }

  private fun card(c: Cursor) = JSONObject()
    .put("id", c.getLong(0))
    .put("noteId", c.getLong(1))
    .put("ord", c.getInt(2))
    .put("deckId", c.getLong(3))
    .put("originalDeckId", c.getLong(4))
    .put("reps", c.getInt(5))
    .put("lapses", c.getInt(6))
    .put("type", c.getInt(7))
    .put("queue", c.getInt(8))
    .put("due", c.getLong(9))
    .put("interval", c.getInt(10))
    .put("left", c.getInt(11))
    .put("stability", c.doubleOrNull(12) ?: JSONObject.NULL)
    .put("difficulty", c.doubleOrNull(13) ?: JSONObject.NULL)
    .put("lastReviewSecs", c.longOrNull(14) ?: JSONObject.NULL)

  private fun query(uri: Uri, columns: Array<String>, selection: String? = null, row: (Cursor) -> Unit) {
    // A null cursor is how the provider answers an empty search.
    resolver.query(uri, columns, selection, null, null)?.use { c -> while (c.moveToNext()) row(c) }
  }

  private fun Cursor.doubleOrNull(i: Int) = if (isNull(i)) null else getDouble(i)
  private fun Cursor.longOrNull(i: Int) = if (isNull(i)) null else getLong(i)
}
