import type { ClientData } from "@app/client-data";
import { fakeSyncApi, memorySyncServer, type FakeSyncApi } from "@app/contracts/testing";
import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { Effect } from "effect";
import { afterEach, expect, test } from "vite-plus/test";

import { AccountPanel } from "./AccountPanel.tsx";
import { localData } from "./database.ts";
import { createSync, type Account, type AccountUser, type Sync } from "./sync.ts";

const data = <A, E>(use: (d: ClientData["Service"]) => Effect.Effect<A, E>) =>
  Effect.runPromise(localData(use));

let apis: FakeSyncApi[] = [];
let syncs: Sync[] = [];
afterEach(async () => {
  for (const sync of syncs) sync.dispose();
  await Promise.all(apis.map((api) => api.dispose()));
  apis = [];
  syncs = [];
});

/** A Google account picker that returns `picks` in turn, against one sync server. */
function fakeAccount(server: ReturnType<typeof memorySyncServer>, picks: AccountUser[]) {
  let user: AccountUser | null = null;
  const calls = { signOut: 0 };
  const account: Account = {
    current: async () => user,
    signIn: async () => (user = picks.shift() ?? null),
    signOut: async () => {
      calls.signOut += 1;
      user = null;
    },
    client: async () => {
      const api = await fakeSyncApi({ ...server, user: user?.id ?? null });
      apis.push(api);
      return api.client;
    },
  };
  return { account, calls };
}
const ana = { id: "ana", email: "ana@example.com" };
const bia = { id: "bia", email: "bia@example.com" };

async function show(account: Account) {
  const sync = createSync({ account, data });
  syncs.push(sync);
  await sync.start();
  await render(<AccountPanel sync={sync} locale="pt-BR" />);
  return sync;
}

test("the first sign-in merges this phone's decks into the account", async () => {
  await data((d) => d.changeCollection((c) => void c.createDeck("Palavras")));
  const server = memorySyncServer();
  await show(fakeAccount(server, [ana]).account);

  await fireEvent.press(screen.getByRole("button", { name: "Entrar com o Google" }));

  await screen.findByText(/^Sincronizado às/);
  expect(screen.getByText("Conectado como ana@example.com")).toBeTruthy();
  expect(
    server
      .stored("ana")
      .some((c) => c.kind === "decks" && c.record.fields["name"]?.value === "Palavras"),
  ).toBe(true);
});

test("a different account than last time asks first; cancel signs out and sends nothing", async () => {
  const server = memorySyncServer();
  const { account, calls } = fakeAccount(server, [bia, bia]);
  await show(account);

  await fireEvent.press(screen.getByRole("button", { name: "Entrar com o Google" }));
  await screen.findByText("Esta conta não é a última usada neste celular");
  await fireEvent.press(screen.getByRole("button", { name: "Cancelar" }));

  await screen.findByRole("button", { name: "Entrar com o Google" });
  expect(calls.signOut).toBe(1);
  expect(server.stored("bia")).toEqual([]);

  await fireEvent.press(screen.getByRole("button", { name: "Entrar com o Google" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Juntar a esta conta" }));
  await screen.findByText(/^Sincronizado às/);
  expect(server.stored("bia").some((c) => c.kind === "decks")).toBe(true);
});

test("signing out keeps the phone's data", async () => {
  const { account } = fakeAccount(memorySyncServer(), [bia]);
  await show(account);
  await fireEvent.press(screen.getByRole("button", { name: "Entrar com o Google" }));
  await screen.findByText(/^Sincronizado às/);

  await fireEvent.press(screen.getByRole("button", { name: "Sair" }));

  await screen.findByRole("button", { name: "Entrar com o Google" });
  const state = await data((d) => d.collection);
  expect(state.decks.map((deck) => deck.fields.name.value)).toContain("Palavras");
});

test("a protocol mismatch pauses sync and asks for an update", async () => {
  const { account } = fakeAccount(memorySyncServer({ syncProtocol: 999 }), [bia]);
  await show(account);

  await fireEvent.press(screen.getByRole("button", { name: "Entrar com o Google" }));

  expect(
    await screen.findByText(
      "Atualize o app para voltar a sincronizar. Tudo continua funcionando offline.",
    ),
  ).toBeTruthy();
});
