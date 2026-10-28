import babel from "@rolldown/plugin-babel";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";

/** React with React Compiler, through Babel as on the phone. The app, its tests and Storybook. */
export const react = () => [viteReact(), babel({ presets: [reactCompilerPreset()] })];
