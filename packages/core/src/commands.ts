import type { Collection, PresetOptions } from "./collection.ts";
import type { NoteTypeEdit } from "./note-types.ts";

/**
 * An editing command as data, so it can cross from a web tab to the database's owner. Each runs
 * the `Collection` method of the same name.
 */
export type CollectionCommand =
  | { kind: "createDeck"; name: string }
  | { kind: "renameDeck"; id: string; name: string }
  | { kind: "deleteDeck"; id: string }
  | { kind: "updatePreset"; id: string; patch: Partial<PresetOptions> }
  /** An empty `noteTypeId` is Basic, made on first use. */
  | { kind: "addNote"; deckId: string; noteTypeId: string; values: string[] }
  /** With `deckId`, the note's cards move there too. */
  | { kind: "editNote"; id: string; values: string[]; deckId?: string }
  | { kind: "deleteNotes"; ids: string[] }
  | { kind: "editNoteType"; id: string; edit: NoteTypeEdit };

/** Runs one command. Returns the id of the deck or note it created. */
export function runCommand(collection: Collection, command: CollectionCommand): string | undefined {
  switch (command.kind) {
    case "createDeck":
      return collection.createDeck(command.name).id;
    case "addNote": {
      const { deckId, noteTypeId, values } = command;
      return (
        noteTypeId
          ? collection.addNote(deckId, noteTypeId, values)
          : collection.addBasicNote(deckId, values[0] ?? "", values[1] ?? "")
      ).id;
    }
    case "renameDeck":
      collection.renameDeck(command.id, command.name);
      break;
    case "deleteDeck":
      collection.deleteDeck(command.id);
      break;
    case "updatePreset":
      collection.updatePreset(command.id, command.patch);
      break;
    case "editNote":
      collection.editNote(command.id, command.values);
      if (command.deckId !== undefined) collection.moveNote(command.id, command.deckId);
      break;
    case "deleteNotes":
      collection.deleteNotes(command.ids);
      break;
    case "editNoteType":
      collection.editNoteType(command.id, command.edit);
      break;
  }
  return undefined;
}
