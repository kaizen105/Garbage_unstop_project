import { z } from "zod";

export const HazardCategoryEnum = z.enum([
  "biohazard_medical",
  "construction_debris",
  "electrical_hazard",
  "chemical",
  "general_overflow",
  "unknown",
]);

export const UrgencyEnum = z.enum(["immediate", "this_week", "monitor"]);

export const ActionItemSchema = z.object({
  owner: z.string().min(1).max(100),
  action: z.string().min(1).max(300),
});

export const PriorityItemSchema = z.object({
  wardKey: z.string().min(1),
  category: HazardCategoryEnum,
  urgency: UrgencyEnum,
  likelyCauses: z.array(z.string().min(1).max(300)).min(1).max(3),
  actions: z.array(ActionItemSchema).min(1).max(4),
});

// Strictly qualitative plan from LLM - NO incident counts
export const RawMitigationPlanSchema = z.object({
  headline: z.string().min(5).max(200),
  priorities: z.array(PriorityItemSchema).min(1).max(5),
  crossCuttingActions: z.array(z.string().min(1).max(300)).max(3).default([]),
});

export type RawMitigationPlan = z.infer<typeof RawMitigationPlanSchema>;

export const GroundedPriorityItemSchema = PriorityItemSchema.extend({
  wardName: z.string(),
  current7: z.number().int(),
  previous7: z.number().int(),
  delta: z.number().int(),
  avgSeverity: z.number(),
  maxSeverity: z.number().int(),
});

export const GroundedMitigationPlanSchema = z.object({
  headline: z.string().min(5).max(200),
  priorities: z.array(GroundedPriorityItemSchema).min(1).max(5),
  crossCuttingActions: z.array(z.string()).max(3),
});

export type GroundedMitigationPlan = z.infer<typeof GroundedMitigationPlanSchema>;
