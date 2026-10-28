package expo.modules.alarmnative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.FileNotFoundException
import java.io.InputStream

class SoundFileTest {
  @get:Rule val folder = TemporaryFolder()

  private val sources = mutableMapOf<String, String>()
  private val opened = mutableListOf<String>()
  private val open = { uri: String ->
    opened += uri
    (sources[uri] ?: throw FileNotFoundException(uri)).byteInputStream() as InputStream
  }
  private fun copy() = File(folder.root, "alarm-a.audio")

  @Test fun copiesTheChosenSoundIntoDeviceStorage() {
    sources["content://media/galo"] = "cocorico"
    val file = SoundFile.freeze("content://media/galo", null, copy(), 0, open)
    assertEquals("cocorico", file!!.readText())
  }

  @Test fun aGoneSourceWithNoCopyRingsThePhonesAlarmSound() {
    assertNull(SoundFile.freeze("content://media/deleted", null, copy(), 0, open))
    assertFalse(copy().exists())
  }

  @Test fun aNewChoiceThatIsGoneDropsTheOldCopy() {
    copy().writeText("old sound")
    assertNull(SoundFile.freeze("content://media/deleted", "content://media/old", copy(), 0, open))
    assertFalse(copy().exists())
  }

  @Test fun reusesTheCopyOfAnUnchangedChoice() {
    copy().writeText("cocorico")
    sources["content://media/galo"] = "changed on disk"
    val file = SoundFile.freeze("content://media/galo", "content://media/galo", copy(), 0, open)
    assertEquals("cocorico", file!!.readText())
    assertEquals(emptyList<String>(), opened)
  }

  @Test fun keepsAStaleCopyOfAnUnchangedChoiceWhenItsSourceIsGone() {
    copy().writeText("cocorico")
    copy().setLastModified(1_000)
    val file = SoundFile.freeze("content://media/galo", "content://media/galo", copy(), 2_000, open)
    assertEquals(listOf("content://media/galo"), opened)
    assertEquals("cocorico", file!!.readText())
  }

  @Test fun thePhonesAlarmSoundNeedsNoCopy() {
    copy().writeText("old sound")
    assertNull(SoundFile.freeze(null, "content://media/old", copy(), 0, open))
    assertFalse(copy().exists())
    assertEquals(emptyList<String>(), opened)
  }
}
