import { notFound } from "next/navigation";
import { getNamespace } from "@/lib/namespaces";
import { PhotonicCallbackClient } from "./photonic-callback-client";

/**
 * Landing target for Photonic's post-signing redirect (see
 * src/lib/ownership/radiant/photonic-callback.ts for the flow). Photonic is
 * Radiant-only, so every other namespace 404s.
 */
export default async function PhotonicCallbackPage({
  params,
}: {
  params: Promise<{ namespace: string }>;
}) {
  const { namespace: key } = await params;
  try {
    if (getNamespace(key).key !== "radiant") notFound();
  } catch {
    notFound();
  }

  return <PhotonicCallbackClient />;
}
