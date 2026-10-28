import { cleanup } from "@testing-library/react";
import { afterEach } from "vite-plus/test";

// Testing Library unmounts after each test only when the runner has globals, which ours doesn't.
afterEach(cleanup);
