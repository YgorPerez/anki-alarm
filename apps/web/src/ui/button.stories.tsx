import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { Button } from "./shadcn/button.tsx";

const meta = {
  title: "Study/Button",
  component: Button,
  args: { children: "Mostrar resposta", onClick: fn() },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ShowAnswer: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Mostrar resposta" }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};
export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button")).toBeDisabled();
  },
};
