import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vite-plus/test";

// Testing Library unmounts after each test only when the runner has globals, which ours doesn't.
afterEach(cleanup);

vi.mock("../src/data/client.ts", async () => {
  const { testWebData } = await import("./local-data.ts");
  return { webData: () => testWebData };
});
