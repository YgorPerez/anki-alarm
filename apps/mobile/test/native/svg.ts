// react-native-svg's elements as host components, so a screen test renders TanStack Charts' real
// scene and can count its bars.
import { createElement, type ReactNode } from "react";

type Props = Record<string, unknown> & { children?: ReactNode };
const host = (name: string) =>
  function Host(props: Props) {
    return createElement(name, props);
  };

export const Svg = host("Svg");
export const G = host("G");
export const Rect = host("Rect");
export const Path = host("Path");
export const Line = host("Line");
export const Circle = host("Circle");
// The test renderer only takes strings inside a host named Text.
export const Text = host("Text");
export const ClipPath = host("ClipPath");
export const Defs = host("Defs");
export const LinearGradient = host("LinearGradient");
export const RadialGradient = host("RadialGradient");
export const Stop = host("Stop");
export default Svg;
