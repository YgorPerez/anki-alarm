import { useRef, useState } from "react";
import type { Alarm } from "@app/core";

/** Serializes delete/Undo requests and keeps the captured alarm until Undo expires. */
export function useAlarmDeletion(
  alarms: readonly Alarm[],
  now: number,
  onDelete?: (id: string) => Promise<void>,
  onRestore?: (alarm: Alarm) => Promise<void>,
) {
  const [deleted, setDeleted] = useState<{ alarm: Alarm; at: number } | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  const pending = useRef(false);
  const undoAvailable = deleted !== null && (busy || now - deleted.at < 8000);
  const hiddenIds = new Set(hidden);
  const visibleAlarms = alarms.filter((alarm) => !hiddenIds.has(alarm.id));
  // One request at a time; a failure only raises the error flag.
  const run = async (action: () => Promise<void>) => {
    pending.current = true;
    setBusy(true);
    setActionError(false);
    try {
      await action();
    } catch {
      setActionError(true);
    }
    pending.current = false;
    setBusy(false);
  };
  const removeAlarm = async (alarm: Alarm) => {
    if (!onDelete || pending.current) return;
    await run(async () => {
      await onDelete(alarm.id);
      setHidden((ids) => [...ids, alarm.id]);
      setDeleted({ alarm, at: now });
    });
  };
  const restoreAlarm = async () => {
    if (!deleted || !undoAvailable || !onRestore || pending.current) return;
    await run(async () => {
      await onRestore(deleted.alarm);
      setDeleted(null);
    });
  };

  return { visibleAlarms, removeAlarm, restoreAlarm, undoAvailable, busy, actionError };
}
