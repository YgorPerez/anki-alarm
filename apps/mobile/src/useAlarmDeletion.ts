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
  const visibleAlarms = alarms.filter((alarm) => !hidden.includes(alarm.id));
  const removeAlarm = async (alarm: Alarm) => {
    if (!onDelete || pending.current) return;
    pending.current = true;
    setBusy(true);
    setActionError(false);
    try {
      await onDelete(alarm.id);
      setHidden((ids) => [...ids, alarm.id]);
      setDeleted({ alarm, at: now });
    } catch {
      setActionError(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const restoreAlarm = async () => {
    if (!deleted || !undoAvailable || !onRestore || pending.current) return;
    pending.current = true;
    setBusy(true);
    setActionError(false);
    try {
      await onRestore(deleted.alarm);
      setDeleted(null);
    } catch {
      setActionError(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return { visibleAlarms, removeAlarm, restoreAlarm, undoAvailable, busy, actionError };
}
