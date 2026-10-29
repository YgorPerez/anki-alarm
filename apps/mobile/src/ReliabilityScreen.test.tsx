import { fireEvent, render, screen, waitFor } from "@testing-library/react-native/pure";
import { expect, test } from "vite-plus/test";
import type { AlarmPermissions, ReliabilityKind } from "@app/core";
import { Effect } from "effect";
import { useState } from "react";
import { alerts, answerAlert } from "../test/native/react-native.ts";
import { AlarmService, memoryAlarmService } from "./alarms.ts";
import { ReliabilityScreen } from "./ReliabilityScreen.tsx";

const stock: Partial<AlarmPermissions> = {
  manufacturer: "Google",
  sdk: 34,
  installSource: "store",
  notifications: "denied",
  overlay: "granted",
  fullScreenIntent: "granted",
  exactAlarm: "granted",
  battery: "denied",
  backgroundRestricted: "granted",
};

/** Onboarding as App mounts it: permissions re-read from the phone whenever the screen asks. */
async function setup(permissions: Partial<AlarmPermissions> = stock) {
  const phone = memoryAlarmService();
  phone.permissions(permissions);
  const read = () =>
    Effect.runSync(
      Effect.flatMap(AlarmService, (service) => service.getPermissions).pipe(
        Effect.provide(phone.layer),
      ),
    );
  const exits: number[] = [];
  function Harness() {
    const [current, setCurrent] = useState(read);
    const [confirmed, setConfirmed] = useState<ReadonlySet<ReliabilityKind>>(new Set());
    return (
      <ReliabilityScreen
        permissions={current}
        onboarding
        locale="pt-BR"
        layer={phone.layer}
        confirmed={confirmed}
        onConfirm={(kind, done) =>
          setConfirmed((previous) => {
            const next = new Set(previous);
            if (done) next.add(kind);
            else next.delete(kind);
            return next;
          })
        }
        refresh={() => setCurrent(read())}
        onExit={() => exits.push(1)}
        switchLanguage={() => {}}
      />
    );
  }
  await render(<Harness />);
  return { phone, exits };
}

test("finishes only once the four essentials are granted", async () => {
  const { phone, exits } = await setup();
  const finish = await screen.findByRole("button", { name: "Concluir" });
  expect(finish.props.accessibilityState).toMatchObject({ disabled: true });
  phone.permissions({ notifications: "granted" });
  await fireEvent.press(screen.getByRole("button", { name: /Notificações/ }));
  await fireEvent.press(await screen.findByRole("button", { name: "Concluir" }));
  expect(exits).toEqual([1]);
});

test("skipping asks first, then leaves with the essentials still missing", async () => {
  const { exits } = await setup();
  await fireEvent.press(await screen.findByRole("button", { name: "Pular por agora" }));
  expect(alerts.at(-1)?.message).toMatch(/Seus alarmes podem não tocar/);
  expect(exits).toEqual([]);
  answerAlert("Pular por agora");
  await waitFor(() => expect(exits).toEqual([1]));
});

test("a granted setting is a check, with nothing to tap", async () => {
  await setup();
  expect(await screen.findAllByText("✓ Permitido")).toHaveLength(4);
  expect(screen.queryByRole("button", { name: /Alarmes exatos/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Notificações/ })).toBeDefined();
});

test("explains restricted settings only after the overlay setting came back denied", async () => {
  await setup({ ...stock, overlay: "denied", sdk: 35, installSource: "local" });
  expect(screen.queryByText(/Permitir configurações restritas/)).toBeNull();
  await fireEvent.press(await screen.findByRole("button", { name: /Exibir sobre outros apps/ }));
  expect(await screen.findByText(/Permitir configurações restritas/)).toBeDefined();
});

test("a setting the app can't read is marked done by hand, and that counts", async () => {
  await setup({ ...stock, notifications: "granted", manufacturer: "Samsung", overlay: "unknown" });
  const finish = await screen.findByRole("button", { name: "Concluir" });
  expect(finish.props.accessibilityState).toMatchObject({ disabled: true });
  const boxes = screen.getAllByRole("checkbox", { name: "Já fiz" });
  expect(boxes).toHaveLength(2);
  await fireEvent.press(boxes[0]!);
  expect(
    (await screen.findAllByRole("checkbox", { name: "Já fiz" }))[0]!.props.accessibilityState,
  ).toMatchObject({ checked: true });
  expect(screen.getByRole("button", { name: "Concluir" }).props.accessibilityState).toMatchObject({
    disabled: false,
  });
});
