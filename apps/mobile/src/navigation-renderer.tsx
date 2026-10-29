import type { ComponentType } from "react";

/** Router render callbacks must return an element so hooks run inside a React component. */
export function navigationRenderer<Props extends object>(Component: ComponentType<Props>) {
  return (props: Props) => <Component {...props} />;
}
