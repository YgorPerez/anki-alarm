import type { Alarm, Locale } from "@app/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native/pure";
import { useState, type ComponentType } from "react";

type Options = ComponentType<{
  alarm: Alarm;
  locale: Locale;
  onChange: (alarm: Alarm) => void;
}>;

/**
 * One section of the alarm editor, holding the alarm as the editor does: each change shows on the
 * screen, which is what the test reads.
 */
export function renderOptions(Section: Options, alarm: Alarm, locale: Locale) {
  function Editor() {
    const [current, setCurrent] = useState(alarm);
    return <Section alarm={current} locale={locale} onChange={setCurrent} />;
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: "always" } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Editor />
    </QueryClientProvider>,
  );
}
