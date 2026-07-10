"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Globe, LayoutGrid, List, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatRelativeTime } from "@/lib/utils";

export interface NameSummaryDto {
  name: string;
  zone: string;
  recordCount: number;
  /** ISO string (Dates aren't serializable across the server boundary). */
  lastUpdated: string;
  transferJustDetected: boolean;
}

const VIEW_STORAGE_KEY = "namezone_names_view";

/** Show the search/view controls only once a wallet has enough names to need them. */
const CONTROLS_THRESHOLD = 6;

/**
 * Client-side browser for the dashboard's name list: filter-as-you-type
 * search plus a card/list view toggle (remembered per browser). Wallets can
 * hold hundreds of Wave names, where a plain card grid stops working.
 */
export function NamesBrowser({ namespace, names }: { namespace: string; names: NameSummaryDto[] }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"cards" | "list">(() => {
    if (typeof window === "undefined") return "cards";
    return localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "cards";
  });

  function changeView(next: "cards" | "list") {
    setView(next);
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  }

  const sorted = [...names].sort((a, b) => a.name.localeCompare(b.name));
  const q = query.trim().toLowerCase();
  const filtered = q ? sorted.filter((n) => n.name.toLowerCase().includes(q)) : sorted;
  const showControls = names.length >= CONTROLS_THRESHOLD;

  return (
    <div className="space-y-4">
      {showControls && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${names.length} names…`}
              className="pl-8"
              aria-label="Search your names"
            />
          </div>
          <div className="flex gap-1">
            <Button
              variant={view === "cards" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => changeView("cards")}
              aria-label="Card view"
              title="Card view"
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => changeView("list")}
              aria-label="List view"
              title="List view"
            >
              <List className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No names match &quot;{query}&quot;.
        </p>
      ) : view === "list" && showControls ? (
        <div className="divide-y rounded-lg border">
          {filtered.map((n) => (
            <div key={n.name} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-medium">{n.name}</span>
                  {n.transferJustDetected && (
                    <Badge className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/15 dark:text-amber-400">
                      Recently transferred to you
                    </Badge>
                  )}
                </div>
                <div className="break-all font-mono text-xs text-muted-foreground">
                  {n.zone.replace(/\.$/, "")}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {n.recordCount} record{n.recordCount === 1 ? "" : "s"}
              </span>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                {formatRelativeTime(n.lastUpdated)}
              </span>
              <Button asChild size="sm" variant="outline" className="shrink-0">
                <Link href={`/${namespace}/dashboard/${encodeURIComponent(n.name)}`}>
                  Manage <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((n) => (
            <Card key={n.name} className="flex flex-col">
              <CardHeader className="flex-1">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="flex min-w-0 items-center gap-2 text-lg">
                    <Globe className="size-4 shrink-0 text-muted-foreground" />
                    <span className="break-all">{n.name}</span>
                  </CardTitle>
                  <Badge variant="secondary" className="shrink-0">
                    {n.recordCount} record{n.recordCount === 1 ? "" : "s"}
                  </Badge>
                </div>
                <CardDescription className="break-all font-mono">
                  {n.zone.replace(/\.$/, "")}
                </CardDescription>
                {n.transferJustDetected && (
                  <Badge className="mt-2 w-fit bg-amber-500/15 text-amber-600 hover:bg-amber-500/15 dark:text-amber-400">
                    Ownership recently transferred to you - old records were disabled
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="flex items-center justify-between pt-0">
                <span className="text-xs text-muted-foreground">
                  Updated {formatRelativeTime(n.lastUpdated)}
                </span>
                <Button asChild size="sm">
                  <Link href={`/${namespace}/dashboard/${encodeURIComponent(n.name)}`}>
                    Manage <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
