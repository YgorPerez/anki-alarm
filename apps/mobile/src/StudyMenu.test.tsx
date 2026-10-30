import { fireEvent, render, screen } from "@testing-library/react-native/pure";
import { expect, test, vi } from "vite-plus/test";
import { StudyMenu } from "./StudyMenu.tsx";
import { pressBack } from "../test/native/react-native.ts";

test("an empty study menu stays hidden; supplied actions close before returning to the card", async () => {
  const edit = vi.fn<() => void>();
  const view = await render(<StudyMenu locale="pt-BR" items={[]} />);
  expect(screen.queryByRole("button")).toBeNull();
  await view.rerender(
    <StudyMenu locale="pt-BR" items={[{ id: "edit", label: "Editar nota", onPress: edit }]} />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  await fireEvent.press(screen.getByRole("button", { name: "Editar nota" }));
  expect(edit).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Editar nota" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Ações do cartão" }));
  expect(pressBack()).toBe(true);
});
