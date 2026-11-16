import { describe, it, expect, afterAll } from "vitest";
import { tagWardDb } from "./wardsDb";
import { prisma } from "@/lib/db/prisma";

describe("tagWardDb (PostGIS integration)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("tags Connaught Place coordinates to NDMC CHARGE 2", async () => {
    const cpCoords = { lat: 28.6315, lng: 77.2167 };
    const res = await tagWardDb(cpCoords.lat, cpCoords.lng);
    expect(res.status).toBe("matched");
    if (res.status === "matched") {
      expect(res.ward_name).toBe("NDMC CHARGE 2");
      expect(res.external_id).toBe("NDMC_2-NDMC-CHARGE-2");
      expect(res.ward_id).toBe("NDMC_2");
      expect(res.db_id).toBeDefined();
    }
  });

  it("tags Greater Kailash-I point from seed HZ-1031 to externalId 192-GREATER-KAILASH-I", async () => {
    const gkCoords = { lat: 28.55, lng: 77.254 };
    const res = await tagWardDb(gkCoords.lat, gkCoords.lng);
    expect(res.status).toBe("matched");
    if (res.status === "matched") {
      expect(res.ward_name).toBe("GREATER KAILASH-I");
      expect(res.external_id).toBe("192-GREATER-KAILASH-I");
      expect(res.ward_id).toBe("192");
      expect(res.db_id).toBeDefined();
    }
  });

  it("returns invalid_coordinates for point in the Arabian Sea", async () => {
    const arabianSea = { lat: 18.922, lng: 72.834 };
    const res = await tagWardDb(arabianSea.lat, arabianSea.lng);
    expect(res).toEqual({ status: "invalid_coordinates" });
  });

  it("returns invalid_coordinates for lat/lng swapped point", async () => {
    // 28.6315, 77.2167 passed as lat=77.2167, lng=28.6315
    const res = await tagWardDb(77.2167, 28.6315);
    expect(res).toEqual({ status: "invalid_coordinates" });
  });
});
