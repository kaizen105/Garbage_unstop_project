import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";

const prisma = new PrismaClient();

// Slugify ward name: uppercase, non-alphanumerics -> "-", trimmed
export function slugWardName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Parse CLI arguments
function parseArgs(): { file: string; idProp: string; nameProp: string } {
  const args = process.argv.slice(2);
  let file = "data/delhi_wards.json";
  let idProp = "ward_id";
  let nameProp = "ward_name";

  for (let i = 0; i < args.length; i++) {
    const currentArg = args[i];
    const nextArg = args[i + 1];
    if (currentArg === "--file" && nextArg) {
      file = nextArg;
      i++;
    } else if (currentArg === "--id-prop" && nextArg) {
      idProp = nextArg;
      i++;
    } else if (currentArg === "--name-prop" && nextArg) {
      nameProp = nextArg;
      i++;
    }
  }

  return { file, idProp, nameProp };
}

// Zod schemas for GeoJSON
const PolygonGeometrySchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(z.array(z.number()))),
});

const MultiPolygonGeometrySchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(z.array(z.array(z.number())))),
});

const FeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.record(z.string(), z.unknown()),
  geometry: z.discriminatedUnion("type", [PolygonGeometrySchema, MultiPolygonGeometrySchema]),
});

const FeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(FeatureSchema),
});

function assertCoordinatesWithinBounds(
  features: z.infer<typeof FeatureSchema>[],
  bounds: { minLon: number; maxLon: number; minLat: number; maxLat: number }
): void {
  for (let fIdx = 0; fIdx < features.length; fIdx++) {
    const feat = features[fIdx];
    if (!feat) continue;
    const geom = feat.geometry;

    const checkPoint = (lon: number, lat: number) => {
      if (
        lon < bounds.minLon ||
        lon > bounds.maxLon ||
        lat < bounds.minLat ||
        lat > bounds.maxLat
      ) {
        throw new Error(
          `Coordinate bounds check failed at feature ${fIdx}: [lon: ${lon}, lat: ${lat}] is outside [lon: ${bounds.minLon}-${bounds.maxLon}, lat: ${bounds.minLat}-${bounds.maxLat}]. Possible lat/lng swap.`
        );
      }
    };

    if (geom.type === "Polygon") {
      for (const ring of geom.coordinates) {
        for (const pt of ring) {
          const lon = pt[0];
          const lat = pt[1];
          if (lon === undefined || lat === undefined || pt.length < 2) {
            throw new Error(`Invalid coordinate length at feature ${fIdx}`);
          }
          checkPoint(lon, lat);
        }
      }
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        for (const ring of poly) {
          for (const pt of ring) {
            const lon = pt[0];
            const lat = pt[1];
            if (lon === undefined || lat === undefined || pt.length < 2) {
              throw new Error(`Invalid coordinate length at feature ${fIdx}`);
            }
            checkPoint(lon, lat);
          }
        }
      }
    }
  }
}

async function verifyAndEnsurePostgis(
  tx: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">
): Promise<void> {
  try {
    const versionRes = await tx.$queryRaw<{ postgis_version: string }[]>`SELECT postgis_version();`;
    console.log(`PostGIS verified: ${versionRes[0]?.postgis_version}`);
  } catch {
    console.warn("postgis_version() failed, attempting CREATE EXTENSION IF NOT EXISTS postgis...");
    await tx.$executeRaw`CREATE EXTENSION IF NOT EXISTS postgis;`;
    const checkRes = await tx.$queryRaw<{ postgis_version: string }[]>`SELECT postgis_version();`;
    console.log(`PostGIS initialized and verified: ${checkRes[0]?.postgis_version}`);
  }
}

interface GroupedWard {
  externalId: string;
  wardId: string;
  name: string;
  geometries: z.infer<typeof FeatureSchema>["geometry"][];
}

async function main(): Promise<void> {
  const { file, idProp, nameProp } = parseArgs();
  console.log(`Starting ward import from file: ${file}`);
  console.log(`Mapping properties: idProp="${idProp}", nameProp="${nameProp}"`);

  const resolvedPath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: GeoJSON file not found at ${resolvedPath}`);
    process.exit(1);
  }

  let rawData: unknown;
  try {
    const rawContent = fs.readFileSync(resolvedPath, "utf-8");
    rawData = JSON.parse(rawContent);
  } catch (err) {
    console.error(`Error reading or parsing JSON from ${resolvedPath}:`, err);
    process.exit(1);
  }

  const parseResult = FeatureCollectionSchema.safeParse(rawData);
  if (!parseResult.success) {
    console.error("GeoJSON failed Zod validation:", parseResult.error.format());
    process.exit(1);
  }

  const featureCollection = parseResult.data;
  console.log(`Validated ${featureCollection.features.length} GeoJSON features.`);

  // Assert coordinate boundaries: lon 76.7-77.6, lat 28.3-29.0
  const DELHI_BOUNDS = { minLon: 76.7, maxLon: 77.6, minLat: 28.3, maxLat: 29.0 };
  try {
    assertCoordinatesWithinBounds(featureCollection.features, DELHI_BOUNDS);
    console.log(`Coordinate bounds assertion passed: all points strictly within lon [76.7, 77.6], lat [28.3, 29.0].`);
  } catch (boundErr) {
    console.error(`Bounds assertion error:`, boundErr);
    process.exit(1);
  }

  // --- REQUIREMENT 1: Duplicate id detection & collision vs split ward check ---
  // If a duplicate id has DIFFERENT names, that is a key collision (do NOT merge geometries).
  // Only merge when id AND name are identical (a genuinely split ward).
  const idOccurrences = new Map<string, { index: number; name: string }[]>();
  for (let i = 0; i < featureCollection.features.length; i++) {
    const feat = featureCollection.features[i];
    if (!feat) continue;
    const rawId = feat.properties[idProp];
    const rawName = feat.properties[nameProp];
    if (rawId === undefined || rawId === null || String(rawId).trim() === "") {
      throw new Error(`Feature at index ${i} missing required id property "${idProp}"`);
    }
    if (rawName === undefined || rawName === null || String(rawName).trim() === "") {
      throw new Error(`Feature at index ${i} missing required name property "${nameProp}"`);
    }
    const wid = String(rawId).trim();
    const wname = String(rawName).trim();
    const existing = idOccurrences.get(wid) ?? [];
    existing.push({ index: i, name: wname });
    idOccurrences.set(wid, existing);
  }

  console.log("Checking for duplicate ward_ids in dataset...");
  for (const [wid, occs] of idOccurrences.entries()) {
    if (occs.length > 1) {
      const distinctNames = Array.from(new Set(occs.map((o) => o.name)));
      if (distinctNames.length > 1) {
        console.log(
          `Detected key collision on ward_id "${wid}" across indices [${occs.map((o) => o.index).join(", ")}] with different names: ${JSON.stringify(distinctNames)}. Geometries will NOT be merged.`
        );
      } else {
        console.log(
          `Detected genuinely split ward on ward_id "${wid}" ("${distinctNames[0]}") across indices [${occs.map((o) => o.index).join(", ")}]. Geometries will be merged via ST_Union.`
        );
      }
    }
  }

  // --- REQUIREMENT 2 & 3: Make externalId unique & stable ---
  /**
   * externalId format: `${ward_id}-${slug(ward_name)}`
   * slug: uppercase, non-alphanumerics -> "-"
   * This guarantees that collisions like id "192" with "GREATER KAILASH-I" and "Ward 192"
   * produce separate stable externalIds ("192-GREATER-KAILASH-I" vs "192-WARD-192").
   * Genuinely split wards (same id AND same name) share the same externalId and are grouped for ST_Union.
   */
  const groupedWards = new Map<string, GroupedWard>();

  for (let i = 0; i < featureCollection.features.length; i++) {
    const feat = featureCollection.features[i];
    if (!feat) continue;
    const wid = String(feat.properties[idProp]).trim();
    const wname = String(feat.properties[nameProp]).trim();
    const slugName = slugWardName(wname);
    const externalId = `${wid}-${slugName}`;

    const existingGroup = groupedWards.get(externalId);
    if (existingGroup) {
      // Confirm id and name are identical for this group
      if (existingGroup.wardId !== wid || existingGroup.name !== wname) {
        throw new Error(
          `Unexpected slug collision for externalId "${externalId}": (id=${wid}, name="${wname}") vs (id=${existingGroup.wardId}, name="${existingGroup.name}")`
        );
      }
      existingGroup.geometries.push(feat.geometry);
    } else {
      groupedWards.set(externalId, {
        externalId,
        wardId: wid,
        name: wname,
        geometries: [feat.geometry],
      });
    }
  }

  const distinctKeysCount = groupedWards.size;
  console.log(`Computed ${distinctKeysCount} distinct stable externalId keys from ${featureCollection.features.length} features.`);

  const readCount = featureCollection.features.length;
  let insertedCount = 0;
  let updatedCount = 0;
  let invalidAfterRepairCount = 0;

  await prisma.$transaction(async (tx) => {
    await verifyAndEnsurePostgis(tx);

    // --- REQUIREMENT 4: Cleanup existing wards with obsolete externalIds ---
    // Delete Wards whose externalId is not in the new key set ONLY IF they have no Report/User/AuditRun references.
    const allExistingWards = await tx.$queryRaw<{ id: string; externalId: string }[]>`
      SELECT "id", "externalId" FROM "Ward";
    `;

    const obsoleteWards = allExistingWards.filter((w) => !groupedWards.has(w.externalId));
    if (obsoleteWards.length > 0) {
      console.log(`Found ${obsoleteWards.length} existing Ward row(s) with obsolete externalId keys: ${obsoleteWards.map((w) => w.externalId).join(", ")}`);
      
      for (const obs of obsoleteWards) {
        const reportRefs = await tx.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint as count FROM "Report" WHERE "wardId" = ${obs.id};
        `;
        const userRefs = await tx.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint as count FROM "User" WHERE "wardId" = ${obs.id};
        `;
        const auditRefs = await tx.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint as count FROM "AuditRun" WHERE "wardId" = ${obs.id};
        `;

        const rCount = Number(reportRefs[0]?.count ?? BigInt(0));
        const uCount = Number(userRefs[0]?.count ?? BigInt(0));
        const aCount = Number(auditRefs[0]?.count ?? BigInt(0));

        if (rCount > 0 || uCount > 0 || aCount > 0) {
          throw new Error(
            `Cannot clean up obsolete Ward externalId "${obs.externalId}" (id: ${obs.id}): referenced by ${rCount} Reports, ${uCount} Users, ${aCount} AuditRuns. Aborting transaction.`
          );
        }

        console.log(`Deleting unreferenced obsolete Ward row externalId="${obs.externalId}" (id: ${obs.id})...`);
        await tx.$executeRaw`DELETE FROM "Ward" WHERE "id" = ${obs.id};`;
      }
    }

    // --- Upsert each grouped ward ---
    for (const ward of groupedWards.values()) {
      let validityCheck: { is_valid: boolean }[];

      if (ward.geometries.length === 1) {
        const geojsonStr = JSON.stringify(ward.geometries[0]);

        validityCheck = await tx.$queryRaw<{ is_valid: boolean }[]>`
          SELECT ST_IsValid(
            ST_Multi(
              ST_CollectionExtract(
                ST_MakeValid(
                  ST_SetSRID(ST_GeomFromGeoJSON(${geojsonStr}), 4326)
                ),
                3
              )
            )
          ) as is_valid;
        `;

        const existing = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Ward" WHERE "externalId" = ${ward.externalId} LIMIT 1;
        `;

        await tx.$executeRaw`
          INSERT INTO "Ward" ("id", "externalId", "name", "sourceWardId", "geom")
          VALUES (
            gen_random_uuid()::text,
            ${ward.externalId},
            ${ward.name},
            ${ward.wardId},
            ST_Multi(
              ST_CollectionExtract(
                ST_MakeValid(
                  ST_SetSRID(ST_GeomFromGeoJSON(${geojsonStr}), 4326)
                ),
                3
              )
            )
          )
          ON CONFLICT ("externalId") DO UPDATE SET
            "name" = EXCLUDED."name",
            "sourceWardId" = EXCLUDED."sourceWardId",
            "geom" = EXCLUDED."geom";
        `;

        if (existing.length > 0) {
          updatedCount++;
        } else {
          insertedCount++;
        }
      } else {
        // Genuinely split ward: merge geometries using ST_Union
        console.log(`Merging ${ward.geometries.length} geometries for split ward "${ward.externalId}" ("${ward.name}")...`);
        
        // Build array of GeoJSON geometries in SQL
        const geojsonArray = ward.geometries.map((g) => JSON.stringify(g));
        validityCheck = await tx.$queryRaw<{ is_valid: boolean }[]>`
          SELECT ST_IsValid(
            ST_Multi(
              ST_CollectionExtract(
                ST_MakeValid(
                  ST_Union(
                    ARRAY(
                      SELECT ST_SetSRID(ST_GeomFromGeoJSON(g), 4326)
                      FROM unnest(${geojsonArray}::text[]) AS g
                    )
                  )
                ),
                3
              )
            )
          ) as is_valid;
        `;

        const existing = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Ward" WHERE "externalId" = ${ward.externalId} LIMIT 1;
        `;

        await tx.$executeRaw`
          INSERT INTO "Ward" ("id", "externalId", "name", "sourceWardId", "geom")
          VALUES (
            gen_random_uuid()::text,
            ${ward.externalId},
            ${ward.name},
            ${ward.wardId},
            ST_Multi(
              ST_CollectionExtract(
                ST_MakeValid(
                  ST_Union(
                    ARRAY(
                      SELECT ST_SetSRID(ST_GeomFromGeoJSON(g), 4326)
                      FROM unnest(${geojsonArray}::text[]) AS g
                    )
                  )
                ),
                3
              )
            )
          )
          ON CONFLICT ("externalId") DO UPDATE SET
            "name" = EXCLUDED."name",
            "sourceWardId" = EXCLUDED."sourceWardId",
            "geom" = EXCLUDED."geom";
        `;

        if (existing.length > 0) {
          updatedCount++;
        } else {
          insertedCount++;
        }
      }

      if (!validityCheck[0]?.is_valid) {
        invalidAfterRepairCount++;
        console.warn(`Ward ${ward.externalId} (${ward.name}) remains invalid after repair.`);
      }
    }

    // REQUIREMENT 3 assertion: Ward row count == number of distinct keys == 290
    const finalWardCountRows = await tx.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint as count FROM "Ward";
    `;
    const finalWardCount = Number(finalWardCountRows[0]?.count ?? BigInt(0));

    console.log(`Assertion check: Final Ward row count in DB = ${finalWardCount}, Distinct keys = ${distinctKeysCount}`);
    if (finalWardCount !== distinctKeysCount) {
      throw new Error(
        `Assertion failed: Ward row count (${finalWardCount}) does not match number of distinct keys (${distinctKeysCount}).`
      );
    }
  }, {
    timeout: 180000, // 3 minutes
  });

  console.log("\n================ WARD IMPORT SUMMARY ================");
  console.log(`Features read:              ${readCount}`);
  console.log(`Distinct keys derived:      ${distinctKeysCount}`);
  console.log(`Wards inserted:             ${insertedCount}`);
  console.log(`Wards updated:              ${updatedCount}`);
  console.log(`Invalid after repair count: ${invalidAfterRepairCount}`);
  console.log("=====================================================\n");
}

main()
  .catch((err) => {
    console.error("Fatal error during ward import:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
