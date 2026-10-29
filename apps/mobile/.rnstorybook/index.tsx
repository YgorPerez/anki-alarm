import "../global.css";
import { registerRootComponent } from "expo";
import { view } from "./storybook.requires";
const Storybook = view.getStorybookUI({});
registerRootComponent(Storybook);
export default Storybook;
