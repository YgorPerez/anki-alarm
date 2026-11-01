import { changeAppState } from "../test/native/react-native.ts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect } from "effect";
import fixture from "../../../packages/core/fixtures/ankidroid-deck.json" with { type: "json" };
import { memoryAnkiDroid, syncBackAfterSession, type AnkiDroidApi } from "./ankidroid.ts";
import { AnkiDroidAutoSync } from "./AnkiDroidAutoSync.tsx";
import { AnkiDroidSyncBackCard } from "./AnkiDroidSyncBackCard.tsx";
import { StudyScreen } from "./StudyScreen.tsx";
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
      <AnkiDroidAutoSync ankiDroid={ankiDroid} />
      <AnkiDroidSyncBackCard locale="pt-BR" />
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
  const toggle = await screen.findByLabelText("Enviar ao AnkiDroid automaticamente");
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

test("a deck shows pending answers before a sync and a global card explains missing permission", async () => {
  await answerFirstCard(3);
  const denied = memoryAnkiDroid({ installed: { ...ready, permission: "denied" } });
  await Effect.runPromise(syncBackAfterSession(denied));
  await show(denied);
  expect(await screen.findByRole("alert")).toBeDefined();
  expect(await screen.findByText(/envio automático ao AnkiDroid parou/)).toBeDefined();
  await press(/Japonês/);
  expect(await screen.findByText(/revisões pendentes para o AnkiDroid/)).toBeDefined();
});

test.each([
  [null, "O AnkiDroid não está instalado"],
  [{ versionCode: 22300000, permission: "granted" as const }, "AnkiDroid 2.24 ou mais novo"],
] as const)("auto sync explains unavailable AnkiDroid globally: %s", async (installed, message) => {
  await Effect.runPromise(syncBackAfterSession(memoryAnkiDroid({ installed })));
  await show(memoryAnkiDroid({ installed }));
  expect(await screen.findByRole("alert")).toBeDefined();
  expect(screen.getByText(new RegExp(message))).toBeDefined();
});

test("finishing normal study sends linked answers automatically", async () => {
  const anki = memoryAnkiDroid({ installed: ready, sources: [fixture.source] });
  const deckId = await run((data) => data.linkAnkiDroidDeck(fixture.source));
  await run((data) =>
    data.changeCollection((c) => {
      const cards = c.snapshot().cards;
      c.setCardsSuspended(
        cards.filter((card) => card.anki?.id !== 9001).map((card) => card.id),
        true,
      );
    }),
  );
  const fresh = (await run((data) => data.collection)).cards.find((c) => c.anki?.id === 9001)!;
  await run((data) => data.forgetCard(fresh.id));
  await render(
    <QueryClientProvider client={new QueryClient()}>
      <StudyScreen deckId={deckId} locale="pt-BR" onExit={() => {}} ankiDroid={anki} />
    </QueryClientProvider>,
  );
  await press("Mostrar resposta");
  await press("Fácil");
  await screen.findByText("Nenhum cartão disponível agora. Os limites diários se aplicam.");
  await waitFor(() => expect(anki.answers.some((answer) => answer.ease === 4)).toBe(true));
});

test("background sync respects this phone's toggle and refreshes pending counts", async () => {
  const anki = memoryAnkiDroid({ installed: ready, sources: [fixture.source] });
  await answerFirstCard(3);
  await run((data) => data.setAutoSyncBack(false));
  await show(anki);
  changeAppState("background");
  await press(/Japonês/);
  expect(await screen.findByText(/revisões pendentes para o AnkiDroid/)).toBeDefined();
  expect(anki.answers).toHaveLength(0);
  await run((data) => data.setAutoSyncBack(true));
  changeAppState("active");
  changeAppState("background");
  await waitFor(() => expect(anki.answers.some((a) => a.ease === 3)).toBe(true));
  await screen.findByText("0 revisões pendentes para o AnkiDroid.");
  changeAppState("active");
});

test("an unrecorded answer stops sending with a visible reason and keeps later answers pending", async () => {
  const anki = memoryAnkiDroid({ installed: ready, sources: [fixture.source] });
  anki.answer = (answer) =>
    anki
      .cards([answer.noteId])
      .pipe(
        Effect.map(
          (cards) =>
            cards.find((card) => card.noteId === answer.noteId && card.ord === answer.ord) ?? null,
        ),
      );
  await answerFirstCard(3);
  await answerFirstCard(2);
  await Effect.runPromise(syncBackAfterSession(anki));
  await show(anki);
  expect(await screen.findByRole("alert")).toBeDefined();
  expect(screen.getByText(/O AnkiDroid não registrou uma resposta/)).toBeDefined();
  await press(/Japonês/);
  expect(await screen.findByText("2 revisões pendentes para o AnkiDroid.")).toBeDefined();
});
