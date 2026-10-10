import { z } from "zod";

export const HazardCategorySchema = z.enum([
  "biohazard_medical",
  "construction_debris",
  "electrical_hazard",
  "chemical",
  "general_overflow",
  "unknown",
]);
export type HazardCategory = z.infer<typeof HazardCategorySchema>;

export const GnaniLanguageCodeSchema = z.enum([
  "bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN", 
  "ml-IN", "mr-IN", "pa-IN", "ta-IN", "te-IN"
]);
export type GnaniLanguageCode = z.infer<typeof GnaniLanguageCodeSchema>;

export const GnaniErrorKindSchema = z.enum([
  "INVALID_AUDIO", "AUDIO_TOO_LARGE", "AUDIO_TOO_LONG", 
  "AUTH_OR_CREDITS", "RATE_LIMITED", "UPSTREAM_ERROR", 
  "TIMEOUT", "EMPTY_TRANSCRIPT", "BAD_RESPONSE"
]);
export type GnaniErrorKind = z.infer<typeof GnaniErrorKindSchema>;

export const GnaniTranscriptSchema = z.object({
  text: z.string().min(1).max(5000),
  language_code: GnaniLanguageCodeSchema,
  request_id: z.string().optional(),
  mock: z.boolean(),
});
export type GnaniTranscript = z.infer<typeof GnaniTranscriptSchema>;

export const HazardReportSchema = z.object({
  report_id: z.string(),
  hazard_category: HazardCategorySchema,
  severity_level: z.number().int().min(1).max(10),
  raw_location: z.string(),
  coordinates: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }).nullable(),
  action_required: z.enum(["dispatch_hazmat_bypass_standard", "bypass_standard", "routine_collection"]),
});
export type HazardReport = z.infer<typeof HazardReportSchema>;

export const WardTagSchema = z.object({
  ward_id: z.string().nullable(),
  ward_name: z.string().nullable(),
  status: z.enum(["matched", "unmapped", "invalid_coordinates"]),
});
export type WardTag = z.infer<typeof WardTagSchema>;
