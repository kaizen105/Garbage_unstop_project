import { NextResponse } from "next/server";
import { fetchRoute } from "@/lib/routing/router";
import { z } from "zod";

const RouteSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const { lat, lng } = RouteSchema.parse(json);
    const routes = await fetchRoute({ lat, lng });
    return NextResponse.json(routes);
  } catch {
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
