import type { ClientData } from "@app/client-data";
import { fakeSyncApi, memorySyncServer, type FakeSyncApi } from "@app/contracts/testing";
import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { Effect } from "effect";
import { afterEach, expect, test } from "vite-plus/test";

import { File, Paths } from "../test/native/expo-file-system.ts";
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
    current: Effect.sync(() => user),
    signIn: Effect.sync(() => (user = picks.shift() ?? null)),
    signOut: Effect.sync(() => {
      calls.signOut += 1;
      user = null;
    }),
    client: Effect.promise(async () => {
      const api = await fakeSyncApi({ ...server, user: user?.id ?? null });
      apis.push(api);
      return api.client;
    }),
  };
  return { account, calls };
}
const ana = { id: "ana", email: "ana@example.com" };
const bia = { id: "bia", email: "bia@example.com" };

async function show(account: Account) {
  const sync = createSync({ account, data: localData });
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

// The phone last synced bia.
const PICTURE = new TextEncoder().encode("a picture");
const PICTURE_SHA = "92b2fa58028958317e408bd84ecfa70f5ee35b121991dbc232c49d166353708b";
const mediaDeck = async () =>
  (await data((d) => d.changeCollection((c) => void c.createDeck("Mídia")))).decks.find(
    (deck) => deck.fields.name.value === "Mídia",
  )!.id;
const storedNote = (server: ReturnType<typeof memorySyncServer>, user: string, name: string) =>
  server
    .stored(user)
    .some((c) => c.kind === "notes" && String(c.record.values?.[0]?.value).includes(name));

test("media stored on the phone uploads with the notes that use it", async () => {
  await data((d) => d.storeMedia([{ name: "casa.jpg", bytes: async () => PICTURE }]));
  const deck = await mediaDeck();
  await data((d) =>
    d.changeCollection((c) => void c.addBasicNote(deck, '<img src="casa.jpg">', "casa")),
  );
  const server = memorySyncServer();
  await show(fakeAccount(server, [bia]).account);

  await fireEvent.press(screen.getByRole("button", { name: "Entrar com o Google" }));
  await screen.findByText(/^Sincronizado às/);

  expect(server.files()).toEqual([PICTURE_SHA]);
  expect(storedNote(server, "bia", "casa.jpg")).toBe(true);
});

test("a file that doesn't upload holds back its note, and the panel says so", async () => {
  await data((d) => d.storeMedia([{ name: "gato.jpg", bytes: async () => PICTURE.slice(1) }]));
  const deck = await mediaDeck();
  await data((d) =>
    d.changeCollection((c) => void c.addBasicNote(deck, '<img src="gato.jpg">', "gato")),
  );
  const server = memorySyncServer();
  const failing = { ...server, upload: () => Effect.die(new Error("offline")) };
  await show(fakeAccount(failing, [bia]).account);

  await fireEvent.press(screen.getByRole("button", { name: "Entrar com o Google" }));

  expect(
    await screen.findByText(
      "Algumas imagens ou áudios não foram enviados. As notas que os usam sincronizam depois.",
    ),
  ).toBeTruthy();
  expect(storedNote(server, "bia", "gato.jpg")).toBe(false);
});

test("the phone downloads every file its decks use into its media folder", async () => {
  const server = memorySyncServer();
  const web = await fakeSyncApi({ ...server, user: "caio" });
  apis.push(web);
  const hlc = { wallMs: 1, counter: 0, deviceId: "web" };
  await web.run(web.client.media.upload({ params: { sha256: PICTURE_SHA }, payload: PICTURE }));
  await web.run(
    web.client.changes.push({
      payload: {
        changes: [
          {
            kind: "media",
            record: {
              id: "media-sol",
              fields: {
                name: { value: "sol.jpg", hlc },
                sha256: { value: PICTURE_SHA, hlc },
                size: { value: PICTURE.length, hlc },
              },
            },
          },
          {
            kind: "notes",
            record: {
              id: "note-sol",
              fields: { noteTypeId: { value: "basic", hlc }, tags: { value: [], hlc } },
              values: [
                { value: '<img src="sol.jpg">', hlc },
                { value: "sun", hlc },
              ],
            },
          },
        ],
      },
    }),
  );
  await show(fakeAccount(server, [{ id: "caio", email: "caio@example.com" }]).account);
  await fireEvent.press(screen.getByRole("button", { name: "Entrar com o Google" }));
  // This phone last synced another account: merge into this one.
  await fireEvent.press(await screen.findByRole("button", { name: "Juntar a esta conta" }));
  await screen.findByText(/^Sincronizado às/);

  const file = new File(Paths.document, "media", "sol.jpg");
  expect(file.exists).toBe(true);
  expect(await file.bytes()).toEqual(PICTURE);
  expect(await data((d) => d.missingMedia)).toEqual([]);
});
