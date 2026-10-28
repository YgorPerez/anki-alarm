import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import fixture from "../../../packages/core/fixtures/ankidroid-deck.json" with { type: "json" };
import { memoryAnkiDroid, syncBackAfterSession, type AnkiDroidApi } from "./ankidroid.ts";
import { CollectionScreen } from "./CollectionScreen.tsx";
import { localData } from "./database.ts";

const run = <A,>(read: Parameters<typeof localData<A>>[0]) => Effect.runPromise(localData(read));
const ready = { versionCode: 22500300, permission: "granted" as const };
const show = (ankiDroid: AnkiDroidApi) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" } } })
      }
    >
      <CollectionScreen locale="pt-BR" onExit={() => {}} onTheme={() => {}} ankiDroid={ankiDroid} />
    </QueryClientProvider>,
  );
const press = async (name: string | RegExp) =>
  fireEvent.press(await screen.findByRole("button", { name }));
/** Answers the deck's first card in the app, as a study session does. */
async function answerFirstCard(grade: 1 | 2 | 3 | 4) {
  const state = await run((data) => data.collection);
  const card = state.cards.find((c) => c.anki?.id === 9001)!;
  return run((data) => data.answerCard(card.id, grade, 6000, `ring-${grade}`));
}

test("on the phone that linked it, the deck sends its reviews to AnkiDroid and pulls", async () => {
  const ankiDroid = memoryAnkiDroid({ installed: ready, sources: [fixture.source] });
  await run((data) => data.linkAnkiDroidDeck(fixture.source));
  await answerFirstCard(3);
  await show(ankiDroid);
  await press(/Japonês/);
  expect(await screen.findByText("Vinculado ao AnkiDroid")).toBeDefined();

  await press("Enviar revisões ao AnkiDroid");
  expect(await screen.findByText("1 revisões enviadas ao AnkiDroid.")).toBeDefined();
  expect(ankiDroid.answers.map((a) => [a.noteId, a.ord, a.ease, a.timeTakenMs])).toEqual([
    [501, 0, 3, 6000],
  ]);

  // Pull sends what's new first, then reads the deck; our answer doesn't come back as a snapshot.
  await answerFirstCard(1);
  await press("Puxar do AnkiDroid");
  expect(
    await screen.findByText(
      "Do AnkiDroid: 0 notas novas, 0 editadas, 0 cartões com estado novo. 1 revisões enviadas.",
    ),
  ).toBeDefined();
  expect(ankiDroid.answers.map((a) => a.ease)).toEqual([3, 1]);

  // Forget and Set due date say they stay in the app.
  await press("Editar nota: 猫");
  expect(await screen.findByText(/ficam só no app/)).toBeDefined();
});

test("after an alarm session, sync back runs unless the user turned it off", async () => {
  const ankiDroid = memoryAnkiDroid({ installed: ready, sources: [fixture.source] });
  await answerFirstCard(4);
  await show(ankiDroid);
  await press(/Japonês/);
  const toggle = await screen.findByLabelText("Enviar ao AnkiDroid depois de cada alarme");
  expect(toggle.props.value).toBe(true);
  await fireEvent(toggle, "valueChange", false);
  expect(await Effect.runPromise(syncBackAfterSession(ankiDroid))).toBe(0);
  await run((data) => data.setAutoSyncBack(true));
  expect(await Effect.runPromise(syncBackAfterSession(ankiDroid))).toBe(1);
  // Without AnkiDroid's permission it waits for the next session.
  await answerFirstCard(2);
  const denied = memoryAnkiDroid({
    installed: { ...ready, permission: "denied" },
    sources: [fixture.source],
  });
  expect(await Effect.runPromise(syncBackAfterSession(denied))).toBe(0);
});
