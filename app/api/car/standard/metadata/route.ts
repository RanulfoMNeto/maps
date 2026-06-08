import { NextResponse } from "next/server";
import { getStandardCarMetadata } from "@/app/lib/standardCarServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getStandardCarMetadata());
}
