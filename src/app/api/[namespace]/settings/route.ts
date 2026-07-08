import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api-error";
import { getSession } from "@/lib/auth/session";
import { hasValidStepUp, isStepUpRequired, STEP_UP_REQUIRED_ERROR } from "@/lib/auth/step-up";
import { prisma } from "@/lib/db";
import { getNamespace } from "@/lib/namespaces";

const updateSettingsSchema = z.object({
  requireSignedWrites: z.boolean(),
});

export async function GET(req: Request, { params }: { params: Promise<{ namespace: string }> }) {
  try {
    const { namespace: key } = await params;
    const ns = getNamespace(key);

    const session = await getSession(ns.key);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    return NextResponse.json({
      requireSignedWrites: await isStepUpRequired(ns.key, session.address),
    });
  } catch (err) {
    return handleApiError(err, "Failed to load settings.");
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ namespace: string }> }) {
  try {
    const { namespace: key } = await params;
    const ns = getNamespace(key);

    const session = await getSession(ns.key);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { requireSignedWrites } = updateSettingsSchema.parse(await req.json());

    // Turning the protection ON never needs extra proof (it only reduces
    // what this session can do). Turning it OFF while it's active requires
    // a fresh wallet signature - otherwise a hijacked session could simply
    // disable the setting and then write freely.
    if (!requireSignedWrites && (await isStepUpRequired(ns.key, session.address))) {
      if (!(await hasValidStepUp(ns.key, session.address))) {
        return NextResponse.json({ error: STEP_UP_REQUIRED_ERROR }, { status: 403 });
      }
    }

    await prisma.addressSetting.upsert({
      where: { namespace_address: { namespace: ns.key, address: session.address } },
      create: { namespace: ns.key, address: session.address, requireSignedWrites },
      update: { requireSignedWrites },
    });

    return NextResponse.json({ requireSignedWrites });
  } catch (err) {
    return handleApiError(err, "Failed to update settings.");
  }
}
