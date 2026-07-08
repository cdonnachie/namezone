"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logout } from "@/lib/client/api";
import { truncateAddress } from "@/lib/utils";

/** Hamburger menu shown below the `md` breakpoint - the inline nav links
 * and auth actions don't fit next to the brand name on phone widths. */
export function MobileNav({ namespace, address }: { namespace: string; address: string | null }) {
  const [loading, setLoading] = useState(false);

  async function handleDisconnect() {
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
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {address && (
          <>
            <DropdownMenuLabel className="font-mono text-xs font-normal text-muted-foreground">
              {truncateAddress(address)}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/${namespace}/dashboard`}>Dashboard</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/${namespace}/settings`}>Settings</Link>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem asChild>
          <Link href={`/${namespace}/lookup`}>Lookup</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/${namespace}/help`}>Help</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {address ? (
          <DropdownMenuItem disabled={loading} onSelect={() => void handleDisconnect()}>
            <LogOut className="size-4" /> Disconnect
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild>
            <Link href={`/${namespace}/connect`}>Connect Wallet</Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
