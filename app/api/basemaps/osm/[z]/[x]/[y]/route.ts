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
    return NextResponse.json({ error: "invalid_osm_tile_request" }, { status: 400 });
  }

  return proxyTile(`https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`, "image/png");
}
