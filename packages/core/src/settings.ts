import { uuid7 } from "./ids.ts";
import { FACTORY_THEME, parseThemeChoice, type ThemeChoice } from "./theme.ts";
import { nextClock, type CollectionEnvironment, type Field } from "./collection.ts";

export interface Settings {
  id: string;
  fields: { [K in keyof ThemeChoice]: Field<ThemeChoice[K]> };
}
/** The theme choice a settings record holds; a value this version can't read is the factory one. */
export const themeChoiceOf = (settings: Settings): ThemeChoice =>
  parseThemeChoice(
    Object.fromEntries(Object.entries(settings.fields).map(([key, field]) => [key, field.value])),
  );
/** One field clock per color; unchanged fields retain their clock. */
export function updateThemeSettings(
  previous: Settings | undefined,
  patch: Partial<ThemeChoice>,
  env: CollectionEnvironment,
): Settings {
  const hlc = nextClock(previous, env);
  const choice = parseThemeChoice({
    ...FACTORY_THEME,
    ...Object.fromEntries(Object.entries(previous?.fields ?? {}).map(([k, f]) => [k, f.value])),
    ...patch,
  });
  // Each key is preserved with its own correctly typed value.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const fields = Object.fromEntries(
    Object.entries(choice).map(([key, value]) => {
      // Object.entries retains the ThemeChoice keys.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const old = previous?.fields[key as keyof ThemeChoice];
      return [key, old?.value === value ? old : { value, hlc }];
    }),
  ) as Settings["fields"];
  return { id: previous?.id ?? uuid7(env.now(), env.random()), fields };
}
