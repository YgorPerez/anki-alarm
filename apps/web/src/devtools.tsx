// TanStack Devtools, in development only: the root loads this file lazily behind
// `import.meta.env.DEV`, so production bundles leave it out.
import { TanStackDevtools } from "@tanstack/react-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { queryClient } from "./query.ts";

export default function Devtools() {
  return (
    <TanStackDevtools
      plugins={[
        { name: "TanStack Query", render: <ReactQueryDevtoolsPanel client={queryClient} /> },
        { name: "TanStack Router", render: <TanStackRouterDevtoolsPanel /> },
      ]}
    />
  );
}
