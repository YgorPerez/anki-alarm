import { screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vite-plus/test";

import { webData } from "#/data/client.ts";

import { renderRoute } from "../../test/render.tsx";

const data = () => webData();
const noteValues = async () =>
  (await data().request("collection")).notes.map((n) => n.values.map((v) => v.value));

test("a new deck gets options and a note, which the browser finds and edits as you type", async () => {
  const { user } = await renderRoute("/");
  await user.click(await screen.findByRole("link", { name: "Novo baralho" }));
  await user.type(await screen.findByLabelText("Nome do baralho"), "Inglês");
  await user.click(screen.getByRole("button", { name: "Criar baralho" }));
  expect(await screen.findByRole("heading", { name: "Inglês" })).toBeDefined();

  // Deck options: Core's rules check what is typed, then the preset saves.
  const newPerDay = screen.getByLabelText("Cartões novos por dia");
  await user.clear(newPerDay);
  await user.type(newPerDay, "1.5");
  expect(await screen.findByText("Use um número inteiro de 0 a 9999.")).toBeDefined();
  expect(screen.getByRole("button", { name: "Salvar" })).toHaveProperty("disabled", true);
  await user.clear(newPerDay);
  await user.type(newPerDay, "5");
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  expect(await screen.findByText("Salvo.")).toBeDefined();
  const [preset] = (await data().request("collection")).presets;
  expect(preset!.fields.newPerDay.value).toBe(5);

  await user.click(screen.getByRole("button", { name: "Adicionar nota" }));
  await user.type(await screen.findByLabelText("Frente"), "cat");
  await user.type(screen.getByLabelText("Verso"), "gato");
  await user.click(screen.getByRole("button", { name: "Adicionar" }));
  expect(await screen.findByText("Nota adicionada.")).toBeDefined();
  expect(await noteValues()).toEqual([["cat", "gato"]]);
  const deckId = (await data().request("collection")).decks[0]!.id;
  await data().request("change", {
    kind: "addNote",
    deckId,
    noteTypeId: "",
    values: ["bird", "pássaro"],
  });

  // The browser lists cards by their front, and the search waits for typing to pause.
  const cards = screen.getByRole("list", { name: "Cartões" });
  expect(await within(cards).findByRole("button", { name: /bird/ })).toBeDefined();
  await user.type(screen.getByRole("searchbox", { name: "Buscar" }), "GATO");
  await waitFor(() => expect(within(cards).queryByRole("button", { name: /bird/ })).toBeNull());
  expect(screen.getByText("1 cartões")).toBeDefined();
  await user.click(within(cards).getByRole("button", { name: /cat/ }));
  const back = await screen.findByLabelText("Verso");
  expect(back).toHaveProperty("value", "gato");
  await user.clear(back);
  await user.type(back, "gata");
  // Autosave: no button, a save once typing pauses.
  await waitFor(async () => expect(await noteValues()).toContainEqual(["cat", "gata"]), {
    timeout: 3000,
  });
  expect(await screen.findByText("Salvo.")).toBeDefined();
  const pending = await data().request("pendingChanges");
  expect(pending.filter((p) => p.kind === "notes")).not.toHaveLength(0);

  // Card actions append to the review log, once the card has a review.
  const card = screen.getByRole("group", { name: "Card 1" });
  expect(within(card).getByRole("button", { name: "Esquecer" })).toHaveProperty("disabled", true);
  const state = await data().request("collection");
  const cat = state.notes.find((n) => n.values[0]!.value === "cat")!;
  const cardId = state.cards.find((c) => c.fields.noteId.value === cat.id)!.id;
  await data().request("answerCard", cardId, 3, 2000);
  await user.click(await within(card).findByRole("button", { name: "Definir vencimento" }));
  await user.click(within(card).getByRole("button", { name: "Esquecer" }));
  await user.click(within(card).getByRole("button", { name: "Esquecer" }));
  await waitFor(async () =>
    expect((await data().request("reviewLog")).map((e) => e.kind)).toEqual([
      "review",
      "setDueDate",
      "reset",
    ]),
  );

  await user.click(screen.getByRole("button", { name: "Excluir nota" }));
  await user.click(screen.getByRole("button", { name: "Excluir" }));
  expect(await screen.findByText("Escolha um cartão para editar a nota.")).toBeDefined();
  expect(await noteValues()).toEqual([["bird", "pássaro"]]);
}, 30_000);
