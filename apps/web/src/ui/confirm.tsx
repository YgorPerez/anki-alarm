import { useState, type ReactNode } from "react";

import { Button } from "#/ui/shadcn/button.tsx";

/** A button that asks before it acts: the question with Confirm and Cancel, in place. */
export function Confirm({
  label,
  question,
  confirm,
  cancel,
  disabled,
  destructive = false,
  asking: initiallyAsking = false,
  onConfirm,
  onCancel,
}: {
  label: string;
  question: ReactNode;
  confirm: string;
  cancel: string;
  disabled?: boolean;
  destructive?: boolean;
  /** Ask straight away, without the first button. */
  asking?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}) {
  const [asking, setAsking] = useState(initiallyAsking);
  const variant = destructive ? "destructive" : "outline";
  if (!asking)
    return (
      <Button
        variant={variant}
        size="lg"
        className="self-start"
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        {label}
      </Button>
    );
  return (
    // In place, not modal: the question replaces the button until it's answered.
    <dialog
      open
      aria-label={label}
      className="static m-0 flex flex-col gap-3 border-0 bg-transparent p-0 text-foreground"
    >
      <p className="text-body">{question}</p>
      <div className="flex flex-wrap gap-3">
        <Button
          variant={variant}
          size="lg"
          disabled={disabled}
          onClick={() => {
            setAsking(false);
            onConfirm();
          }}
        >
          {confirm}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          onClick={() => {
            setAsking(false);
            onCancel?.();
          }}
        >
          {cancel}
        </Button>
      </div>
    </dialog>
  );
}
