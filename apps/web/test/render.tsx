import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { routeTree } from "#/routeTree.gen.ts";

/**
 * Renders the app at `path`, with the real routes on a memory history. Into the document: the
 * root route renders `<html>`.
 */
export async function renderRoute(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    // The router's error page would turn a crash into a passing "not found" assertion.
    disableGlobalCatchBoundary: true,
  });
  await router.load();
  const user = userEvent.setup();
  return { router, user, ...render(<RouterProvider router={router} />, { container: document }) };
}
