import { screen } from "@testing-library/react";
import { expect, test } from "vite-plus/test";

import { webData } from "#/data/client.ts";

import { renderRoute } from "../../test/render.tsx";

const data = () => webData();

test("a note type's fields, templates and CSS change with a preview, asking before data goes", async () => {
  const deckId = await data().request("change", { kind: "createDeck", name: "Animais" });
  await data().request("change", {
    kind: "addNote",
    deckId: deckId!,
    noteTypeId: "",
    values: ["dog", "cão"],
  });
  const { user } = await renderRoute("/note-types");
  const front = await screen.findByLabelText("Nome do campo 1");
  expect(front).toHaveProperty("value", "Front");
  await user.clear(front);
  await user.type(front, "Palavra");
  // The preview renders the type as saving would leave it: the template follows the rename.
  expect(screen.getByTitle("Prévia da frente").getAttribute("srcdoc")).toContain("dog");

  await user.click(screen.getByRole("button", { name: "Adicionar modelo" }));
  const template = screen.getByLabelText("Modelo da frente");
  await user.clear(template);
  await user.type(template, "{{{{Back}}");
  await user.type(screen.getByLabelText("Estilo (CSS)"), ".card {{ color: red }");
  const preview = screen.getByTitle("Prévia da frente").getAttribute("srcdoc");
  expect(preview).toContain("cão");
  expect(preview).toContain(".card { color: red }");
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  expect(await screen.findByText("Salvo.")).toBeDefined();
  let state = await data().request("collection");
  const type = state.noteTypes[0]!;
  expect(type.fields.fieldNames.value).toEqual(["Palavra", "Back"]);
  expect(type.fields.templates.value.map((t) => t.front)).toEqual(["{{Palavra}}", "{{Back}}"]);
  expect(type.fields.css.value).toBe(".card { color: red }");
  expect(state.cards).toHaveLength(2);

  // Removing a field with values asks first.
  await user.click(await screen.findByRole("button", { name: "Remover Back" }));
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  expect(
    await screen.findByText(
      "Ao salvar: 1 valores preenchidos serão apagados, 0 cartões excluídos e 0 cartões criados.",
    ),
  ).toBeDefined();
  await user.click(screen.getByRole("button", { name: "Salvar mesmo assim" }));
  expect(await screen.findByText("Salvo.")).toBeDefined();
  state = await data().request("collection");
  expect(state.notes[0]!.values.map((v) => v.value)).toEqual(["dog"]);

  // A name Anki can't use blocks the save.
  const name = await screen.findByLabelText("Nome do campo 1");
  await user.clear(name);
  await user.type(name, "a:b");
  expect(
    screen.getByText('Nomes de campo não podem estar vazios, ter : " {{ }} nem começar com # / ^.'),
  ).toBeDefined();
  expect(screen.getByRole("button", { name: "Salvar" })).toHaveProperty("disabled", true);
}, 30_000);
