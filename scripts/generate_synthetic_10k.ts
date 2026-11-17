import * as fs from "fs";
import * as path from "path";
import { HazardCategory, ActionRequired, ReportStatus } from "@prisma/client";
import { getActionRequired } from "../src/lib/dispatch";
import { TRANSCRIPT_TEMPLATES } from "./data/transcript_templates";
import { samplePointInPolygon, pickWeightedIndex, createPseudoRandom } from "./generator_utils";
import type { FeatureCollection, Feature, Polygon, MultiPolygon } from "geojson";

interface ProfileData {
  sourceFile: string;
  timingMeasured: boolean;
  hourOfDayWeights: number[];
  weekdayWeights: number[];
  finalDistributionPercent: Record<HazardCategory, number>;
}

interface GenerateOptions {
  count: number;
  seed: number;
  dryRun: boolean;
  deleteBatch: boolean;
}

export function computeParetoWeights(numWards: number, topCount: number = 25, topShare: number = 0.6): number[] {
  const weights = new Array<number>(numWards).fill(1);
  const actualTop = Math.min(topCount, numWards);
  const remainingCount = numWards - actualTop;

  const topWeight = remainingCount > 0 ? (topShare / actualTop) : (1 / numWards);
  const restWeight = remainingCount > 0 ? ((1 - topShare) / remainingCount) : 0;

  for (let i = 0; i < numWards; i++) {
    weights[i] = i < actualTop ? topWeight : restWeight;
  }

  return weights;
}

export async function generateSyntheticData(options: GenerateOptions) {
  const { count, seed, dryRun, deleteBatch } = options;

  console.log("=== SYNTHETIC GENERATOR CONFIGURATION ===");
  console.log(`Target Count: ${count}`);
  console.log(`PRNG Seed: ${seed}`);
  console.log(`Dry Run Mode: ${dryRun}`);
  console.log(`Delete Batch Mode: ${deleteBatch}`);

  // Handle delete-batch flag if specified
  if (deleteBatch) {
    if (dryRun) {
      console.log("[DRY-RUN] Skipped database count and deletion in dry run mode.");
      return;
    }

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const existingSynCount = await prisma.report.count({
        where: {
          id: { startsWith: "SYN-" },
        },
      });

      console.log(`Found ${existingSynCount} reports matching id LIKE 'SYN-%'.`);

      if (existingSynCount > 0) {
        const deleted = await prisma.report.deleteMany({
          where: {
            id: { startsWith: "SYN-" },
          },
        });
        console.log(`Deleted ${deleted.count} synthetic reports.`);
      }
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  // 1. Read profile
  const profilePath = path.resolve("data/synthetic_profile.json");
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile file not found at ${profilePath}. Run 'npm run profile' first.`);
  }

  const profile: ProfileData = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
  console.log(`Loaded Profile from: ${profile.sourceFile}`);
  console.log(`Timing Measured in Profile: ${profile.timingMeasured}`);

  const rng = createPseudoRandom(seed);

  // 2. Read Delhi wards GeoJSON
  const wardsGeoPath = path.resolve("data/delhi_wards.json");
  if (!fs.existsSync(wardsGeoPath)) {
    throw new Error(`Ward boundaries not found at ${wardsGeoPath}.`);
  }
  const wardsGeo: FeatureCollection = JSON.parse(fs.readFileSync(wardsGeoPath, "utf-8"));
  const wardFeatures = wardsGeo.features.filter(
    (f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
  ) as Feature<Polygon | MultiPolygon>[];

  if (wardFeatures.length === 0) {
    throw new Error("No valid polygon features found in delhi_wards.json.");
  }

  // Ward DB map (only queried from Postgres if NOT in dry-run mode)
  const wardDbMap = new Map<string, string>();
  if (!dryRun) {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const dbWards = await prisma.ward.findMany({
        select: { id: true, externalId: true, sourceWardId: true },
      });
      for (const w of dbWards) {
        if (w.sourceWardId) {
          wardDbMap.set(w.sourceWardId, w.id);
        }
        const dash = w.externalId.indexOf("-");
        const pfx = dash !== -1 ? w.externalId.substring(0, dash) : w.externalId;
        wardDbMap.set(pfx, w.id);
      }
    } finally {
      await prisma.$disconnect();
    }
  }

  // Read landmarks for location enrichment
  const landmarksPath = path.resolve("data/delhi_landmarks.json");
  const landmarks: Array<{ name: string; lat: number; lng: number }> = fs.existsSync(landmarksPath)
    ? JSON.parse(fs.readFileSync(landmarksPath, "utf-8"))
    : [];

  // 3. Setup Pareto Ward Weighting (25 top wards get ~60% of volume)
  const numWards = wardFeatures.length;
  const wardWeights = computeParetoWeights(numWards, 25, 0.60);

  // 4. Locate target spike wards by name in Delhi wards GeoJSON:
  // RAJENDER NAGAR (Karol Bagh area), NDMC CHARGE 2, AMAR COLONY, PANDAV NAGAR
  function findWardIndex(targetName: string): number {
    const idx = wardFeatures.findIndex((f) => {
      const name = String(f.properties?.ward_name || f.properties?.WARD_NAME || "").toUpperCase();
      return name.includes(targetName.toUpperCase());
    });
    return idx !== -1 ? idx : 0;
  }

  const spikeWardConfigs = [
    { target: "RAJENDER NAGAR", category: "biohazard_medical" as HazardCategory, count: 70 },
    { target: "NDMC CHARGE 2", category: "electrical_hazard" as HazardCategory, count: 65 },
    { target: "AMAR COLONY", category: "chemical" as HazardCategory, count: 55 },
    { target: "PANDAV NAGAR", category: "general_overflow" as HazardCategory, count: 50 },
  ];

  const plantedSpikes = spikeWardConfigs.map((cfg) => {
    const featIdx = findWardIndex(cfg.target);
    const feat = wardFeatures[featIdx]!;
    const wardName = String(feat.properties?.ward_name || feat.properties?.WARD_NAME || cfg.target);
    return {
      index: featIdx,
      wardName,
      category: cfg.category,
      count: cfg.count,
    };
  });

  const totalSpikes = plantedSpikes.reduce((a, b) => a + b.count, 0); // 240 extra spike rows
  const baselineCount = count - totalSpikes; // 9,760 baseline rows

  console.log(`\nGenerating ${baselineCount} baseline rows + ${totalSpikes} planted spike rows = ${count} total rows.`);

  // Category distribution setup from profile
  const categories: HazardCategory[] = [
    "electrical_hazard",
    "general_overflow",
    "biohazard_medical",
    "construction_debris",
    "chemical",
    "unknown",
  ];
  const categoryWeights = categories.map((cat) => profile.finalDistributionPercent[cat] || 1);

  // Time weight setup (90 days window)
  const nowMs = Date.now();
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  const hourWeights = profile.timingMeasured && profile.hourOfDayWeights.length === 24
    ? profile.hourOfDayWeights
    : [1, 1, 1, 1, 1, 2, 4, 6, 8, 9, 8, 7, 6, 6, 7, 8, 8, 7, 6, 4, 3, 2, 1, 1];

  if (!profile.timingMeasured) {
    console.log("Timing was not measured in profile; using default weekday and daytime weighting.");
  }

  // Stats collectors
  const categoryStats: Record<string, number> = {};
  const wardIncidentStats = new Map<string, number>();
  const weeklyStats: number[] = new Array(13).fill(0); // 13 weeks in 90 days

  // Pareto verification: track top 25 ward count in baseline traffic
  let baselineTop25Count = 0;

  const recordsToInsert: Array<{
    id: string;
    hazardCategory: HazardCategory;
    severityLevel: number;
    rawLocation: string;
    lat: number | null;
    lng: number | null;
    transcript: string;
    transcriptMock: boolean;
    translatedEnglish: string | null;
    actionRequired: ActionRequired;
    status: ReportStatus;
    estimatedPreventedInr: number | null;
    isSynthetic: boolean;
    wardId: string | null;
    createdAt: Date;
  }> = [];

  let hexCounter = 1;

  // A. Generate Baseline Rows (subject to pure Pareto distribution)
  for (let i = 0; i < baselineCount; i++) {
    const wardIdx = pickWeightedIndex(wardWeights, rng());
    if (wardIdx < 25) {
      baselineTop25Count++;
    }

    const chosenWardFeat = wardFeatures[wardIdx]!;
    const catIdx = pickWeightedIndex(categoryWeights, rng());
    const chosenCategory = categories[catIdx]!;

    // Modulate timestamp across 90 days with hour weights
    const dayOffsetMs = rng() * NINETY_DAYS_MS;
    const baseDate = new Date(nowMs - dayOffsetMs);
    const chosenHour = pickWeightedIndex(hourWeights, rng());
    const chosenMinute = Math.floor(rng() * 60);
    const chosenSecond = Math.floor(rng() * 60);
    baseDate.setUTCHours(chosenHour, chosenMinute, chosenSecond, 0);
    const timestampMs = baseDate.getTime();

    const wardName = String(chosenWardFeat.properties?.ward_name || chosenWardFeat.properties?.WARD_NAME || "Delhi Ward");
    const wardIdProp = String(chosenWardFeat.properties?.ward_id || "");
    const wardDbId = wardDbMap.get(wardIdProp) || null;

    const sampledPt = samplePointInPolygon(chosenWardFeat, rng);
    const lng = sampledPt ? sampledPt[0] : null;
    const lat = sampledPt ? sampledPt[1] : null;

    let severityLevel: number;
    if (chosenCategory === "biohazard_medical" || chosenCategory === "chemical") {
      severityLevel = 6 + Math.floor(rng() * 5); // 6 to 10
    } else if (chosenCategory === "electrical_hazard") {
      severityLevel = 5 + Math.floor(rng() * 6); // 5 to 10
    } else if (chosenCategory === "construction_debris") {
      severityLevel = 3 + Math.floor(rng() * 6); // 3 to 8
    } else {
      severityLevel = 1 + Math.floor(rng() * 8); // 1 to 8
    }

    const actionRequired = getActionRequired(chosenCategory, severityLevel);

    let rawLocation = wardName;
    if (lat && lng && landmarks.length > 0) {
      const nearby = landmarks.find((lm) => Math.hypot(lm.lat - lat, lm.lng - lng) < 0.03);
      if (nearby) {
        rawLocation = `${wardName}, near ${nearby.name}`;
      }
    }

    const templates = TRANSCRIPT_TEMPLATES[chosenCategory] || TRANSCRIPT_TEMPLATES.general_overflow;
    const tmpl = templates[Math.floor(rng() * templates.length)] || "{ward}";
    const transcript = tmpl.replace(/{ward}/g, wardName);

    const hexId = (seed + hexCounter).toString(16).toUpperCase().padStart(8, "0");
    hexCounter++;
    const reportId = `SYN-${hexId}`;

    recordsToInsert.push({
      id: reportId,
      hazardCategory: chosenCategory,
      severityLevel,
      rawLocation,
      lat,
      lng,
      transcript,
      transcriptMock: false,
      translatedEnglish: null,
      actionRequired: actionRequired as ActionRequired,
      status: ReportStatus.OPEN,
      estimatedPreventedInr: severityLevel * 2500,
      isSynthetic: true,
      wardId: wardDbId,
      createdAt: new Date(timestampMs),
    });

    categoryStats[chosenCategory] = (categoryStats[chosenCategory] || 0) + 1;
    wardIncidentStats.set(wardName, (wardIncidentStats.get(wardName) || 0) + 1);

    const weekAge = Math.floor((nowMs - timestampMs) / (7 * 24 * 60 * 60 * 1000));
    if (weekAge >= 0 && weekAge < 13) {
      weeklyStats[weekAge] = (weeklyStats[weekAge] || 0) + 1;
    }
  }

  const paretoBaselineSharePct = ((baselineTop25Count / baselineCount) * 100).toFixed(2);
  console.log(`\nPareto Check (before spikes): Top 25 wards hold ${baselineTop25Count} of ${baselineCount} baseline rows (${paretoBaselineSharePct}%). Target: ~60%`);

  // B. Generate Planted Spikes (added ON TOP of normal traffic in the last 7 days)
  console.log("\nPlanted Spikes Added on Top of Normal Traffic (Most Recent 7 Days):");
  for (const spike of plantedSpikes) {
    console.log(`- Ward: ${spike.wardName}, Category: ${spike.category}, Spike Count: ${spike.count}`);
    const chosenWardFeat = wardFeatures[spike.index]!;
    const wardName = spike.wardName;
    const wardIdProp = String(chosenWardFeat.properties?.ward_id || "");
    const wardDbId = wardDbMap.get(wardIdProp) || null;
    const chosenCategory = spike.category;

    for (let k = 0; k < spike.count; k++) {
      // Recent 7 days
      const timestampMs = nowMs - rng() * SEVEN_DAYS_MS;
      const sampledPt = samplePointInPolygon(chosenWardFeat, rng);
      const lng = sampledPt ? sampledPt[0] : null;
      const lat = sampledPt ? sampledPt[1] : null;

      let severityLevel: number;
      if (chosenCategory === "biohazard_medical" || chosenCategory === "chemical") {
        severityLevel = 6 + Math.floor(rng() * 5);
      } else if (chosenCategory === "electrical_hazard") {
        severityLevel = 5 + Math.floor(rng() * 6);
      } else {
        severityLevel = 2 + Math.floor(rng() * 7);
      }

      const actionRequired = getActionRequired(chosenCategory, severityLevel);

      let rawLocation = wardName;
      if (lat && lng && landmarks.length > 0) {
        const nearby = landmarks.find((lm) => Math.hypot(lm.lat - lat, lm.lng - lng) < 0.03);
        if (nearby) {
          rawLocation = `${wardName}, near ${nearby.name}`;
        }
      }

      const templates = TRANSCRIPT_TEMPLATES[chosenCategory] || TRANSCRIPT_TEMPLATES.general_overflow;
      const tmpl = templates[Math.floor(rng() * templates.length)] || "{ward}";
      const transcript = tmpl.replace(/{ward}/g, wardName);

      const hexId = (seed + hexCounter).toString(16).toUpperCase().padStart(8, "0");
      hexCounter++;
      const reportId = `SYN-${hexId}`;

      recordsToInsert.push({
        id: reportId,
        hazardCategory: chosenCategory,
        severityLevel,
        rawLocation,
        lat,
        lng,
        transcript,
        transcriptMock: false,
        translatedEnglish: null,
        actionRequired: actionRequired as ActionRequired,
        status: ReportStatus.OPEN,
        estimatedPreventedInr: severityLevel * 2500,
        isSynthetic: true,
        wardId: wardDbId,
        createdAt: new Date(timestampMs),
      });

      categoryStats[chosenCategory] = (categoryStats[chosenCategory] || 0) + 1;
      wardIncidentStats.set(wardName, (wardIncidentStats.get(wardName) || 0) + 1);

      weeklyStats[0] = (weeklyStats[0] || 0) + 1; // W0
    }
  }

  // Print generated distribution summary
  console.log("\n=== GENERATED INCIDENT SUMMARY ===");
  console.log("Rows per Category:");
  for (const [cat, cnt] of Object.entries(categoryStats)) {
    const pct = ((cnt / count) * 100).toFixed(1);
    console.log(`  - ${cat}: ${cnt} (${pct}%)`);
  }

  console.log("\nRows per Week (W0 = most recent 7 days):");
  for (let w = 0; w < weeklyStats.length; w++) {
    console.log(`  - Week ${w} (W-${w}): ${weeklyStats[w]}`);
  }

  // W0 vs average of W-1 to W-4
  const w0 = weeklyStats[0] || 0;
  const prior4Weeks = [weeklyStats[1] || 0, weeklyStats[2] || 0, weeklyStats[3] || 0, weeklyStats[4] || 0];
  const avgPrior4 = prior4Weeks.reduce((a, b) => a + b, 0) / 4;
  const spikeRatio = avgPrior4 > 0 ? (w0 / avgPrior4).toFixed(2) : "N/A";
  console.log(`\nSpike Ratio: W0 = ${w0}, Avg(W-1..W-4) = ${avgPrior4.toFixed(1)}, Spike Ratio (W0 / Avg) = ${spikeRatio}x (Target: ~1.2 to 1.5x)`);

  const sortedWards = Array.from(wardIncidentStats.entries()).sort((a, b) => b[1] - a[1]);
  console.log("\nTop 10 Wards by Overall Volume:");
  for (let i = 0; i < Math.min(10, sortedWards.length); i++) {
    const [wName, cnt] = sortedWards[i]!;
    const pct = ((cnt / count) * 100).toFixed(1);
    console.log(`  ${i + 1}. ${wName}: ${cnt} (${pct}%)`);
  }

  if (dryRun) {
    console.log("\n[DRY-RUN] Finished simulating 10k generation. Database was NOT queried or modified.");
    return;
  }

  // Insert batches into database
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    console.log(`\nInserting ${recordsToInsert.length} records into Postgres in batches of 1000...`);
    const BATCH_SIZE = 1000;
    let insertedTotal = 0;

    for (let i = 0; i < recordsToInsert.length; i += BATCH_SIZE) {
      const batch = recordsToInsert.slice(i, i + BATCH_SIZE);
      const res = await prisma.report.createMany({
        data: batch,
        skipDuplicates: true,
      });
      insertedTotal += res.count;
      console.log(`Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${res.count} records (Total: ${insertedTotal})`);
    }

    console.log(`Successfully completed insertion of ${insertedTotal} synthetic records.`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const args = process.argv.slice(2);

  let count = 10000;
  const countIdx = args.indexOf("--count");
  if (countIdx !== -1 && args[countIdx + 1]) {
    count = parseInt(args[countIdx + 1]!, 10);
  }

  let seed = 42;
  const seedIdx = args.indexOf("--seed");
  if (seedIdx !== -1 && args[seedIdx + 1]) {
    seed = parseInt(args[seedIdx + 1]!, 10);
  }

  const dryRun = args.includes("--dry-run");
  const deleteBatch = args.includes("--delete-batch");

  await generateSyntheticData({ count, seed, dryRun, deleteBatch });
}

if (require.main === module || process.argv[1]?.includes("generate_synthetic_10k")) {
  main().catch((err) => {
    console.error("Generator execution failed:", err);
    process.exit(1);
  });
}
