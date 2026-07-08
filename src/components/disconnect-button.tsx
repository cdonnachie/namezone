"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/client/api";

export function DisconnectButton({ namespace }: { namespace: string }) {
  const [loading, setLoading] = useState(false);

  return (
    <Button
      variant="destructive"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          await logout(namespace);
          toast.success("Disconnected");
          // Full navigation - see connect-flow.tsx for why not push()+refresh().
          window.location.assign(`/${namespace}`);
        } catch {
          toast.error("Failed to disconnect");
          setLoading(false);
        }
      }}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
      Disconnect
    </Button>
  );
}
