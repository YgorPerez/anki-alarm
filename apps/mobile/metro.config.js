const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);

// uniwind reads the Tailwind classes, and the design tokens global.css imports, from here.
const themed = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
});

const { withStorybook } = require("@storybook/react-native/withStorybook");
module.exports = withStorybook(themed, {
  enabled: process.env.STORYBOOK_ENABLED === "true",
  configPath: ".rnstorybook",
});
