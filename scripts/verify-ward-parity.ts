import { PrismaClient, Prisma } from "@prisma/client";
import { seedReports } from "../src/data/seed_reports";
import { tagWardTurf } from "../src/lib/spatial/wards";
import { tagWardDb, DELHI_BOUNDS } from "../src/lib/spatial/wardsDb";

const prisma = new PrismaClient();

// Mulberry32 deterministic 32-bit PRNG
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function getCoversCount(lat: number, lng: number): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint as count
    FROM "Ward"
    WHERE ST_Covers(geom, ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326));
  `);
  return Number(rows[0]?.count ?? BigInt(0));
}

async function main(): Promise<void> {
  console.log("================ WARD TAGGING PARITY VERIFICATION ================\n");

  // --- PART A: All 60 seed coordinates ---
  console.log("--- PART A: Verifying 60 seed report coordinates ---");
  let seedAgree = 0;
  let seedDisagree = 0;
  const seedDisagreements: {
    reportId: string;
    point: { lat: number; lng: number };
    turfTag: unknown;
    dbTag: unknown;
    coversCount: number;
  }[] = [];

  for (const rep of seedReports) {
    if (!rep.coordinates) continue;
    const turfRes = tagWardTurf(rep.coordinates);
    const dbRes = await tagWardDb(rep.coordinates.lat, rep.coordinates.lng);

    const turfKey = turfRes.status === "matched" ? turfRes.external_id : turfRes.status;
    const dbKey = dbRes.status === "matched" ? dbRes.external_id : dbRes.status;

    if (turfKey === dbKey) {
      seedAgree++;
    } else {
      seedDisagree++;
      const coversCount = await getCoversCount(rep.coordinates.lat, rep.coordinates.lng);
      seedDisagreements.push({
        reportId: rep.report_id,
        point: rep.coordinates,
        turfTag: turfRes,
        dbTag: dbRes,
        coversCount,
      });
    }
  }

  console.log(`Seed Points Total: ${seedReports.length}`);
  console.log(`Seed Points Agree: ${seedAgree}`);
  console.log(`Seed Points Disagree: ${seedDisagree}`);

  if (seedDisagreements.length > 0) {
    console.error("\nSeed Disagreements Details:");
    for (const d of seedDisagreements) {
      console.error(
        `Report ${d.reportId} at [${d.point.lng}, ${d.point.lat}]:\n  Turf: ${JSON.stringify(d.turfTag)}\n  Db:   ${JSON.stringify(d.dbTag)}\n  Covers count: ${d.coversCount}`
      );
    }
  }

  // --- PART B: 2000 random points inside Delhi bounds with mulberry32 ---
  console.log("\n--- PART B: Verifying 2000 random points uniformly inside Delhi bounds ---");
  const rng = mulberry32(42); // Fixed reproducible seed
  const RANDOM_POINTS_COUNT = 2000;
  let randomAgree = 0;
  let randomDisagree = 0;
  const randomDisagreements: {
    point: { lat: number; lng: number };
    turfTag: unknown;
    dbTag: unknown;
    coversCount: number;
  }[] = [];

  for (let i = 0; i < RANDOM_POINTS_COUNT; i++) {
    // Generate uniform random within Delhi bounds
    const lng = DELHI_BOUNDS.minLon + rng() * (DELHI_BOUNDS.maxLon - DELHI_BOUNDS.minLon);
    const lat = DELHI_BOUNDS.minLat + rng() * (DELHI_BOUNDS.maxLat - DELHI_BOUNDS.minLat);

    const turfRes = tagWardTurf({ lat, lng });
    const dbRes = await tagWardDb(lat, lng);

    const turfKey = turfRes.status === "matched" ? turfRes.external_id : turfRes.status;
    const dbKey = dbRes.status === "matched" ? dbRes.external_id : dbRes.status;

    if (turfKey === dbKey) {
      randomAgree++;
    } else {
      randomDisagree++;
      if (randomDisagreements.length < 20) {
        const coversCount = await getCoversCount(lat, lng);
        randomDisagreements.push({
          point: { lat, lng },
          turfTag: turfRes,
          dbTag: dbRes,
          coversCount,
        });
      }
    }
  }

  const disagreementPct = (randomDisagree / RANDOM_POINTS_COUNT) * 100;
  console.log(`Random Points Total:      ${RANDOM_POINTS_COUNT}`);
  console.log(`Random Points Agree:      ${randomAgree}`);
  console.log(`Random Points Disagree:   ${randomDisagree} (${disagreementPct.toFixed(2)}%)`);

  if (randomDisagreements.length > 0) {
    console.log(`\nSample Random Disagreements (showing first ${randomDisagreements.length}):`);
    for (const d of randomDisagreements) {
      console.log(
        `Point [lon: ${d.point.lng.toFixed(5)}, lat: ${d.point.lat.toFixed(5)}]:\n  Turf: ${JSON.stringify(d.turfTag)}\n  Db:   ${JSON.stringify(d.dbTag)}\n  Covers count: ${d.coversCount}`
      );
    }
  }

  console.log("\n===================================================================\n");

  if (seedDisagree > 0) {
    console.error(`FATAL: ${seedDisagree} seed points disagreed between Turf and PostGIS!`);
    process.exit(1);
  }

  if (disagreementPct > 1.0) {
    console.error(`FATAL: Random point disagreement ${disagreementPct.toFixed(2)}% exceeds 1.0% threshold!`);
    process.exit(1);
  }

  console.log("Parity verification passed successfully!");
}

main()
  .catch((err) => {
    console.error("Fatal error during parity verification:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
