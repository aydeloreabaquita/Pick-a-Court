import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const serverSchema = publicSchema.extend({
  SUPABASE_SECRET_KEY: z.string().min(1),
  PAYMONGO_SECRET_KEY: z.string().min(1),
  PAYMONGO_WEBHOOK_SECRET: z.string().min(1),
  APP_URL: z.url(),
});

export function publicEnv() {
  return publicSchema.parse(process.env);
}

export function serverEnv() {
  return serverSchema.parse(process.env);
}
