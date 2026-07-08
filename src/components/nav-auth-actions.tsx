"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/client/api";
import { truncateAddress } from "@/lib/utils";
import Link from "next/link";

export function NavAuthActions({ namespace, address }: { namespace: string; address: string | null }) {
  const [loading, setLoading] = useState(false);

  if (!address) {
    return (
      <Button asChild size="sm">
        <Link href={`/${namespace}/connect`}>Connect Wallet</Link>
      </Button>
    );
  }

  async function handleDisconnect() {
    setLoading(true);
    try {
      await logout(namespace);
      toast.success("Disconnected");
      // Full navigation instead of router.push() + router.refresh(): the
      // refresh can cancel the in-flight push on slow connections (see
      // connect-flow.tsx), and a hard load guarantees every server
      // component re-renders logged-out.
      window.location.assign(`/${namespace}`);
    } catch {
      toast.error("Failed to disconnect");
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:inline-block rounded-md bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
        {truncateAddress(address)}
      </span>
      <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={loading}>
        Disconnect
      </Button>
    </div>
  );
}
