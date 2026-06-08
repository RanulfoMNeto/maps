"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import type { CarImport } from "@/app/lib/car";
import { GeoJsonPolygon, RasterLayer, SpectralIndex } from "@/app/lib/indices";
import type { StandardCarMapFilters, StandardCarMapLayer } from "@/app/lib/standardCarCatalog";

export type BaseMapKey = "osm" | "google_hybrid" | "sentinel_rgb";

export type LayerPalette = {
  low: string;
  midLow: string;
  midHigh: string;
  high: string;
};

export type DrawingStyle = {
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  fillOpacity: number;
};

export type ManagedCarMapItem = {
  id: string;
  carImport: CarImport;
  visibleLayerIds: string[];
};

export type CarFocusRequest = {
  importId: string;
  nonce: number;
};

type ClientMapProps = {
  analysisLayers: RasterLayer[];
  activeIndices: SpectralIndex[];
  baseMap: BaseMapKey;
  cloudCoverMax: number;
  controlsOffset: boolean;
  dateFrom: string;
  dateTo: string;
  drawingStyle: DrawingStyle;
  indexOpacity: number;
  layerPalette: LayerPalette;
  mapTarget: { lat: number; lon: number; boundingBox?: number[] } | null;
  carImports: ManagedCarMapItem[];
  standardCarLayers: StandardCarMapLayer[];
  standardCarFilters: StandardCarMapFilters;
  carFocusRequest: CarFocusRequest | null;
  activeAoiCarId: string | null;
  onAoiChange: (aoi: GeoJsonPolygon | null) => void;
  onCarFileDrop: (files: File[]) => void;
};

const LeafletMap = dynamic(() => import("./LeafletMap").then((module) => module.LeafletMap), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[#d9e0d5]" />
});

export function ClientMap(props: ClientMapProps) {
  return (
    <Suspense fallback={<div className="absolute inset-0 bg-[#d9e0d5]" />}>
      <LeafletMap {...props} />
    </Suspense>
  );
}
