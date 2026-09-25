import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, jsonError } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { createCheckoutSession } from "@/lib/paymongo";

const schema = z.object({ bookingId: z.uuid() });

export async function POST(request: NextRequest) {
  try {
    const { bookingId } = schema.parse(await request.json());
    const { supabase, userId } = await requireUser();
    const { data: booking, error } = await supabase
      .from("bookings")
      .select("id,user_id,amount,currency,status,expires_at,courts(name)")
      .eq("id", bookingId)
      .single();
    if (error || !booking) throw new ApiError(404, "Booking not found", "not_found");
    if (booking.user_id !== userId) throw new ApiError(403, "Forbidden", "forbidden");
    if (booking.status !== "pending_payment") {
      throw new ApiError(409, "Booking is not awaiting payment", "invalid_status");
    }
    if (booking.expires_at && new Date(booking.expires_at) <= new Date()) {
      await supabase.from("bookings").update({ status: "expired" }).eq("id", bookingId);
      throw new ApiError(410, "Booking hold has expired", "booking_expired");
    }
    const court = Array.isArray(booking.courts) ? booking.courts[0] : booking.courts;
    const checkout = await createCheckoutSession({
      bookingId,
      amount: booking.amount,
      currency: booking.currency,
      courtName: court?.name ?? "Court reservation",
    });
    const { error: paymentError } = await supabase.from("payments").insert({
      booking_id: bookingId,
      user_id: userId,
      provider_reference: checkout.id,
      checkout_url: checkout.attributes.checkout_url,
      amount: booking.amount,
      currency: booking.currency,
    });
    if (paymentError) throw paymentError;
    return NextResponse.json({
      data: { checkoutUrl: checkout.attributes.checkout_url, sessionId: checkout.id },
    });
  } catch (error) {
    return jsonError(error);
  }
}
