"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/client/api";

export function DisconnectButton({ namespace }: { namespace: string }) {
  const router = useRouter();
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
          router.push(`/${namespace}`);
          router.refresh();
        } catch {
          toast.error("Failed to disconnect");
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
      Disconnect
    </Button>
  );
}
