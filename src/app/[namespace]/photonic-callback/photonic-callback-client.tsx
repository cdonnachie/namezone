"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { BadgeCheck, AlertCircle } from "lucide-react";
import {
  PHOTONIC_CALLBACK_CHANNEL,
  parseCallbackHash,
  type PhotonicCallbackPayload,
} from "@/lib/ownership/radiant/photonic-callback";

const noop = () => () => {};

/**
 * Lands here when Photonic redirects back after signing. Reads the result
 * from the URL fragment (kept out of server logs), broadcasts it to the
 * still-open connect/step-up tab, scrubs the fragment from history, and
 * invites the user to close the tab.
 *
 * The fragment is captured once in a lazy initializer (before the effect
 * clears it), and a hydration-safe `hydrated` flag keeps the server/first
 * client paint identical - no set-state-in-effect, no hydration mismatch.
 */
export function PhotonicCallbackClient() {
  const [payload] = useState<PhotonicCallbackPayload | null>(() =>
    typeof window === "undefined" ? null : parseCallbackHash(window.location.hash),
  );

  // false on the server and during the first client paint, true after mount.
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!payload) return;
    const channel = new BroadcastChannel(PHOTONIC_CALLBACK_CHANNEL);
    channel.postMessage(payload);
    channel.close();

    // Scrub the signature from the address bar / history immediately.
    history.replaceState(null, "", window.location.pathname);

    // Best-effort auto-close (works when script-opened, which this was).
    const t = setTimeout(() => window.close(), 800);
    return () => clearTimeout(t);
  }, [payload]);

  const shell = (icon: React.ReactNode, title: string, body: string) => (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center">
      {icon}
      <h1 className="mt-4 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );

  if (!hydrated) {
    return shell(
      <BadgeCheck className="size-12 text-muted-foreground" />,
      "Finishing up…",
      "One moment.",
    );
  }

  return payload
    ? shell(
        <BadgeCheck className="size-12 text-primary" />,
        "Signature received",
        "You can close this tab - everything finishes in the window you started from.",
      )
    : shell(
        <AlertCircle className="size-12 text-destructive" />,
        "Nothing to return",
        "This page expects a signed response from Photonic. Head back to the tab you started from and try again.",
      );
}
