import { createRadiantAdapter, createDefaultRadiantLookup } from "@/lib/ownership/radiant/adapter";
import type { NamespaceConfig } from "./types";

/**
 * Real Radiant Wave Names branding (logo/color) - see the palette comment
 * above [data-namespace="radiant"] in globals.css. Address validation, the
 * signmessage-based login flow, and RXinDexer-backed name ownership lookups
 * are all real (src/lib/ownership/radiant/, see wave.ts and
 * electrum-provider.ts) - the signmessage magic prefix is still a
 * best-effort guess pending a real signature to verify against (see
 * message.ts). Set RADIANT_MOCK_OWNERS for local testing without a live
 * RXinDexer instance, or RADIANT_ELECTRUMX_HOST/PORT to use a real one.
 */
export const radiantNamespace: NamespaceConfig = {
  key: "radiant",
  displayName: "Radiant Wave Zone",
  chainName: "Radiant",
  tld: "rxd",
  dnsZone: (process.env.RADIANT_DNS_ZONE ?? "rxd.zone").trim().toLowerCase(),
  logoPath: "/rxd-lightmode.png",
  logoPathDark: "/rxd-darkmode.png",
  faviconPath: "/rxd-darkmode.png",
  brandColor: "#356fdb",
  exampleNames: [
    { source: "bob.rxd", zone: "bob.rxd.zone" },
    { source: "bob.rxd", zone: "www.bob.rxd.zone" },
    { source: "bob.rxd", zone: "test.bob.rxd.zone" },
  ],
  addressPlaceholder: "1AddressOwningYourName",
  enabled: true,
  adapter: createRadiantAdapter(createDefaultRadiantLookup()),
};
