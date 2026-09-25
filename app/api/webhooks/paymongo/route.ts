import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPayMongoSignature } from "@/lib/paymongo";

type PayMongoEvent = {
  data: {
    id: string;
    attributes: {
      type: string;
      data: { id: string; attributes: Record<string, unknown> };
    };
  };
};

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!verifyPayMongoSignature(rawBody, request.headers.get("paymongo-signature"))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody) as PayMongoEvent;
  const admin = createAdminClient();
  const eventId = event.data.id;
  const eventType = event.data.attributes.type;
  const resource = event.data.attributes.data;
  const reference = resource.id;

  const { error: eventError } = await admin.from("webhook_events").insert({
    provider_event_id: eventId,
    provider: "paymongo",
    event_type: eventType,
    payload: event,
  });
  if (eventError?.code === "23505") return Response.json({ received: true });
  if (eventError) return Response.json({ error: "Could not record event" }, { status: 500 });

  const { data: payment } = await admin
    .from("payments")
    .select("id,booking_id,status")
    .eq("provider_reference", reference)
    .maybeSingle();

  if (payment) {
    if (["checkout_session.payment.paid", "payment.paid"].includes(eventType)) {
      await admin.from("payments").update({ status: "paid", raw_event: event }).eq("id", payment.id);
      await admin.from("bookings").update({ status: "confirmed", expires_at: null }).eq("id", payment.booking_id);
    } else if (["payment.failed", "checkout_session.payment.failed"].includes(eventType)) {
      await admin.from("payments").update({ status: "failed", raw_event: event }).eq("id", payment.id);
    } else if (["payment.refunded", "payment.refund.updated"].includes(eventType)) {
      await admin.from("payments").update({ status: "refunded", raw_event: event }).eq("id", payment.id);
    }
  }

  return Response.json({ received: true });
}
