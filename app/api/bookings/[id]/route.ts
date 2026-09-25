import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, jsonError } from "@/lib/http";
import { requireUser } from "@/lib/auth";

const paramsSchema = z.object({ id: z.uuid() });
const patchSchema = z.object({ action: z.literal("cancel") });

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = paramsSchema.parse(await context.params);
    patchSchema.parse(await request.json());
    const { supabase, userId } = await requireUser();
    const { data: booking, error: lookupError } = await supabase
      .from("bookings")
      .select("id,user_id,status,starts_at")
      .eq("id", id)
      .single();
    if (lookupError || !booking) throw new ApiError(404, "Booking not found", "not_found");
    if (booking.user_id !== userId) throw new ApiError(403, "Forbidden", "forbidden");
    if (!["pending_payment", "confirmed"].includes(booking.status)) {
      throw new ApiError(409, "Booking cannot be cancelled", "invalid_status");
    }
    const { data, error } = await supabase
      .from("bookings")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
