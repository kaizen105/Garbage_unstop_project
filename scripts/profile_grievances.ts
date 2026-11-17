import * as fs from "fs";
import * as path from "path";

export interface GrievanceMappingResult {
  category: "electrical_hazard" | "general_overflow" | "biohazard_medical" | null;
  excludedReason?: string;
}

export function mapGrievanceCategory(
  category: string,
  subCategory?: string
): GrievanceMappingResult {
  const catClean = category.trim().toLowerCase();
  const subClean = (subCategory || "").trim().toLowerCase();

  if (catClean === "electrical") {
    return { category: "electrical_hazard" };
  }

  if (catClean === "solid waste (garbage) related") {
    if (subClean.startsWith("dead animal")) {
      return { category: "biohazard_medical" };
    }
    return { category: "general_overflow" };
  }

  return { category: null, excludedReason: category.trim() };
}

export interface SyntheticProfileOutput {
  sourceFile: string;
  counts: {
    total: number;
    kept: number;
    excluded: number;
  };
  excludedCategories: Record<string, number>;
  measuredShares: {
    electrical_hazard: number;
    general_overflow: number;
    biohazard_medical: number;
  };
  timingMeasured: boolean;
  hourOfDayWeights: number[];
  weekdayWeights: number[];
  assumed: {
    construction_debris: number;
    chemical: number;
    unknown: number;
    description: string;
  };
  finalDistributionPercent: {
    electrical_hazard: number;
    general_overflow: number;
    biohazard_medical: number;
    construction_debris: number;
    chemical: number;
    unknown: number;
  };
}

export async function profileGrievances(filePath: string): Promise<SyntheticProfileOutput> {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const fileName = path.basename(resolvedPath);
  const fileStream = fs.createReadStream(resolvedPath, { encoding: "utf-8" });

  let isHeader = true;
  let catIdx = -1;
  let subCatIdx = -1;
  let dateIdx = -1;

  let totalRows = 0;
  let keptRows = 0;
  let excludedRows = 0;

  const categoryCounts = {
    electrical_hazard: 0,
    general_overflow: 0,
    biohazard_medical: 0,
  };

  const excludedCategoryCounts: Record<string, number> = {};
  const hourCounts = new Array<number>(24).fill(0);
  const weekdayCounts = new Array<number>(7).fill(0);
  let validTimestamps = 0;

  let currentRecord: string[] = [];
  let currentField = "";
  let insideQuotes = false;

  for await (const chunk of fileStream) {
    const str = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      const nextChar = i + 1 < str.length ? str[i + 1] : "";

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          currentField += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === ',' && !insideQuotes) {
        currentRecord.push(currentField.trim());
        currentField = "";
      } else if ((char === '\r' || char === '\n') && !insideQuotes) {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        currentRecord.push(currentField.trim());
        currentField = "";

        if (currentRecord.length > 1 || (currentRecord.length === 1 && currentRecord[0] !== "")) {
          const cols = currentRecord;
          currentRecord = [];

          if (isHeader) {
            isHeader = false;
            catIdx = cols.indexOf("Category");
            subCatIdx = cols.indexOf("Sub Category");
            dateIdx = cols.indexOf("Grievance Date");
            if (catIdx === -1) {
              throw new Error("Missing 'Category' column in CSV header.");
            }
            continue;
          }

          totalRows++;
          const rawCat = catIdx !== -1 && cols[catIdx] ? cols[catIdx]! : "";
          const rawSubCat = (subCatIdx !== -1 && cols[subCatIdx]) ? cols[subCatIdx]! : "";
          const mapping = mapGrievanceCategory(rawCat, rawSubCat);

          if (mapping.category) {
            keptRows++;
            categoryCounts[mapping.category]++;

            const dateVal = dateIdx !== -1 ? cols[dateIdx] : undefined;
            if (dateVal) {
              const rawDate = dateVal.trim();
              const cleanIso = rawDate.replace(" ", "T").slice(0, 23) + "Z";
              const d = new Date(cleanIso);
              if (!isNaN(d.getTime())) {
                validTimestamps++;
                const hour = d.getUTCHours();
                const day = d.getUTCDay();
                hourCounts[hour] = (hourCounts[hour] || 0) + 1;
                weekdayCounts[day] = (weekdayCounts[day] || 0) + 1;
              }
            }
          } else {
            excludedRows++;
            const reason = mapping.excludedReason || "Unknown";
            excludedCategoryCounts[reason] = (excludedCategoryCounts[reason] || 0) + 1;
          }
        } else {
          currentRecord = [];
        }
      } else {
        currentField += char;
      }
    }
  }

  // Handle last record if file does not end with newline
  if (currentField.length > 0 || currentRecord.length > 0) {
    currentRecord.push(currentField.trim());
    if (!isHeader && currentRecord.length > 1) {
      totalRows++;
      const cols = currentRecord;
      const rawCat = catIdx !== -1 && cols[catIdx] ? cols[catIdx]! : "";
      const rawSubCat = (subCatIdx !== -1 && cols[subCatIdx]) ? cols[subCatIdx]! : "";
      const mapping = mapGrievanceCategory(rawCat, rawSubCat);
      if (mapping.category) {
        keptRows++;
        categoryCounts[mapping.category]++;
      } else {
        excludedRows++;
      }
    }
  }

  // Calculate normalized ratios for the 3 measured categories
  const measuredTotal = categoryCounts.electrical_hazard + categoryCounts.general_overflow + categoryCounts.biohazard_medical;
  const measuredShares = {
    electrical_hazard: measuredTotal > 0 ? categoryCounts.electrical_hazard / measuredTotal : 0,
    general_overflow: measuredTotal > 0 ? categoryCounts.general_overflow / measuredTotal : 0,
    biohazard_medical: measuredTotal > 0 ? categoryCounts.biohazard_medical / measuredTotal : 0,
  };

  // Assumed shares in percent
  const assumed = {
    construction_debris: 10,
    chemical: 3,
    unknown: 2,
    description: "Assumptions not measured from the source complaint file",
  };

  // Remaining 85% is split between electrical, general_overflow, and biohazard_medical
  const remainingPercent = 100 - (assumed.construction_debris + assumed.chemical + assumed.unknown);
  const finalDistributionPercent = {
    electrical_hazard: Math.round(remainingPercent * measuredShares.electrical_hazard * 100) / 100,
    general_overflow: Math.round(remainingPercent * measuredShares.general_overflow * 100) / 100,
    biohazard_medical: Math.round(remainingPercent * measuredShares.biohazard_medical * 100) / 100,
    construction_debris: assumed.construction_debris,
    chemical: assumed.chemical,
    unknown: assumed.unknown,
  };

  const timingMeasured = validTimestamps > 0;
  const hourOfDayWeights = timingMeasured && validTimestamps > 0
    ? hourCounts.map((c) => Math.round((c / validTimestamps) * 10000) / 10000)
    : [];
  const weekdayWeights = timingMeasured && validTimestamps > 0
    ? weekdayCounts.map((c) => Math.round((c / validTimestamps) * 10000) / 10000)
    : [];

  const profile: SyntheticProfileOutput = {
    sourceFile: fileName,
    counts: {
      total: totalRows,
      kept: keptRows,
      excluded: excludedRows,
    },
    excludedCategories: excludedCategoryCounts,
    measuredShares: {
      electrical_hazard: Math.round(measuredShares.electrical_hazard * 10000) / 10000,
      general_overflow: Math.round(measuredShares.general_overflow * 10000) / 10000,
      biohazard_medical: Math.round(measuredShares.biohazard_medical * 10000) / 10000,
    },
    timingMeasured,
    hourOfDayWeights,
    weekdayWeights,
    assumed,
    finalDistributionPercent,
  };

  return profile;
}

async function main() {
  const args = process.argv.slice(2);
  const fileArgIdx = args.indexOf("--file");
  const filePath = fileArgIdx !== -1 && args[fileArgIdx + 1] ? args[fileArgIdx + 1] : "1342a93b-9a61-4766-9c34-c8357b7926c2.csv";

  if (!filePath) {
    console.error("Usage: tsx scripts/profile_grievances.ts --file <path>");
    process.exit(1);
  }

  console.log(`Profiling grievances from: ${filePath}...`);
  const profile = await profileGrievances(filePath);

  const outDir = path.resolve("data");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, "synthetic_profile.json");
  fs.writeFileSync(outPath, JSON.stringify(profile, null, 2), "utf-8");

  console.log("Successfully generated profile:", outPath);
  console.log(`Total rows processed: ${profile.counts.total}`);
  console.log(`Kept rows: ${profile.counts.kept}`);
  console.log(`Source file: ${profile.sourceFile}`);
  console.log(`Excluded rows: ${profile.counts.excluded}`);
  console.log("Measured ratios:", profile.measuredShares);
  console.log("Final distribution percent:", profile.finalDistributionPercent);
  console.log(`Timing measured: ${profile.timingMeasured}`);
}

if (require.main === module || process.argv[1]?.includes("profile_grievances")) {
  main().catch((err) => {
    console.error("Profiling failed:", err);
    process.exit(1);
  });
}
