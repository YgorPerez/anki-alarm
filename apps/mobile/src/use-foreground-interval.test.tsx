import { act, render } from "@testing-library/react-native/pure";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { changeAppState } from "../test/native/react-native.ts";
import { useForegroundInterval } from "./use-foreground-interval.ts";

function Probe({ enabled, tick }: { enabled: boolean; tick: () => void }) {
  useForegroundInterval(enabled, tick, 1000);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  changeAppState("active");
});
afterEach(() => {
  vi.useRealTimers();
  changeAppState("active");
});

test("ticks at once and then on the interval while foregrounded", async () => {
  const tick = vi.fn<() => void>();
  await render(<Probe enabled tick={tick} />);
  expect(tick).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(2000));
  expect(tick).toHaveBeenCalledTimes(3);
});

test("doesn't tick in the background, and ticks at once on return", async () => {
  const tick = vi.fn<() => void>();
  await render(<Probe enabled tick={tick} />);
  tick.mockClear();
  await act(async () => changeAppState("background"));
  await act(async () => vi.advanceTimersByTime(5000));
  expect(tick).not.toHaveBeenCalled();
  await act(async () => changeAppState("active"));
  expect(tick).toHaveBeenCalledTimes(1);
});

test("doesn't tick when disabled", async () => {
  const tick = vi.fn<() => void>();
  await render(<Probe enabled={false} tick={tick} />);
  await act(async () => vi.advanceTimersByTime(5000));
  expect(tick).not.toHaveBeenCalled();
});
