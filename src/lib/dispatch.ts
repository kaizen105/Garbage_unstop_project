export interface DispatchBadge {
  label: string;
  tone: "danger" | "warning" | "neutral";
}

export function getDispatchBadge(action: string): DispatchBadge {
  switch (action) {
    case "dispatch_hazmat_bypass_standard":
      return { label: "HAZMAT + BYPASS", tone: "danger" };
    case "bypass_standard":
      return { label: "BYPASS STANDARD", tone: "warning" };
    case "routine_collection":
      return { label: "ROUTINE", tone: "neutral" };
    default:
      return { label: "UNKNOWN", tone: "neutral" };
  }
}

export function getActionRequired(category: string, severity: number): "dispatch_hazmat_bypass_standard" | "bypass_standard" | "routine_collection" {
  const hazmat = ["biohazard_medical", "chemical", "electrical_hazard"];
  if (hazmat.includes(category) && severity >= 6) {
    return "dispatch_hazmat_bypass_standard";
  }
  if (severity >= 7) {
    return "bypass_standard";
  }
  return "routine_collection";
}
