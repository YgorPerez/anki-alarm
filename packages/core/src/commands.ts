import type { Collection, PresetOptions } from "./collection.ts";
import type { LimitScope } from "./daily-limits.ts";
import type { NoteTypeEdit } from "./note-types.ts";

/**
 * An editing command as data, so it can cross from a web tab to the database's owner. Each runs
 * the `Collection` method of the same name.
 */
export type CollectionCommand =
  | { kind: "createDeck"; name: string }
  | { kind: "renameDeck"; id: string; name: string }
  | { kind: "deleteDeck"; id: string }
  | { kind: "createPreset"; name: string; deckId: string }
  | { kind: "duplicatePreset"; id: string; name: string; deckId: string }
  | { kind: "setDeckPreset"; deckId: string; presetId: string }
  | { kind: "deletePreset"; id: string }
  /** With `limits`, the patch's two daily limits are set at those scopes for that deck. */
  | {
      kind: "updatePreset";
      id: string;
      patch: Partial<PresetOptions>;
      limits?: { deckId: string; new: LimitScope; review: LimitScope };
    }
  /** An empty `noteTypeId` is Basic, made on first use. */
  | { kind: "addNote"; deckId: string; noteTypeId: string; values: string[] }
  /** With `deckId`, the note's cards move there too. */
  | { kind: "editNote"; id: string; values: string[]; deckId?: string }
  | { kind: "deleteNotes"; ids: string[] }
  | { kind: "editNoteType"; id: string; edit: NoteTypeEdit }
  /** Anki's flag 1–7 on a card; 0 clears it. */
  | { kind: "setCardFlag"; id: string; flag: number }
  /** The note's `marked` tag. */
  | { kind: "setNoteMarked"; id: string; marked: boolean }
  /** Puts back the suspension `setCardsSuspended` or `suspendNote` returned. */
  | { kind: "restoreSuspension"; previous: { cardId: string; suspended: boolean }[] }
  | { kind: "unburyCard"; id: string };

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
    case "createPreset":
    case "duplicatePreset": {
      if (!collection.snapshot().decks.some((d) => d.id === command.deckId))
        throw new Error("Invalid deck");
      const preset =
        command.kind === "createPreset"
          ? collection.createPreset(command.name)
          : collection.duplicatePreset(command.id, command.name);
      collection.setDeckPreset(command.deckId, preset.id);
      return preset.id;
    }
    case "setDeckPreset":
      collection.setDeckPreset(command.deckId, command.presetId);
      break;
    case "deletePreset":
      collection.deletePreset(command.id);
      break;
    case "updatePreset": {
      const { limits } = command;
      if (!limits) {
        collection.updatePreset(command.id, command.patch);
        break;
      }
      const { newPerDay, reviewsPerDay, ...rest } = command.patch;
      collection.updatePreset(command.id, rest);
      if (newPerDay !== undefined)
        collection.setDeckLimit(limits.deckId, "new", limits.new, newPerDay);
      if (reviewsPerDay !== undefined)
        collection.setDeckLimit(limits.deckId, "review", limits.review, reviewsPerDay);
      break;
    }
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
    case "setCardFlag":
      collection.setCardFlag(command.id, command.flag);
      break;
    case "setNoteMarked":
      collection.setNoteMarked(command.id, command.marked);
      break;
    case "restoreSuspension":
      collection.restoreSuspension(command.previous);
      break;
    case "unburyCard":
      collection.unburyCard(command.id);
      break;
  }
  return undefined;
}
