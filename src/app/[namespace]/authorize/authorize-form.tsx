"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Approve/decline for a companion app's sign-in handoff. Approving asks the
 * server for a short-lived token and follows the URL it returns; the token is
 * never constructed here, so nothing in the browser can widen what is granted.
 */
export function AuthorizeForm({
  namespace,
  appName,
  redirectUri,
}: {
  namespace: string;
  appName: string;
  redirectUri: string;
}) {
  const [loading, setLoading] = useState(false);

  async function approve() {
    setLoading(true);
    try {
      const res = await fetch(`/api/${namespace}/auth/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirectUri }),
      });
      const data = (await res.json()) as { redirectTo?: string; error?: string };
      if (!res.ok || !data.redirectTo) {
        toast.error(data.error ?? "Could not complete sign-in.");
        setLoading(false);
        return;
      }
      // Full navigation - see connect-flow.tsx for why not push()+refresh().
      window.location.assign(data.redirectTo);
    } catch {
      toast.error("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button className="flex-1" disabled={loading} onClick={approve}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        Continue to {appName}
      </Button>
      <Button
        variant="outline"
        className="flex-1"
        disabled={loading}
        onClick={() => window.history.back()}
      >
        Cancel
      </Button>
    </div>
  );
}
