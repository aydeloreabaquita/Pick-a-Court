import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";

const querySchema = z.object({
  venueId: z.uuid().optional(),
  sport: z.string().trim().min(1).optional(),
  date: z.iso.date().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const supabase = await createClient();
    let builder = supabase
      .from("courts")
      .select("id,name,sport,court_type,hourly_rate,currency,status,description,venues(id,name,slug,address,timezone)")
      .eq("status", "available")
      .order("name");
    if (query.venueId) builder = builder.eq("venue_id", query.venueId);
    if (query.sport) builder = builder.ilike("sport", query.sport);
    const { data, error } = await builder;
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (error) {
    return jsonError(error);
  }
}
