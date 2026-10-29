import { renderCard, type RenderInput } from "@app/core";
import { cn } from "cn";
import { useSyncExternalStore } from "react";

/** Where card media load from: the service worker serves OPFS `media/<name>` there. */
const mediaUrl = (name: string) => `/media/${encodeURIComponent(name)}`;

const darkQuery = "(prefers-color-scheme: dark)";
const subscribeDark = (listener: () => void) => {
  const media = window.matchMedia?.(darkQuery);
  media?.addEventListener("change", listener);
  return () => media?.removeEventListener("change", listener);
};
const useDark = () =>
  useSyncExternalStore(
    subscribeDark,
    () => window.matchMedia?.(darkQuery).matches ?? false,
    () => false,
  );

/** One side of a card, rendered by Core, in a frame where the deck's HTML can't run scripts. */
export function CardFrame({
  title,
  className,
  ...input
}: Omit<RenderInput, "dark" | "media"> & { title: string; className?: string }) {
  const dark = useDark();
  const html = renderCard({ ...input, dark, media: mediaUrl });
  return (
    <iframe
      key={`${dark}`}
      title={title}
      // Same origin for card media; no scripts, so a shared deck's HTML can't run code.
      sandbox="allow-same-origin"
      srcDoc={html}
      className={cn("w-full rounded-lg border-0 bg-background", className)}
    />
  );
}
