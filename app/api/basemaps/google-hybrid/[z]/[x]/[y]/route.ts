import { NextResponse } from "next/server";
import { parseTileParams, proxyTile } from "@/app/lib/basemapProxy";

type Params = {
  z: string;
  x: string;
  y: string;
};

export async function GET(_request: Request, context: { params: Promise<Params> }) {
  const params = await context.params;
  const tile = parseTileParams(params);

  if (!tile) {
    return NextResponse.json({ error: "invalid_google_hybrid_tile_request" }, { status: 400 });
  }

  const server = Math.abs(tile.x + tile.y) % 4;
  return proxyTile(`https://mt${server}.google.com/vt/lyrs=y&x=${tile.x}&y=${tile.y}&z=${tile.z}`, "image/jpeg");
}
