export function mockExtractHazard(transcript: string) {
  const text = transcript.toLowerCase();
  
  if (text.includes("medical") || text.includes("hospital") || text.includes("बायोमेडिकल") || text.includes("waste")) {
    return { hazard_category: "biohazard_medical" as const, severity_level: 8, raw_location: "hospital area" };
  }
  if (text.includes("rubble") || text.includes("debris") || text.includes("कचरा") || text.includes("malba")) {
    return { hazard_category: "construction_debris" as const, severity_level: 4, raw_location: "street" };
  }
  if (text.includes("wire") || text.includes("electricity") || text.includes("बिजली") || text.includes("तार")) {
    return { hazard_category: "electrical_hazard" as const, severity_level: 9, raw_location: "pole" };
  }
  if (text.includes("chemical") || text.includes("acid") || text.includes("रसायन")) {
    return { hazard_category: "chemical" as const, severity_level: 10, raw_location: "industrial" };
  }
  if (text.includes("overflow") || text.includes("water") || text.includes("पानी") || text.includes("नाली")) {
    return { hazard_category: "general_overflow" as const, severity_level: 6, raw_location: "drain" };
  }

  return { hazard_category: "unknown" as const, severity_level: 5, raw_location: "" };
}
