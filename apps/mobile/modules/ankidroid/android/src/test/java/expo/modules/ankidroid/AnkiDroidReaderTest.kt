package expo.modules.ankidroid

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import org.robolectric.RuntimeEnvironment
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/** A provider answering like AnkiDroid 2.24's `CardContentProvider` for one deck and a subdeck. */
class FakeAnkiDroid : ContentProvider() {
  val searches = mutableListOf<String?>()
  val answers = mutableListOf<Map<String, Any?>>()
  /** Card 9001's reps: answering it raises them, as AnkiDroid's scheduler does. */
  var reps = 0
  override fun onCreate() = true
  override fun query(uri: Uri, projection: Array<String>?, selection: String?, args: Array<String>?, sort: String?): Cursor? {
    val columns = requireNotNull(projection)
    fun cursor(vararg rows: Map<String, Any?>) = MatrixCursor(columns).apply {
      for (row in rows) addRow(columns.map { row[it] })
    }
    val path = uri.pathSegments
    return when {
      path == listOf("decks") -> cursor(
        mapOf("deck_id" to 1L, "deck_name" to "Default", "options" to "{}", "deck_dyn" to false),
        mapOf("deck_id" to 10L, "deck_name" to "Japanese", "options" to "{\"id\":1}", "deck_dyn" to false),
        mapOf("deck_id" to 11L, "deck_name" to "Japanese::Kanji", "options" to "{\"id\":1}", "deck_dyn" to false),
        mapOf("deck_id" to 12L, "deck_name" to "Japanese cram", "options" to "{}", "deck_dyn" to true),
      )
      path == listOf("cards") -> {
        searches += selection
        val card = { id: Long, did: Long, reps: Int -> mapOf(
          "_id" to id, "note_id" to 501L, "ord" to (id - 9001).toInt(), "deck_id" to did, "original_deck_id" to 0L,
          "reps" to reps, "lapses" to 0, "type" to if (reps > 0) 2 else 0, "queue" to 0, "due" to 3L, "interval" to 4,
          "left" to 0, "fsrs_stability" to if (reps > 0) 5.5 else null, "fsrs_difficulty" to null,
          "last_review_time_secs" to if (reps > 0) 1760000000L else null,
        ) }
        when (selection) {
          // `did:` here also matches subdecks, so the reader must deduplicate.
          "did:10" -> cursor(card(9001, 10, reps), card(9002, 11, 2))
          "did:11" -> cursor(card(9002, 11, 2))
          "nid:501" -> cursor(card(9001, 10, reps), card(9002, 11, 2))
          else -> null
        }
      }
      path == listOf("notes_v2") && selection == "id IN (501)" -> cursor(mapOf(
        "_id" to 501L, "guid" to "abc", "mid" to 77L, "mod" to 1760000000L, "tags" to " verb ", "flds" to "食べる\u001feat",
      ))
      path == listOf("models", "77") -> cursor(mapOf(
        "_id" to 77L, "name" to "Basic (and reversed card)", "field_names" to "Front\u001fBack", "css" to ".card{}", "type" to 0,
      ))
      path == listOf("models", "77", "templates") -> cursor(
        mapOf("ord" to 0, "card_template_name" to "Card 1", "question_format" to "{{Front}}", "answer_format" to "{{Back}}"),
        mapOf("ord" to 1, "card_template_name" to "Card 2", "question_format" to "{{Back}}", "answer_format" to "{{Front}}"),
      )
      else -> throw IllegalArgumentException("unexpected $uri $selection")
    }
  }
  override fun getType(uri: Uri): String? = null
  override fun insert(uri: Uri, values: ContentValues?): Uri? = null
  override fun delete(uri: Uri, selection: String?, args: Array<String>?) = 0
  override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<String>?): Int {
    require(uri.pathSegments == listOf("schedule")) { "unexpected $uri" }
    val row = requireNotNull(values).keySet().associateWith { values.get(it) }
    answers += row
    if (row["note_id"] == 501L && row["ord"] == 0) reps++
    // AnkiDroid counts the row as updated whether or not the answer worked.
    return 1
  }
}

@RunWith(RobolectricTestRunner::class)
class AnkiDroidReaderTest {
  private fun reader(): Pair<AnkiDroidReader, FakeAnkiDroid> {
    val provider = Robolectric.buildContentProvider(FakeAnkiDroid::class.java).create(AnkiDroidReader.AUTHORITY).get()
    return AnkiDroidReader(RuntimeEnvironment.getApplication().contentResolver) to provider
  }

  @Test
  fun `lists decks and marks filtered ones`() {
    val decks = reader().first.decks()
    assertEquals(4, decks.length())
    assertEquals("Japanese::Kanji", decks.getJSONObject(2).getString("name"))
    assertEquals(true, decks.getJSONObject(3).getBoolean("filtered"))
  }

  @Test
  fun `reads a deck with its subdecks, notes, note types and scheduling`() {
    val (reader, provider) = reader()
    val source = reader.read(10)
    assertEquals(listOf("did:10", "did:11"), provider.searches)
    assertEquals(10L, source.getLong("deckId"))
    assertEquals(2, source.getJSONArray("decks").length())
    val cards = source.getJSONArray("cards")
    assertEquals(2, cards.length())
    val reviewed = cards.getJSONObject(1)
    assertEquals(9002L, reviewed.getLong("id"))
    assertEquals(11L, reviewed.getLong("deckId"))
    assertEquals(5.5, reviewed.getDouble("stability"), 0.0)
    assertEquals(true, reviewed.isNull("difficulty"))
    assertEquals(1760000000L, reviewed.getLong("lastReviewSecs"))
    assertEquals(true, cards.getJSONObject(0).isNull("lastReviewSecs"))
    val note = source.getJSONArray("notes").getJSONObject(0)
    assertEquals("abc", note.getString("guid"))
    assertEquals("食べる\u001feat", note.getString("fields"))
    val type = source.getJSONArray("noteTypes").getJSONObject(0)
    assertEquals(false, type.getBoolean("cloze"))
    assertEquals("Card 2", type.getJSONArray("templates").getJSONObject(1).getString("name"))
  }

  @Test
  fun `answers a card by note id and ord and reads it back`() {
    val (reader, provider) = reader()
    val card = requireNotNull(reader.answer(501, 0, 3, 4200))
    assertEquals(
      listOf(mapOf<String, Any?>("note_id" to 501L, "ord" to 0, "answer_ease" to 3, "time_taken" to 4200L)),
      provider.answers,
    )
    assertEquals(9001L, card.getLong("id"))
    assertEquals(1, card.getInt("reps"))
    assertEquals(listOf("nid:501"), provider.searches)
    assertEquals(2, reader.cards(listOf(501, 501)).length())
    assertEquals(null, reader.answer(501, 5, 3, 4200))
  }
}
