import { describe, it, expect } from "vitest";
import { toReportDTO, PrismaReportWithWard } from "./mapper";
import { HazardCategory, ActionRequired, ReportStatus } from "@prisma/client";

describe("toReportDTO", () => {
  it("maps a full Prisma report with joined ward to client Report shape", () => {
    const mockRow: PrismaReportWithWard = {
      id: "HZ-12345678",
      hazardCategory: HazardCategory.biohazard_medical,
      severityLevel: 8,
      rawLocation: "Karol Bagh",
      lat: 28.6448,
      lng: 77.1891,
      transcript: "Medical waste",
      transcriptMock: false,
      translatedEnglish: "Medical waste dumped",
      actionRequired: ActionRequired.dispatch_hazmat_bypass_standard,
      status: ReportStatus.OPEN,
      estimatedPreventedInr: 50000,
      isSynthetic: false,
      reporterId: null,
      wardId: "ward-cuid-1",
      createdAt: new Date("2026-03-01T10:00:00.000Z"),
      resolvedAt: null,
      ward: {
        id: "ward-cuid-1",
        externalId: "KB_1-KAROL-BAGH",
        name: "KAROL BAGH",
        sourceWardId: "KB_1",
      },
    };

    const dto = toReportDTO(mockRow);
    expect(dto).toEqual({
      report_id: "HZ-12345678",
      hazard_category: "biohazard_medical",
      severity_level: 8,
      raw_location: "Karol Bagh",
      coordinates: { lat: 28.6448, lng: 77.1891 },
      action_required: "dispatch_hazmat_bypass_standard",
      ward: {
        status: "matched",
        ward_id: "KB_1",
        ward_name: "KAROL BAGH",
        external_id: "KB_1-KAROL-BAGH",
      },
      createdAt: "2026-03-01T10:00:00.000Z",
      transcript: "Medical waste",
      translated_english: "Medical waste dumped",
    });
  });

  it("maps a report with null lat/lng correctly to coordinates: null", () => {
    const mockRow: PrismaReportWithWard = {
      id: "HZ-87654321",
      hazardCategory: HazardCategory.general_overflow,
      severityLevel: 4,
      rawLocation: "Unknown location",
      lat: null,
      lng: null,
      transcript: "Kachra overflow",
      transcriptMock: true,
      translatedEnglish: null,
      actionRequired: ActionRequired.routine_collection,
      status: ReportStatus.OPEN,
      estimatedPreventedInr: null,
      isSynthetic: false,
      reporterId: null,
      wardId: null,
      createdAt: new Date("2026-03-01T11:00:00.000Z"),
      resolvedAt: null,
      ward: null,
    };

    const dto = toReportDTO(mockRow);
    expect(dto.coordinates).toBeNull();
    expect(dto.ward).toEqual({
      status: "unmapped",
      ward_id: null,
      ward_name: null,
    });
    expect(dto.translated_english).toBeNull();
  });

  it("handles duplicate key collisions correctly in ward_id extraction", () => {
    const mockRow: PrismaReportWithWard = {
      id: "HZ-11112222",
      hazardCategory: HazardCategory.construction_debris,
      severityLevel: 5,
      rawLocation: "Greater Kailash",
      lat: 28.55,
      lng: 77.254,
      transcript: "Construction debris",
      transcriptMock: false,
      translatedEnglish: null,
      actionRequired: ActionRequired.routine_collection,
      status: ReportStatus.OPEN,
      estimatedPreventedInr: null,
      isSynthetic: false,
      reporterId: null,
      wardId: "gk-cuid",
      createdAt: new Date("2026-03-01T12:00:00.000Z"),
      resolvedAt: null,
      ward: {
        id: "gk-cuid",
        externalId: "192-GREATER-KAILASH-I",
        name: "GREATER KAILASH-I",
        sourceWardId: "192",
      },
    };

    const dto = toReportDTO(mockRow);
    expect(dto.ward).toEqual({
      status: "matched",
      ward_id: "192",
      ward_name: "GREATER KAILASH-I",
      external_id: "192-GREATER-KAILASH-I",
    });
  });
});
