import { PrismaClient, HazardCategory, ActionRequired, ReportStatus } from "@prisma/client";
import { seedReports } from "../src/data/seed_reports";
import { tagWardDb } from "../src/lib/spatial/wardsDb";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log("Starting database seeding...");

  // Check that the Ward table is populated
  const wardCount = await prisma.ward.count();
  if (wardCount === 0) {
    console.error("FATAL: Ward table is empty! Run `npm run db:import-wards` first before seeding.");
    process.exit(1);
  }

  console.log(`Found ${wardCount} wards in database.`);

  let seededCount = 0;
  let unresolvedCount = 0;
  const countsPerWard = new Map<string, number>();

  for (const rep of seedReports) {
    let resolvedWardDbId: string | null = null;
    
    if (rep.coordinates) {
      const tag = await tagWardDb(rep.coordinates.lat, rep.coordinates.lng);
      if (tag.status === "matched") {
        resolvedWardDbId = tag.db_id;
                countsPerWard.set(tag.ward_name, (countsPerWard.get(tag.ward_name) || 0) + 1);
      } else {
        console.warn(`Unresolved matched tag: status="${tag.status}" for report ${rep.report_id}`);
        unresolvedCount++;
        countsPerWard.set("UNRESOLVED", (countsPerWard.get("UNRESOLVED") || 0) + 1);
      }
    } else {
      console.warn(`Unmapped report coordinates for report ${rep.report_id}`);
      unresolvedCount++;
      countsPerWard.set("UNRESOLVED", (countsPerWard.get("UNRESOLVED") || 0) + 1);
    }

    const hazardCat = rep.hazard_category as HazardCategory;
    const actionReq = rep.action_required as ActionRequired;
    const createdAtDate = rep.createdAt ? new Date(rep.createdAt) : new Date();
    const lat = rep.coordinates ? rep.coordinates.lat : null;
    const lng = rep.coordinates ? rep.coordinates.lng : null;
    const transcriptText = rep.transcript || "";

    await prisma.report.upsert({
      where: { id: rep.report_id },
      create: {
        id: rep.report_id,
        hazardCategory: hazardCat,
        severityLevel: rep.severity_level,
        rawLocation: rep.raw_location,
        lat,
        lng,
        transcript: transcriptText,
        transcriptMock: true,
        actionRequired: actionReq,
        status: ReportStatus.OPEN,
        isSynthetic: true,
        wardId: resolvedWardDbId,
        createdAt: createdAtDate,
      },
      update: {
        hazardCategory: hazardCat,
        severityLevel: rep.severity_level,
        rawLocation: rep.raw_location,
        lat,
        lng,
        transcript: transcriptText,
        transcriptMock: true,
        actionRequired: actionReq,
        status: ReportStatus.OPEN,
        isSynthetic: true,
        wardId: resolvedWardDbId,
        createdAt: createdAtDate,
      },
    });

    seededCount++;
  }

  console.log("\n================ SEED SUMMARY ================");
  console.log(`Total seed reports processed: ${seededCount}`);
  console.log(`Unresolved ward count:        ${unresolvedCount}`);
  console.log("Counts per matched ward:");
  countsPerWard.forEach((count, name) => {
    console.log(`  - ${name}: ${count}`);
  });
  console.log("==============================================\n");

  if (unresolvedCount > 0) {
    console.error(`FATAL: Seeding finished with ${unresolvedCount} unresolved reports! Expected 0.`);
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error("Fatal error during seeding:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
