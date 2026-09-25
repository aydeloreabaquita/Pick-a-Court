import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/http";
import { serverEnv } from "@/lib/env";

const API_URL = "https://api.paymongo.com/v1";

function authorization() {
  return `Basic ${Buffer.from(`${serverEnv().PAYMONGO_SECRET_KEY}:`).toString("base64")}`;
}

export async function createCheckoutSession(input: {
  bookingId: string;
  amount: number;
  currency: string;
  courtName: string;
}) {
  const env = serverEnv();
  const response = await fetch(`${API_URL}/checkout_sessions`, {
    method: "POST",
    headers: {
      Authorization: authorization(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      data: {
        attributes: {
          billing: null,
          cancel_url: `${env.APP_URL}/bookings/${input.bookingId}?payment=cancelled`,
          description: `CourtBook reservation ${input.bookingId}`,
          line_items: [
            {
              amount: input.amount,
              currency: input.currency,
              description: "Court reservation",
              name: input.courtName,
              quantity: 1,
            },
          ],
          payment_method_types: ["card", "gcash", "paymaya", "grab_pay"],
          reference_number: input.bookingId,
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          success_url: `${env.APP_URL}/bookings/${input.bookingId}?payment=success`,
        },
      },
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    console.error("PayMongo checkout error", payload);
    throw new ApiError(502, "Could not start payment", "payment_provider_error");
  }
  return payload.data as {
    id: string;
    attributes: { checkout_url: string; payment_intent?: { id?: string } };
  };
}

export function verifyPayMongoSignature(rawBody: string, header: string | null) {
  if (!header) return false;
  const values = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, value] = part.trim().split("=", 2);
      return [key, value];
    }),
  );
  const timestamp = values.t;
  const signature = values.li ?? values.te;
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", serverEnv().PAYMONGO_WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
