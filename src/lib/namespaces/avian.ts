import { createAvianAdapter, createDefaultAvianLookup } from "@/lib/ownership/avian/adapter";
import type { NamespaceConfig } from "./types";

export const avianNamespace: NamespaceConfig = {
  key: "avian",
  displayName: "Avian Name Zone",
  chainName: "Avian",
  networkName: "Avian Network",
  tld: "avn",
  dnsZone: (process.env.AVIAN_DNS_ZONE ?? "avn.zone").trim().toLowerCase(),
  // Brand guidelines: gradient mark on light backgrounds, white mark on dark.
  logoPath: "/logomark-gradient.svg",
  logoPathDark: "/logomark-white.svg",
  faviconPath: "/avian.ico",
  brandColor: "#19827a",
  // `source` is always the claimable single-label name: sub-shaped on-chain
  // names (www.bob.avn) are never manageable here - owning bob.avn is what
  // grants the www./test. hostnames (see validateSourceName).
  exampleNames: [
    { source: "bob.avn", zone: "bob.avn.zone" },
    { source: "bob.avn", zone: "www.bob.avn.zone" },
    { source: "bob.avn", zone: "test.bob.avn.zone" },
  ],
  addressPlaceholder: "RAddressOwningYourName",
  enabled: true,
  adapter: createAvianAdapter(createDefaultAvianLookup()),
};
