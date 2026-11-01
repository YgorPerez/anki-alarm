import { EASY_DAYS } from "@app/core";
import { EASY_DAY_MESSAGES, WEEKDAY_MESSAGES, type EasyDaysFieldProps } from "@app/editing-ui";

import { editingCopy } from "#/editing-copy.ts";
import { Field, Select } from "#/ui/form.tsx";

/** Each weekday's easy day. `value` is the form's text: one day per weekday, Monday first. */
export function EasyDaysField({ value, locale, onChange }: EasyDaysFieldProps) {
  const t = editingCopy(locale);
  const days = value.split(" ");
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-label font-bold">{t("easyDays")}</legend>
      <p className="text-caption text-muted-foreground">{t("easyDaysHint")}</p>
      <div className="grid gap-5 sm:grid-cols-2">
        {WEEKDAY_MESSAGES.map((weekday, index) => (
          <Field key={weekday} label={t(weekday)}>
            {(props) => (
              <Select
                {...props}
                value={days[index]}
                onChange={(event) =>
                  onChange(days.map((d, i) => (i === index ? event.target.value : d)).join(" "))
                }
              >
                {EASY_DAYS.map((day) => (
                  <option key={day} value={day}>
                    {t(EASY_DAY_MESSAGES[day])}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ))}
      </div>
    </fieldset>
  );
}
