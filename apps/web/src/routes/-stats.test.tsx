import { ALARM_EVENTS, newAlarm, type AlarmEvent } from "@app/core";
import { fakeSyncApi, memorySyncServer } from "@app/contracts/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { Effect } from "effect";
import { afterAll, expect, test } from "vite-plus/test";

import { disposeApis, google, syncWith } from "../../test/account.ts";
import { openDevice } from "../../test/device.ts";
import { renderRoute } from "../../test/render.tsx";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
afterAll(disposeApis);

/** The paints of a chart's drawn bars. */
const fills = (chart: Element) =>
  [...chart.querySelectorAll("rect, path")].map((shape) => shape.getAttribute("fill"));

test("the web shows the phone's study and wake-up stats once its journal syncs", async () => {
  const server = memorySyncServer();
  const phone = await openDevice("phone");
  const state = await run(
    phone.changeCollection((c) => {
      c.addBasicNote(c.createDeck("Palavras").id, "casa", "house");
      c.addBasicNote(c.createDeck("Verbos").id, "correr", "run");
    }),
  );
  const deckCard = (name: string) => {
    const deck = state.decks.find((d) => d.fields.name.value === name)!;
    return state.cards.find((c) => c.fields.deckId.value === deck.id)!.id;
  };
  // Dismissed a minute from now, so the answer the phone gives now counts toward it.
  const start = Date.now() - 11 * 60_000;
  let n = 0;
  const event = (kind: string, at: number): AlarmEvent => ({
    id: `event-${n++}`,
    kind,
    alarmId: "work",
    ringId: "ring-1",
    wallTime: at,
    elapsedRealtime: at - start + 5_000,
  });
  await run(
    Effect.gen(function* () {
      yield* phone.saveAlarm({ ...newAlarm("work"), label: "Trabalho" });
      yield* phone.answerCard(deckCard("Palavras"), 1, 1000, "ring-1");
      yield* phone.answerCard(deckCard("Verbos"), 3, 1000);
      yield* phone.ingestEvents([
        event(ALARM_EVENTS.ringStarted, start),
        event(ALARM_EVENTS.snoozed, start + 60_000),
        event(ALARM_EVENTS.dismissed, start + 12 * 60_000),
      ]);
      yield* phone.adoptAccount("ana");
    }),
  );
  const api = await fakeSyncApi({ ...server, user: "ana" });
  await run(phone.sync(api.client));
  await api.dispose();

  syncWith(server);
  google.picks = [{ id: "ana", email: "ana@example.com" }];
  const { user } = await renderRoute("/");
  await user.click(await screen.findByRole("button", { name: "Entrar com o Google" }));
  await within(await screen.findByRole("list", { name: "Baralhos" })).findByRole("link", {
    name: /^Palavras/,
  });
  await user.click(screen.getByRole("link", { name: "Estatísticas" }));

  const work = await screen.findByRole("listitem", { name: "Trabalho" });
  expect(within(work).getByText("Tocou 1 vez")).toBeDefined();
  expect(within(work).getByText("12 min")).toBeDefined();
  expect(within(work).getAllByText("1,0")).toHaveLength(2);
  expect(screen.getByRole("listitem", { name: "Todos os alarmes" })).toBeDefined();

  const daily = within(screen.getByRole("region", { name: "Revisões por dia" })).getByRole("img", {
    name: "Revisões por dia",
  });
  expect(fills(daily)).toEqual(expect.arrayContaining(["var(--color-again)", "var(--color-good)"]));
  for (const name of [
    "Previsão",
    "Cartões por estado",
    "Intervalos",
    "Revisões por hora",
    "Estabilidade",
    "Dificuldade",
    "Recuperabilidade",
  ])
    expect(within(screen.getByRole("region", { name })).getByRole("img", { name })).toBeDefined();
  expect(screen.getByRole("table", { name: "Retenção real" })).toBeDefined();

  // One deck: its own answers, and no wake-up stats, which belong to the whole collection.
  await user.click(screen.getByRole("link", { name: "Verbos" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Despertar" })).toBeNull());
  const deck = screen.getByRole("img", { name: "Revisões por dia" });
  expect(fills(deck)).toContain("var(--color-good)");
  expect(fills(deck)).not.toContain("var(--color-again)");
}, 30_000);
