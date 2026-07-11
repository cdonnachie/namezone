"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TAB_IDS = ["basics", "records", "security"] as const;
type TabId = (typeof TAB_IDS)[number];

// Deep links to individual cards inside a tab: the hash names the card's
// element id, and this maps it to the tab that must be active for the card
// to exist in the DOM (Radix unmounts inactive tab content).
const CARD_TABS: Record<string, TabId> = {
  hosting: "records",
  privacy: "records",
};

/**
 * Tabbed shell for the help page. The cards themselves stay server-rendered
 * (passed in as children per tab); this wrapper only owns which tab is
 * active. Deep links work via the hash - /help#security opens the Security
 * tab directly (used from the landing-page callout and community posts) -
 * and switching tabs updates the hash so the current tab is shareable.
 * NOTE: the abuse-contact card deliberately lives OUTSIDE these tabs (always
 * visible), since /help#abuse is the URL cited in the Public Suffix List PR.
 */
export function HelpTabs({ basics, records, security }: Record<TabId, React.ReactNode>) {
  const [tab, setTab] = useState<TabId>("basics");

  useEffect(() => {
    // The hash is only knowable client-side after mount: reading it in the
    // useState initializer would render a different tab during hydration
    // than the server did (hydration mismatch), so a post-mount set is the
    // correct pattern here despite the lint rule.
    const hash = window.location.hash.slice(1);
    if ((TAB_IDS as readonly string[]).includes(hash)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab(hash as TabId);
    } else if (hash in CARD_TABS) {
      setTab(CARD_TABS[hash]);
      // Scroll after the tab's content has mounted.
      requestAnimationFrame(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, []);

  function handleChange(value: string) {
    setTab(value as TabId);
    window.history.replaceState(null, "", `#${value}`);
  }

  return (
    <Tabs value={tab} onValueChange={handleChange}>
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="basics">Basics</TabsTrigger>
        <TabsTrigger value="records">Records &amp; SSL</TabsTrigger>
        <TabsTrigger value="security">Security</TabsTrigger>
      </TabsList>
      <TabsContent value="basics" className="mt-6 space-y-6">
        {basics}
      </TabsContent>
      <TabsContent value="records" className="mt-6 space-y-6">
        {records}
      </TabsContent>
      <TabsContent value="security" className="mt-6 space-y-6">
        {security}
      </TabsContent>
    </Tabs>
  );
}
