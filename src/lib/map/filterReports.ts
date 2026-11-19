import type { Report } from "@/lib/store/reports";

export interface ReportFilterOptions {
  category?: string;
  minSeverity?: number;
}

/**
 * Filter loaded reports by hazard category and minimum severity.
 * Applies strictly in-memory to the currently loaded slice of reports.
 */
export function filterReports(
  reports: Report[],
  options: ReportFilterOptions = {}
): Report[] {
  const { category = "all", minSeverity = 0 } = options;

  return reports.filter((r) => {
    if (category && category !== "all" && r.hazard_category !== category) {
      return false;
    }
    if (typeof minSeverity === "number" && minSeverity > 0 && r.severity_level < minSeverity) {
      return false;
    }
    return true;
  });
}
