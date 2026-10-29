import { CardState } from "@app/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { CardActions } from "./card-actions.tsx";
import { CardBrowser } from "./card-browser.tsx";
import { editorFixture } from "./editor-fixtures.ts";

const { rows } = editorFixture();
const meta = {
  title: "Editing/Card browser",
  component: CardBrowser,
  args: {
    rows,
    query: "",
    selected: rows[0]!.noteId,
    locale: "pt-BR",
    onQuery: fn(),
    onSelect: fn(),
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof CardBrowser>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SearchWaitsForTyping: Story = {
  args: { onQuery: fn(), onSelect: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("4 cartões")).toBeVisible();
    await userEvent.type(canvas.getByRole("searchbox", { name: "Buscar" }), "deck:inglês::verbos");
    await expect(args.onQuery).not.toHaveBeenCalled();
    await waitFor(() => expect(args.onQuery).toHaveBeenCalledWith("deck:inglês::verbos"));
    await expect(args.onQuery).toHaveBeenCalledOnce();
    const cards = canvas.getByRole("list", { name: "Cartões" });
    await userEvent.click(within(cards).getAllByRole("button", { name: /to run/ })[0]!);
    await expect(args.onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ question: "to run", deck: "Inglês::Verbos" }),
    );
  },
};

export const NothingFound: Story = {
  args: { rows: [], query: "zebra" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Nenhum cartão encontrado.")).toBeVisible();
  },
};

/** Forget asks first; Set due date waits for a first review. */
export const CardActionsForAReviewedCard: StoryObj<typeof CardActions> = {
  render: (args) => <CardActions {...args} />,
  args: {
    cards: [
      { id: "a", name: "Card 1", memory: undefined },
      {
        id: "b",
        name: "Reverse",
        memory: {
          state: CardState.Review,
          due: new Date(1_800_000_000_000),
          stability: 3,
          difficulty: 5,
          elapsed_days: 0,
          scheduled_days: 3,
          learning_steps: 0,
          reps: 1,
          lapses: 0,
          last_review: new Date(1_799_740_800_000),
        },
      },
    ],
    locale: "pt-BR",
    busy: false,
    onForget: fn(),
    onSetDueDate: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const card = canvas.getByRole("group", { name: "Card 1" });
    await expect(within(card).getByText(/primeira revisão/)).toBeVisible();
    await expect(within(card).getByRole("button", { name: "Esquecer" })).toBeDisabled();
    const reverse = canvas.getByRole("group", { name: "Reverse" });
    await userEvent.click(within(reverse).getByRole("button", { name: "Esquecer" }));
    await userEvent.click(within(reverse).getByRole("button", { name: "Cancelar" }));
    await expect(args.onForget).not.toHaveBeenCalled();
    const days = within(reverse).getByLabelText("Vence daqui a quantos dias (0 = hoje)");
    await userEvent.clear(days);
    await userEvent.type(days, "7");
    await userEvent.click(within(reverse).getByRole("button", { name: "Definir vencimento" }));
    await expect(args.onSetDueDate).toHaveBeenCalledWith("b", 7);
  },
};

/** A linked deck's card: the editor says Forget and Set due date stay in the app (ADR 0003). */
export const CardActionsOnALinkedDeck: StoryObj<typeof CardActions> = {
  render: (args) => <CardActions {...args} />,
  args: { ...CardActionsForAReviewedCard.args, linked: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/Esquecer e Definir vencimento ficam só no app/),
    ).toBeVisible();
  },
};
