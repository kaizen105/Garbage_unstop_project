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

export const GnaniTranscriptSchema = z.object({
  text: z.string().min(1).max(5000),
  language: z.string(),
  confidence: z.number().min(0).max(1),
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
  action_required: z.string(),
});
export type HazardReport = z.infer<typeof HazardReportSchema>;

export const WardTagSchema = z.object({
  ward_id: z.string().nullable(),
  ward_name: z.string().nullable(),
  status: z.enum(["matched", "unmapped", "invalid_coordinates"]),
});
export type WardTag = z.infer<typeof WardTagSchema>;
