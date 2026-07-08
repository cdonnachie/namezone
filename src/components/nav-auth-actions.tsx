"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/client/api";
import { truncateAddress } from "@/lib/utils";
import Link from "next/link";

export function NavAuthActions({ namespace, address }: { namespace: string; address: string | null }) {
  const router = useRouter();
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
      router.push(`/${namespace}`);
      router.refresh();
    } catch {
      toast.error("Failed to disconnect");
    } finally {
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
