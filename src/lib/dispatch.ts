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
