import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, jsonError } from "@/lib/http";
import { requireUser } from "@/lib/auth";

const createSchema = z.object({
  courtId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  notes: z.string().trim().max(500).optional(),
});

export async function GET() {
  try {
    const { supabase, userId } = await requireUser();
    const { data, error } = await supabase
      .from("bookings")
      .select("*,courts(id,name,court_type,sport,venues(id,name,slug,address))")
      .eq("user_id", userId)
      .order("starts_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createSchema.parse(await request.json());
    if (new Date(body.endsAt) <= new Date(body.startsAt)) {
      throw new ApiError(400, "endsAt must be after startsAt", "invalid_window");
    }
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("create_booking", {
      p_court_id: body.courtId,
      p_starts_at: body.startsAt,
      p_ends_at: body.endsAt,
      p_notes: body.notes ?? null,
    });
    if (error) {
      if (/no longer available|overlap/i.test(error.message)) {
        throw new ApiError(409, "Selected time is no longer available", "booking_conflict");
      }
      throw error;
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
