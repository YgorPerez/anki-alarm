import { createContext } from "react";

/** Keeps local screen state mounted while suspending Back handlers outside the focused route. */
export const ScreenActivity = createContext(true);
