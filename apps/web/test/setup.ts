import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vite-plus/test";

// jsdom has its own ArrayBuffer, and Node's Buffer makes Node's. Effect's in-memory sync API
// encodes bodies with Buffer and checks them with `instanceof globalThis.ArrayBuffer`: let jsdom's
// ArrayBuffer recognize Node's too.
const NodeArrayBuffer = Buffer.from("").buffer.constructor;
if (NodeArrayBuffer !== ArrayBuffer) {
  const own = Function.prototype[Symbol.hasInstance].bind(ArrayBuffer);
  Object.defineProperty(ArrayBuffer, Symbol.hasInstance, {
    value: (value: unknown) => own(value) || value instanceof NodeArrayBuffer,
  });
}

// Testing Library unmounts after each test only when the runner has globals, which ours doesn't.
afterEach(cleanup);

vi.mock("../src/data/client.ts", async () => {
  const { testWebData } = await import("./local-data.ts");
  return { webData: () => testWebData };
});
vi.mock("../src/auth.ts", async () => {
  const { fakeAccount } = await import("./account.ts");
  return { webAccount: fakeAccount };
});
