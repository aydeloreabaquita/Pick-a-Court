# CourtBook backend

Backend-ready Next.js application for multi-sport court discovery, scheduling, reservations, payments, and facility administration.

## Included

- Supabase email/password or OAuth-compatible authentication with server-side cookies
- PostgreSQL schema for users, venues, courts, bookings, maintenance blocks, payments, and idempotent webhook events
- Row-level security for player and administrator access
- Atomic booking creation with a PostgreSQL exclusion constraint that prevents double-booking
- 15-minute unpaid booking holds
- Court availability and player booking APIs
- Administrator booking API
- PayMongo Checkout Session creation and signed webhook processing
- Philippine peso amounts stored in centavos (for example `50000` = PHP 500.00)

## Setup

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` and fill in the Supabase and PayMongo keys.
3. Run `supabase/migrations/001_initial_schema.sql` in the Supabase SQL editor.
4. Optionally run `supabase/seed.sql` to add the sample Mandaue venue and four pickleball courts.
5. Install packages with `npm install`.
6. Start the app with `npm run dev`.
7. In PayMongo, register `https://YOUR_DOMAIN/api/webhooks/paymongo` as the webhook endpoint and subscribe to checkout/payment success, failure, and refund events.

Never expose `SUPABASE_SECRET_KEY`, `PAYMONGO_SECRET_KEY`, or `PAYMONGO_WEBHOOK_SECRET` to the browser.

## API summary

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | Public | Health check |
| GET | `/api/courts` | Public | List active courts; optional `venueId` and `sport` filters |
| GET | `/api/availability` | Public | Return bookings and maintenance conflicts for a court/time window |
| GET | `/api/bookings` | Player | List the signed-in player's bookings |
| POST | `/api/bookings` | Player | Atomically hold an available court slot |
| PATCH | `/api/bookings/:id` | Owner | Cancel an eligible booking |
| POST | `/api/payments/checkout` | Owner | Create a PayMongo checkout session |
| POST | `/api/webhooks/paymongo` | PayMongo | Confirm payment and booking state |
| GET | `/api/admin/bookings` | Admin | Filter and list facility bookings |

### Create a booking

```json
POST /api/bookings
{
  "courtId": "00000000-0000-0000-0000-000000000000",
  "startsAt": "2026-10-01T10:00:00+08:00",
  "endsAt": "2026-10-01T11:00:00+08:00",
  "notes": "Open-play practice"
}
```

### Start checkout

```json
POST /api/payments/checkout
{
  "bookingId": "00000000-0000-0000-0000-000000000000"
}
```

The response contains a `checkoutUrl` for redirecting the player to PayMongo.

## Important production tasks

- Create a scheduled job that marks unpaid bookings as `expired` after `expires_at`.
- Add rate limiting at the deployment edge for authentication, booking, and payment routes.
- Use PayMongo test keys and test webhooks before enabling live keys.
- Promote the first administrator manually in Supabase: `update profiles set role = 'admin' where id = 'USER_UUID';`
- Review cancellation and refund rules before automating refunds.

## Architecture

```text
Web/mobile client
  -> Next.js Route Handlers
      -> Supabase Auth + PostgreSQL + RLS
      -> PayMongo Checkout API
PayMongo webhook
  -> signature verification
  -> idempotent event record
  -> payment + booking status update
```
