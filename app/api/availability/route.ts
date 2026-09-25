import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  courtId: z.uuid(),
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});

export async function GET(request: NextRequest) {
  try {
    const params = schema.parse(Object.fromEntries(request.nextUrl.searchParams));
    if (new Date(params.to) <= new Date(params.from)) {
      return NextResponse.json({ error: "to must be after from" }, { status: 400 });
    }
    // Service access is intentional: this public endpoint returns occupied
    // ranges only, never player identity or booking notes.
    const supabase = createAdminClient();
    const [bookings, maintenance] = await Promise.all([
      supabase
        .from("bookings")
        .select("id,starts_at,ends_at,status")
        .eq("court_id", params.courtId)
        .in("status", ["pending_payment", "confirmed"])
        .lt("starts_at", params.to)
        .gt("ends_at", params.from),
      supabase
        .from("maintenance_blocks")
        .select("id,starts_at,ends_at,reason")
        .eq("court_id", params.courtId)
        .lt("starts_at", params.to)
        .gt("ends_at", params.from),
    ]);
    if (bookings.error) throw bookings.error;
    if (maintenance.error) throw maintenance.error;
    return NextResponse.json({
      data: { bookings: bookings.data, maintenance: maintenance.data },
    });
  } catch (error) {
    return jsonError(error);
  }
}
