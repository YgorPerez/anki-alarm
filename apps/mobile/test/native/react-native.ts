// What the screens import from React Native, as host components a test renderer can hold. React
// Native ships Flow source and a Jest preset only, so the phone's Vitest swaps it for this, as the
// Jest preset swaps its native views for mocks. The host names are the ones React Native Testing
// Library looks for. Add an export when a screen under test imports something new.
import { createElement, type ReactNode } from "react";

type Props = Record<string, unknown> & {
  children?: ReactNode;
  accessibilityState?: Record<string, unknown>;
};

const host = (name: string) =>
  function Host(props: Props) {
    return createElement(name, props);
  };

export const View = host("View");
export const Text = host("Text");
export const TextInput = host("TextInput");
export const ScrollView = host("RCTScrollView");
export const Switch = host("RCTSwitch");
export const KeyboardAvoidingView = View;

/** A View that answers presses, as React Native's Pressable renders one. */
export function Pressable({ children, disabled, ...props }: Props) {
  return createElement(
    "View",
    {
      ...props,
      accessible: true,
      disabled,
      accessibilityState: {
        ...props.accessibilityState,
        disabled: Boolean(disabled),
      },
    },
    typeof children === "function" ? (children as (state: object) => ReactNode)({}) : children,
  );
}

export const StyleSheet = {
  flatten: (style: unknown): Record<string, unknown> =>
    Array.isArray(style)
      ? Object.assign({}, ...style.map((item) => StyleSheet.flatten(item)))
      : typeof style === "object" && style !== null
        ? Object.fromEntries(Object.entries(style))
        : {},
};

export const Platform = {
  OS: "android",
  select: (choices: { android?: unknown }) => choices.android,
};

// No dialogs or Back button in the tests yet: a test that needs one adds a way to answer it here.
export const Alert = { alert: () => {} };
export const BackHandler = {
  addEventListener: () => ({ remove: () => {} }),
};

export const useColorScheme = () => "light";
