import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import { FACTORY_THEME, themeFor } from "@app/core";
import { fakeSyncApi } from "@app/contracts/testing";
import { localData } from "./database.ts";
import { StatsScreen } from "./StatsScreen.tsx";

const theme = themeFor(FACTORY_THEME, "light");
type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] };
/** The paints of a chart's drawn shapes. */
function fills(node: Node): unknown[] {
  const own = node.type === "Rect" || node.type === "Path" ? [node.props?.fill] : [];
  return [
    ...own,
    ...(node.children ?? []).flatMap((child) =>
      typeof child === "object" && child ? fills(child as Node) : [],
    ),
  ];
}

test("shows each stat overall and per deck from the local review log, drawing grades in their hues", async () => {
  const api = await fakeSyncApi({});
  const state = await Effect.runPromise(
    localData((data) =>
      data.changeCollection((c) => {
        c.addBasicNote(c.createDeck("Palavras").id, "casa", "house");
        c.addBasicNote(c.createDeck("Verbos").id, "correr", "run");
      }),
    ),
  );
  const deckCard = (name: string) => {
    const deck = state.decks.find((d) => d.fields.name.value === name)!;
    return state.cards.find((c) => c.fields.deckId.value === deck.id)!.id;
  };
  await Effect.runPromise(localData((data) => data.answerCard(deckCard("Palavras"), 1, 1000)));
  await Effect.runPromise(localData((data) => data.answerCard(deckCard("Verbos"), 3, 1000)));
  try {
    await render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <StatsScreen locale="pt-BR" theme={theme} onExit={() => {}} />
      </QueryClientProvider>,
    );
    const daily = await screen.findByLabelText("Revisões por dia");
    expect(fills(daily)).toEqual(expect.arrayContaining([theme.again, theme.good]));
    expect(fills(daily)).not.toContain(theme.easy);
    for (const name of [
      "Previsão",
      "Cartões por estado",
      "Intervalos",
      "Revisões por hora",
      "Estabilidade",
      "Dificuldade",
      "Recuperabilidade",
    ])
      expect(screen.getByLabelText(name)).toBeTruthy();
    expect(screen.getByText("Retenção real")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Palavras" }));
    const deck = await screen.findByLabelText("Revisões por dia");
    expect(fills(deck)).toContain(theme.again);
    expect(fills(deck)).not.toContain(theme.good);
    expect(api.calls.metadata).toBe(0);
  } finally {
    await api.dispose();
  }
});
