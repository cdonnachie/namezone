import { createAvianAdapter, createDefaultAvianLookup } from "@/lib/ownership/avian/adapter";
import type { NamespaceConfig } from "./types";

export const avianNamespace: NamespaceConfig = {
  key: "avian",
  displayName: "Avian Name Zone",
  chainName: "Avian",
  tld: "avn",
  dnsZone: (process.env.AVIAN_DNS_ZONE ?? "avn.zone").trim().toLowerCase(),
  logoPath: "/avianlogo.png",
  faviconPath: "/avian.ico",
  brandColor: "#19827a",
  exampleNames: [
    { source: "bob.avn", zone: "bob.avn.zone" },
    { source: "www.bob.avn", zone: "www.bob.avn.zone" },
    { source: "test.bob.avn", zone: "test.bob.avn.zone" },
  ],
  addressPlaceholder: "RAddressOwningYourName",
  enabled: true,
  adapter: createAvianAdapter(createDefaultAvianLookup()),
};
