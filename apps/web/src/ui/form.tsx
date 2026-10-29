import { cn } from "cn";
import { useId, type ComponentProps, type ReactNode } from "react";

const control =
  "w-full rounded-lg border border-border bg-background px-3 text-body text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

/**
 * A labelled control with its hint and error under it. `children` gets the id, the described-by
 * ids and whether it's invalid, for the control to spread.
 */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  className?: string | undefined;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: true;
  }) => ReactNode;
}) {
  const id = useId();
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ");
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-label font-bold">
        {label}
      </label>
      {children({
        id,
        ...(described ? { "aria-describedby": described } : {}),
        ...(error ? { "aria-invalid": true } : {}),
      })}
      {hint && (
        <p id={`${id}-hint`} className="text-caption text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-caption text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-12", className)} {...props} />;
}

function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 py-2", className)} {...props} />;
}

/** Code: templates and CSS, in a monospace face that keeps Anki's braces apart. */
function CodeArea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <Textarea
      spellCheck={false}
      className={cn("min-h-32 font-mono text-label", className)}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(control, "h-12", className)} {...props} />;
}

/** A labelled text control bound to a value: a line, a box, or code (templates and CSS). */
export function TextField({
  label,
  hint,
  errors,
  className,
  kind = "line",
  inputMode,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  hint?: string | undefined;
  /** A TanStack Form field's errors; the first message shows. */
  errors?: readonly unknown[];
  className?: string | undefined;
  kind?: "line" | "box" | "code";
  inputMode?: "decimal" | "numeric";
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  return (
    <Field label={label} hint={hint} error={errors && firstError(errors)} className={className}>
      {(props) => {
        const bound = {
          ...props,
          value,
          onChange: (event: { target: { value: string } }) => onChange(event.target.value),
          ...(onBlur ? { onBlur } : {}),
        };
        if (kind === "code") return <CodeArea {...bound} />;
        if (kind === "box") return <Textarea {...bound} />;
        return <Input {...bound} {...(inputMode ? { inputMode } : {})} />;
      }}
    </Field>
  );
}

/** The first of a TanStack Form field's errors that is a message. */
const firstError = (errors: readonly unknown[]) =>
  errors.find((error): error is string => typeof error === "string");

/** A status line: what a save or an import did. */
export function Notice({ tone, children }: { tone: "muted" | "error"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error" ? "text-body text-destructive" : "text-label text-muted-foreground"
      }
    >
      {children}
    </p>
  );
}
