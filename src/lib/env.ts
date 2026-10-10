import { z } from "zod";

const envSchema = z.object({
  GNANI_API_KEY: z.string().min(1),
  GNANI_ASR_URL: z.string().url(),
  GNANI_EVON_URL: z.string().url(),
  NEXT_PUBLIC_MAPBOX_TOKEN: z.string().min(1).optional(),
  NEXT_PUBLIC_MAP_PROVIDER: z.enum(["leaflet", "mapbox"]).default("leaflet"),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  const missingKeys = _env.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new Error(`Missing or invalid environment variables: ${missingKeys}`);
}

export const env = _env.data;
