// What the screens import from React Native, as host components a test renderer can hold. React
// Native ships Flow source and a Jest preset only, so the phone's Vitest swaps it for this, as the
// Jest preset swaps its native views for mocks. The host names are the ones React Native Testing
// Library looks for. Add an export when a screen under test imports something new.
import { createElement, useEffect, type ReactNode } from "react";

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
export const Image = host("Image");
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

type AlertButton = { text?: string; style?: string; onPress?: () => void };
/** Dialogs a screen opened, newest last. A test answers one by pressing its button. */
export const alerts: { title: string; message?: string; buttons: AlertButton[] }[] = [];
export const Alert = {
  alert: (title: string, message?: string, buttons: AlertButton[] = []) => {
    alerts.push({ title, message, buttons });
  },
};
/** Presses a button of the newest dialog, as the user would. */
export function answerAlert(text: string) {
  const button = alerts.at(-1)?.buttons.find((b) => b.text === text);
  if (!button) throw new Error(`No dialog button "${text}"`);
  button.onPress?.();
}
const backListeners: (() => boolean | null | undefined)[] = [];
export const pressBack = () => backListeners.toReversed().some((listener) => listener() === true);
export const BackHandler = {
  addEventListener: (_event: string, listener: () => boolean | null | undefined) => {
    backListeners.push(listener);
    return {
      remove: () => {
        const index = backListeners.indexOf(listener);
        if (index >= 0) backListeners.splice(index, 1);
      },
    };
  },
};
/**
 * A Modal shows its children while visible. Android Back asks it to close, before the screen
 * under it hears Back, as it does on the phone.
 */
export function Modal({
  visible = true,
  onRequestClose,
  children,
  ...props
}: Props & { visible?: boolean; onRequestClose?: () => void }) {
  useEffect(() => {
    if (!visible) return undefined;
    return BackHandler.addEventListener("hardwareBackPress", () => {
      onRequestClose?.();
      return true;
    }).remove;
  }, [visible, onRequestClose]);
  return visible ? createElement("Modal", props, children) : null;
}

/** Toasts a screen showed, newest last. */
export const toasts: string[] = [];
export const ToastAndroid = {
  SHORT: 0,
  LONG: 1,
  show: (message: string) => {
    toasts.push(message);
  },
};

// The app stays in the foreground during a test.
export const AppState = {
  currentState: "active",
  addEventListener: () => ({ remove: () => {} }),
};

export const useColorScheme = () => "light";

/** What the phone reports; a test may change `fontScale`, and puts it back. */
export const windowDimensions = { width: 400, height: 800, scale: 2, fontScale: 1 };
export const useWindowDimensions = () => windowDimensions;

/** Virtualized list host: renders supplied rows and slots without native scrolling. */
export function FlatList<T>({
  data,
  renderItem,
  ListHeaderComponent,
  ListFooterComponent,
}: {
  data: readonly T[];
  renderItem: (info: { item: T; index: number }) => ReactNode;
  ListHeaderComponent?: ReactNode;
  ListFooterComponent?: ReactNode;
}) {
  return createElement(
    "RCTScrollView",
    {},
    ListHeaderComponent,
    ...data.map((item, index) => renderItem({ item, index })),
    ListFooterComponent,
  );
}

/** Gesture responder events exposed by React Native's PanResponder. */
export const PanResponder = {
  create: (config: Record<string, unknown>) => ({
    panHandlers: {
      onMoveShouldSetResponder: config.onMoveShouldSetPanResponder,
      onResponderRelease: config.onPanResponderRelease,
    },
  }),
};
