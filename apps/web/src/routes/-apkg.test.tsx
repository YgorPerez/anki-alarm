import { readFileSync } from "node:fs";
import { join } from "node:path";

import { screen, within } from "@testing-library/react";
import { strFromU8, unzipSync } from "fflate";
import { expect, test } from "vite-plus/test";

import { webData } from "#/data/client.ts";

import { downloads } from "../../test/downloads.ts";
import { webMedia } from "../../test/local-data.ts";
import { renderRoute } from "../../test/render.tsx";

// From the test file: the root run and the web project run start in different folders.
const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "../../../../packages/core/fixtures/apkg", name));

test("an Anki package imports with its media, and a deck exports back with them", async () => {
  const { user } = await renderRoute("/");
  const file = new File([fixture("latest.apkg")], "latest.apkg");
  await user.upload(await screen.findByLabelText("Importar .apkg"), file);
  expect(
    await screen.findByText(/^Importado: \d+ notas, \d+ cartões e \d+ revisões\.$/),
  ).toBeDefined();
  // Media went to the browser's storage, where cards load them from.
  expect([...webMedia.files.keys()]).toEqual(expect.arrayContaining(["gato.png"]));
  const decks = await screen.findByRole("list", { name: "Baralhos" });
  await user.click(await within(decks).findByRole("link", { name: "Editar Português::Verbos" }));

  await user.click(await screen.findByRole("button", { name: "Exportar .apkg" }));
  expect(await screen.findByText("Baixado como Português - Verbos.apkg.")).toBeDefined();
  const [download] = downloads;
  const zip = unzipSync(download!.bytes);
  expect(Object.keys(zip)).toContain("collection.anki21");
  const media: Record<string, string> = JSON.parse(strFromU8(zip["media"]!));
  expect(Object.values(media).length).toBeGreaterThan(0);

  // The export reads back into the same records, with no new reviews.
  const before = await webData().request("reviewLog");
  const summary = await webData().request("importApkg", download!.bytes);
  expect(summary.entries).toBe(0);
  expect(await webData().request("reviewLog")).toHaveLength(before.length);
});

test("a file that isn't a package says so and changes nothing", async () => {
  const { user } = await renderRoute("/");
  const before = await webData().request("collection");
  await user.upload(
    await screen.findByLabelText("Importar .apkg"),
    new File(["not a zip"], "notes.apkg"),
  );
  expect(
    await screen.findByText(
      "Não foi possível importar este arquivo. Confira se é um .apkg do Anki.",
    ),
  ).toBeDefined();
  expect(await webData().request("collection")).toEqual(before);
});
