import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "NOT_IMPLEMENTED" }, { status: 501 });
} // TODO: Implement feature
