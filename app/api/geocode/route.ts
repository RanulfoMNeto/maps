import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("polygon_geojson", "1");
  url.searchParams.set("limit", "6");
  url.searchParams.set("q", query);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "sentinel-environmental-maps/0.1 contact=local-dev"
      },
      next: { revalidate: 86400 }
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "geocoder_unavailable", message: `Nominatim retornou HTTP ${response.status}.` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const results = data.map(
      (item: {
        place_id: number;
        display_name: string;
        lat: string;
        lon: string;
        boundingbox?: [string, string, string, string];
      }) => ({
        id: item.place_id,
        label: item.display_name,
        lat: Number(item.lat),
        lon: Number(item.lon),
        boundingBox: item.boundingbox?.map(Number)
      })
    );

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      {
        error: "geocoder_failed",
        message: error instanceof Error ? error.message : "Erro desconhecido na busca geográfica."
      },
      { status: 502 }
    );
  }
}
