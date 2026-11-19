import { HazardCategory } from "@prisma/client";

export interface WardCategoryAggregate {
  wardKey: string; // Ward externalId or "UNRESOLVED"
  wardName: string;
  category: HazardCategory;
  current7: number;
  previous7: number;
  delta: number;
  avgSeverity: number;
  maxSeverity: number;
  actionCounts: {
    dispatch_hazmat_bypass_standard: number;
    bypass_standard: number;
    routine_collection: number;
  };
}

export interface WeeklyAggregates {
  windowStart: string; // ISO string
  windowEnd: string;   // ISO string
  asOf?: string;       // ISO string
  totals: {
    current7: number;
    previous7: number;
    synthetic7: number;
    real7: number;
  };
  rows: WardCategoryAggregate[];
}
