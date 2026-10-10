import wardsData from "../../../data/delhi_wards.json";
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(wardsData, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400"
    }
  });
}
