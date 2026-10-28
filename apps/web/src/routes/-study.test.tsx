import { fakeSyncApi, memorySyncServer, type MemorySyncServer } from "@app/contracts/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { Effect } from "effect";
import { afterAll, expect, test } from "vite-plus/test";

import { disposeApis, google, syncWith } from "../../test/account.ts";
import { openDevice } from "../../test/device.ts";
import { renderRoute } from "../../test/render.tsx";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
afterAll(disposeApis);

/** The phone: it made a deck, signed in to `user` and synced it. */
async function phoneWithDeck(server: MemorySyncServer, user: string) {
  const phone = await openDevice("phone");
  await run(
    phone.changeCollection((c) => {
      const deck = c.createDeck("Palavras");
      c.addBasicNote(deck.id, "casa", "house [sound:casa.mp3]");
    }),
  );
  await run(phone.adoptAccount(user));
  const sync = async () => {
    const api = await fakeSyncApi({ ...server, user });
    try {
      return await run(phone.sync(api.client));
    } finally {
      await api.dispose();
    }
  };
  await sync();
  return { phone, sync };
}

test("after sign-in the phone's deck is studied with Core's card and the review syncs back", async () => {
  const server = memorySyncServer();
  const { phone, sync } = await phoneWithDeck(server, "ana");
  syncWith(server);
  google.picks = [{ id: "ana", email: "ana@example.com" }];
  const { user } = await renderRoute("/");

  await user.click(await screen.findByRole("button", { name: "Entrar com o Google" }));
  const decks = await screen.findByRole("list", { name: "Baralhos" });
  const deck = await within(decks).findByRole("link", { name: /Palavras/ });
  expect(deck.textContent).toContain("1 para hoje");
  expect(screen.getByText("Conectado como ana@example.com")).toBeDefined();

  await user.click(deck);
  expect(await screen.findByRole("heading", { name: "Palavras" })).toBeDefined();
  const front = screen.getByTitle("Frente");
  expect(front.getAttribute("srcdoc")).toContain("casa");
  expect(front.getAttribute("srcdoc")).not.toContain("house");

  await user.click(screen.getByRole("button", { name: "Mostrar resposta" }));
  const back = screen.getByTitle("Verso").getAttribute("srcdoc");
  expect(back).toContain("house");
  // `[sound:]` is a player for the card's own file.
  expect(back).toMatch(/<audio controls[^>]*src="\/media\/casa\.mp3"/);

  await user.click(screen.getByRole("button", { name: "Bom" }));
  expect(
    await screen.findByText("Nenhum cartão disponível agora. Os limites diários se aplicam."),
  ).toBeDefined();

  // Written locally first, then sent a few seconds later without anyone asking.
  await waitFor(
    () =>
      expect(server.stored("ana")).toContainEqual(
        expect.objectContaining({
          kind: "reviewLog",
          entry: expect.objectContaining({ kind: "review", grade: 3, origin: "web" }),
        }),
      ),
    { timeout: 10_000 },
  );
  await sync();
  expect(await run(phone.reviewLog)).toMatchObject([{ kind: "review", grade: 3, origin: "web" }]);
}, 30_000);
