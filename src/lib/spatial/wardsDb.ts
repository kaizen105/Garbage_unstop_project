import "server-only";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

export const DELHI_BOUNDS = {
  minLon: 76.7,
  maxLon: 77.6,
  minLat: 28.3,
  maxLat: 29.0,
} as const;

export class WardDbError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WardDbError";
  }
}

/**
 * Pure coordinate validation function for Delhi bounds.
 * Can be tested in unit test suite without DB connection.
 */
export function validateDelhiCoordinates(
  lat: unknown,
  lng: unknown
): { valid: true; lat: number; lng: number } | { valid: false } {
  if (typeof lat !== "number" || typeof lng !== "number") {
    return { valid: false };
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { valid: false };
  }

  if (
    lng < DELHI_BOUNDS.minLon ||
    lng > DELHI_BOUNDS.maxLon ||
    lat < DELHI_BOUNDS.minLat ||
    lat > DELHI_BOUNDS.maxLat
  ) {
    return { valid: false };
  }

  return { valid: true, lat, lng };
}

export type DbWardTag =
  | { status: "matched"; ward_id: string; ward_name: string; external_id: string; db_id: string }
  | { status: "unmapped" }
  | { status: "invalid_coordinates" };

/**
 * Tags a point coordinate (lat, lng) to a Delhi ward using PostGIS ST_Covers.
 * Server-only function for the write path.
 */
export async function tagWardDb(lat: number, lng: number): Promise<DbWardTag> {
  const validation = validateDelhiCoordinates(lat, lng);
  if (!validation.valid) {
    return { status: "invalid_coordinates" };
  }

  try {
    const rows = await prisma.$queryRaw<
      { id: string; externalId: string; name: string; sourceWardId: string | null }[]
    >(Prisma.sql`
      SELECT id, "externalId", name, "sourceWardId"
      FROM "Ward"
      WHERE ST_Covers(geom, ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326))
      ORDER BY "externalId"
      LIMIT 1;
    `);

    if (!rows || rows.length === 0) {
      return { status: "unmapped" };
    }

    const row = rows[0];
    if (!row) {
      return { status: "unmapped" };
    }

    // Original GeoJSON ward_id stored in sourceWardId (fallback to prefix before "-" if null)
    let wardId = row.sourceWardId;
    if (!wardId) {
      const dashIdx = row.externalId.indexOf("-");
      wardId = dashIdx !== -1 ? row.externalId.substring(0, dashIdx) : row.externalId;
    }

    return {
      status: "matched",
      ward_id: wardId,
      ward_name: row.name,
      external_id: row.externalId,
      db_id: row.id,
    };
  } catch (err: unknown) {
    console.error("[tagWardDb PostGIS Query Error]:", { lat, lng, error: err });
    throw new WardDbError("Failed to query ward from spatial database", err);
  }
}
