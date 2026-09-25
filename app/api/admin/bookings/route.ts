import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/http";
import { requireAdmin } from "@/lib/auth";

const querySchema = z.object({
  date: z.iso.date().optional(),
  status: z.enum(["pending_payment", "confirmed", "cancelled", "completed", "expired"]).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const { supabase } = await requireAdmin();
    let builder = supabase
      .from("bookings")
      .select("*,profiles(id,full_name,phone),courts(id,name,court_type,venues(id,name))")
      .order("starts_at");
    if (query.status) builder = builder.eq("status", query.status);
    if (query.date) {
      const start = new Date(`${query.date}T00:00:00+08:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      builder = builder.gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString());
    }
    const { data, error } = await builder;
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
