import { usePathname } from "expo-router";
import * as Updates from "expo-updates";

import { appUpdate } from "./app-update-store.ts";
import { UpdateCard, UpdateOfferButton } from "./UpdateOffer.tsx";
import { showsUpdateCard, updateOffer } from "./update-store.ts";
import { useUI } from "./ui.ts";

function useOffer() {
  const state = appUpdate();
  const offer = updateOffer(state, Updates.useUpdates().isUpdatePending);
  return {
    offer,
    dismissed: state.dismissed,
    onAccept: offer?.kind === "ota" ? state.acceptOta : state.acceptApk,
    onDismiss: state.dismiss,
  };
}

/** Stays until the update is installed: the card is the part that can be dismissed. */
export function SettingsUpdateOffer() {
  const locale = useUI((ui) => ui.locale);
  const { offer, onAccept } = useOffer();
  return offer ? <UpdateOfferButton offer={offer} locale={locale} onAccept={onAccept} /> : null;
}

/** Alarms, awake checks and onboarding replace the navigator, so they never reach this. */
export function GlobalUpdateCard({ bottom = 0 }: { bottom?: number }) {
  const locale = useUI((ui) => ui.locale);
  const pathname = usePathname();
  const { offer, dismissed, onAccept, onDismiss } = useOffer();
  if (!offer || dismissed || !showsUpdateCard(pathname)) return null;
  return (
    <UpdateCard
      offer={offer}
      locale={locale}
      bottom={bottom}
      onAccept={onAccept}
      onDismiss={onDismiss}
    />
  );
}
