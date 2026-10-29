import { validOption, type Preset, type PresetOptions } from "./collection.ts";
import type { Locale } from "./locale.ts";

/** Deck options as a form holds them: the text the user types for each one. */
export type PresetTexts = Record<keyof PresetOptions, string>;

// What each option reads from its text. undefined: not a value of that type.
const integer = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined);
const decimal = (text: string) => {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() && Number.isFinite(value) ? value : undefined;
};
const list = (text: string, separator: RegExp) => {
  const parts = text.trim() ? text.trim().split(separator) : [];
  const values = parts.map(Number);
  return parts.every((p) => p !== "") && values.every(Number.isFinite) ? values : undefined;
};
const read = {
  name: (text: string) => text.trim(),
  newPerDay: integer,
  reviewsPerDay: integer,
  desiredRetention: decimal,
  learningSteps: (text: string) => list(text, /\s+/),
  fsrsParameters: (text: string) => list(text, /[\s,;]+/),
} satisfies { [K in keyof PresetOptions]: (text: string) => PresetOptions[K] | undefined };
const KEYS = [
  "name",
  "newPerDay",
  "reviewsPerDay",
  "desiredRetention",
  "learningSteps",
  "fsrsParameters",
] as const satisfies readonly (keyof PresetOptions)[];
const ok = <T>(value: T | undefined, rule: (value: T) => boolean) =>
  value !== undefined && rule(value);

/** Core's rule for each option (`validOption`), applied to what the user typed. */
export const validPresetText: Record<keyof PresetOptions, (text: string) => boolean> = {
  name: (text) => validOption.name(text),
  newPerDay: (text) => ok(read.newPerDay(text), validOption.newPerDay),
  reviewsPerDay: (text) => ok(read.reviewsPerDay(text), validOption.reviewsPerDay),
  desiredRetention: (text) => ok(read.desiredRetention(text), validOption.desiredRetention),
  learningSteps: (text) => ok(read.learningSteps(text), validOption.learningSteps),
  fsrsParameters: (text) => ok(read.fsrsParameters(text), validOption.fsrsParameters),
};

/** A preset's options as text, with the locale's decimal comma. */
export function presetTexts(preset: Preset, locale: Locale): PresetTexts {
  const f = preset.fields;
  const decimalText = (n: number) => (locale === "pt-BR" ? String(n).replace(".", ",") : String(n));
  return {
    name: f.name.value,
    newPerDay: String(f.newPerDay.value),
    reviewsPerDay: String(f.reviewsPerDay.value),
    desiredRetention: decimalText(f.desiredRetention.value),
    learningSteps: f.learningSteps.value.join(" "),
    fsrsParameters: f.fsrsParameters.value.join(", "),
  };
}

/** The options the texts stand for; undefined while any of them is invalid. */
export function readPresetTexts(texts: PresetTexts): PresetOptions | undefined {
  if (!KEYS.every((key) => validPresetText[key](texts[key]))) return undefined;
  return {
    name: read.name(texts.name),
    newPerDay: read.newPerDay(texts.newPerDay)!,
    reviewsPerDay: read.reviewsPerDay(texts.reviewsPerDay)!,
    desiredRetention: read.desiredRetention(texts.desiredRetention)!,
    learningSteps: read.learningSteps(texts.learningSteps)!,
    fsrsParameters: read.fsrsParameters(texts.fsrsParameters)!,
  };
}
