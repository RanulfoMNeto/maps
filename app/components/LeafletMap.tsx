"use client";

import { useEffect, useRef } from "react";
import type { DragEvent } from "react";
import L from "leaflet";
import "leaflet-draw";
import type { BaseMapKey, CarFocusRequest, DrawingStyle, LayerPalette, ManagedCarMapItem } from "./MapWorkspace";
import { formatCarFieldLabel, formatCarFieldValue } from "@/app/lib/car";
import { GeoJsonPolygon, RasterLayer, SpectralIndex } from "@/app/lib/indices";
import type { StandardCarMapFilters, StandardCarMapLayer } from "@/app/lib/standardCarCatalog";

type LeafletMapProps = {
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

type LoadedStandardCarLayer = {
  layer: StandardCarMapLayer;
  collection: GeoJSON.FeatureCollection;
};

export function LeafletMap({
  analysisLayers,
  activeIndices,
  baseMap,
  cloudCoverMax,
  controlsOffset,
  dateFrom,
  dateTo,
  drawingStyle,
  indexOpacity,
  layerPalette,
  mapTarget,
  carImports,
  standardCarLayers,
  standardCarFilters,
  carFocusRequest,
  activeAoiCarId,
  onAoiChange,
  onCarFileDrop
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseRef = useRef<L.Layer | null>(null);
  const drawnRef = useRef<L.FeatureGroup | null>(null);
  const standardCarRef = useRef<L.FeatureGroup | null>(null);
  const carRef = useRef<L.FeatureGroup | null>(null);
  const rasterRef = useRef<Record<string, L.TileLayer>>({});
  const drawingStyleRef = useRef(drawingStyle);
  const onAoiChangeRef = useRef(onAoiChange);
  const previousCarFocusKeyRef = useRef("");

  useEffect(() => {
    onAoiChangeRef.current = onAoiChange;
  }, [onAoiChange]);

  useEffect(() => {
    drawingStyleRef.current = drawingStyle;
    drawnRef.current?.eachLayer((layer) => {
      if ("setStyle" in layer && typeof layer.setStyle === "function") {
        layer.setStyle(toLeafletPathOptions(drawingStyle));
      }
    });
  }, [drawingStyle]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = L.map(containerRef.current, {
      center: [-15.78, -47.93],
      zoom: 5,
      zoomControl: false
    });

    createMapPanes(map);
    L.control.zoom({ position: "topleft" }).addTo(map);

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    drawnRef.current = drawnItems;

    const standardCarItems = new L.FeatureGroup();
    map.addLayer(standardCarItems);
    standardCarRef.current = standardCarItems;

    const carItems = new L.FeatureGroup();
    map.addLayer(carItems);
    carRef.current = carItems;

    const drawControl = new L.Control.Draw({
      position: "topleft",
      draw: {
        circle: false,
        circlemarker: false,
        marker: false,
        polyline: false,
        rectangle: {
          shapeOptions: toLeafletPathOptions(drawingStyleRef.current)
        },
        polygon: {
          allowIntersection: false,
          showArea: true,
          shapeOptions: toLeafletPathOptions(drawingStyleRef.current)
        }
      },
      edit: {
        featureGroup: drawnItems,
        remove: true
      }
    });

    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, (event) => {
      const layer = (event as L.DrawEvents.Created).layer;
      if ("setStyle" in layer && typeof layer.setStyle === "function") {
        layer.setStyle(toLeafletPathOptions(drawingStyleRef.current));
      }
      drawnItems.clearLayers();
      drawnItems.addLayer(layer);
      onAoiChangeRef.current(layerToPolygon(layer));
    });

    map.on(L.Draw.Event.EDITED, () => {
      const layers = drawnItems.getLayers();
      onAoiChangeRef.current(layers[0] ? layerToPolygon(layers[0]) : null);
    });

    map.on(L.Draw.Event.DELETED, () => {
      onAoiChangeRef.current(null);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();

    if (baseRef.current) {
      map.removeLayer(baseRef.current);
    }

    const baseLayer = createBaseLayer(baseMap, dateFrom, dateTo, cloudCoverMax);
    baseLayer.addTo(map);
    standardCarRef.current?.bringToFront();
    carRef.current?.bringToFront();
    map.setView(currentCenter, currentZoom, { animate: false });
    baseRef.current = baseLayer;
  }, [baseMap, cloudCoverMax, dateFrom, dateTo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapTarget) {
      return;
    }

    if (mapTarget.boundingBox?.length === 4) {
      const [south, north, west, east] = mapTarget.boundingBox;
      map.fitBounds(
        [
          [south, west],
          [north, east]
        ],
        { padding: [30, 30], maxZoom: 14 }
      );
      return;
    }

    map.flyTo([mapTarget.lat, mapTarget.lon], 12, { duration: 0.8 });
  }, [mapTarget]);

  useEffect(() => {
    if (activeAoiCarId) {
      drawnRef.current?.clearLayers();
    }
  }, [activeAoiCarId]);

  useEffect(() => {
    const map = mapRef.current;
    const standardCarItems = standardCarRef.current;
    if (!map || !standardCarItems) {
      return;
    }

    let disposed = false;
    const controller = new AbortController();
    let timer: number | null = null;

    const scheduleLoad = () => {
      if (timer) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        void loadStandardCarLayers();
      }, 220);
    };

    const loadStandardCarLayers = async () => {
      const zoom = map.getZoom();
      const visibleLayers = standardCarLayers.filter((layer) => zoom >= layer.minZoom);
      standardCarItems.clearLayers();

      if (!visibleLayers.length) {
        return;
      }

      const bounds = map.getBounds();
      const bbox = [
        bounds.getWest().toFixed(7),
        bounds.getSouth().toFixed(7),
        bounds.getEast().toFixed(7),
        bounds.getNorth().toFixed(7)
      ].join(",");

      const collections: Array<LoadedStandardCarLayer | null> = await Promise.all(
        visibleLayers.map(async (layer) => {
          const params = new URLSearchParams({
            state: layer.stateId,
            layer: layer.id,
            bbox,
            limit: String(featureLimitForZoom(zoom)),
            simplify: String(simplifyForZoom(zoom))
          });

          if (standardCarFilters.municipality) {
            params.set("municipality", standardCarFilters.municipality);
          }

          const response = await fetch(`/api/car/standard/geojson?${params.toString()}`, {
            signal: controller.signal
          });

          if (!response.ok) {
            const data = (await response.json().catch(() => null)) as { message?: string } | null;
            console.warn(data?.message ?? `Camada CAR estadual indisponível: ${layer.label}`);
            return null;
          }

          const collection = (await response.json()) as GeoJSON.FeatureCollection;
          return { layer, collection };
        })
      ).catch((error): Array<LoadedStandardCarLayer | null> => {
        if (!controller.signal.aborted) {
          console.warn(error instanceof Error ? error.message : "Falha ao carregar CAR estadual.");
        }
        return [];
      });

      if (disposed) {
        return;
      }

      standardCarItems.clearLayers();
      collections
        .filter((item): item is LoadedStandardCarLayer => Boolean(item && item.collection.features.length))
        .forEach(({ layer, collection }) => {
          L.geoJSON(collection, {
            pane: "standard-car-overlays",
            pointToLayer: (_feature, latlng) =>
              L.circleMarker(latlng, {
                radius: 4,
                color: layer.color,
                fillColor: layer.color,
                fillOpacity: 0.82,
                pane: "standard-car-overlays",
                weight: 1.5
              }),
            style: () => ({
              color: layer.color,
              fillColor: layer.color,
              fillOpacity: layer.fillOpacity,
              opacity: 0.88,
              weight: layer.id === "area_imovel" ? 2 : 1.5
            }),
            onEachFeature: (feature, leafletLayer) => {
              leafletLayer.bindPopup(buildPopupHtml(layer.label, feature.properties ?? {}), {
                maxWidth: 320
              });
            }
          }).addTo(standardCarItems);
        });

      standardCarItems.bringToFront();
      carRef.current?.bringToFront();
    };

    map.on("moveend zoomend", scheduleLoad);
    scheduleLoad();

    return () => {
      disposed = true;
      controller.abort();
      if (timer) {
        window.clearTimeout(timer);
      }
      map.off("moveend zoomend", scheduleLoad);
      standardCarItems.clearLayers();
    };
  }, [standardCarFilters.municipality, standardCarLayers]);

  useEffect(() => {
    const map = mapRef.current;
    const carItems = carRef.current;
    if (!map || !carItems) {
      return;
    }

    carItems.clearLayers();

    if (!carImports.length) {
      previousCarFocusKeyRef.current = "";
      return;
    }

    const focusKey = carFocusRequest ? `${carFocusRequest.importId}:${carFocusRequest.nonce}` : "";
    const shouldFocusCar = Boolean(carFocusRequest && focusKey !== previousCarFocusKeyRef.current);
    const boundsByCar = new Map<string, L.LatLngBounds>();

    carImports.forEach((managedCar) => {
      managedCar.carImport.layers
        .filter((carLayer) => managedCar.visibleLayerIds.includes(carLayer.id))
        .forEach((carLayer) => {
          const collection: GeoJSON.FeatureCollection = {
            type: "FeatureCollection",
            features: carLayer.features
          };
          const layer = L.geoJSON(collection, {
            pane: "car-overlays",
            pointToLayer: (_feature, latlng) =>
              L.circleMarker(latlng, {
                radius: 5,
                color: carLayer.color,
                fillColor: carLayer.color,
                fillOpacity: 0.85,
                pane: "car-overlays",
                weight: 2
              }),
            style: () => ({
              color: carLayer.color,
              fillColor: carLayer.color,
              fillOpacity: carLayer.id.includes("area_do_imovel") ? 0.08 : 0.22,
              opacity: 0.95,
              weight: carLayer.id.includes("area_do_imovel") ? 3 : 2
            }),
            onEachFeature: (feature, leafletLayer) => {
              leafletLayer.bindPopup(buildPopupHtml(carLayer.label, feature.properties ?? {}), {
                maxWidth: 320
              });
            }
          });
          carItems.addLayer(layer);
          extendBounds(boundsByCar, managedCar.id, layer);
        });

      const carBounds = boundsByCar.get(managedCar.id);
      if (carBounds?.isValid()) {
        const center = carBounds.getCenter();
        L.circleMarker(center, {
          radius: managedCar.id === activeAoiCarId ? 7 : 5,
          color: "#ffffff",
          fillColor: managedCar.id === activeAoiCarId ? "#dc2626" : "#475569",
          fillOpacity: 0.95,
          opacity: 1,
          pane: "car-overlays",
          weight: 2
        })
          .bindTooltip(
            managedCar.id === activeAoiCarId ? "Centro aproximado do CAR usado como AOI" : "Centro aproximado do CAR",
            { direction: "top", offset: [0, -8] }
          )
          .addTo(carItems);
      }
    });

    carItems.bringToFront();

    if (shouldFocusCar && carFocusRequest) {
      const targetBounds = boundsByCar.get(carFocusRequest.importId);
      if (targetBounds?.isValid()) {
        focusBounds(map, targetBounds);
      }
      previousCarFocusKeyRef.current = focusKey;
    }
  }, [activeAoiCarId, carFocusRequest, carImports]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    Object.entries(rasterRef.current).forEach(([key, layer]) => {
      const index = key.split(":")[0] as SpectralIndex;
      if (!activeIndices.includes(index)) {
        map.removeLayer(layer);
        delete rasterRef.current[key];
      }
    });

    const paletteKey = encodePalette(layerPalette);

    analysisLayers
      .filter((layer) => layer.available && layer.tileUrl && activeIndices.includes(layer.index))
      .forEach((layer) => {
        const rasterKey = `${layer.index}:${paletteKey}`;
        if (rasterRef.current[rasterKey]) {
          return;
        }

        Object.entries(rasterRef.current).forEach(([key, existing]) => {
          if (key.startsWith(`${layer.index}:`)) {
            map.removeLayer(existing);
            delete rasterRef.current[key];
          }
        });

        const raster = L.tileLayer(withPalette(layer.tileUrl as string, layerPalette), {
          opacity: indexOpacity,
          pane: "spectral-raster",
          maxNativeZoom: 17,
          maxZoom: 20,
          tileSize: 256
        });

        raster.addTo(map);
        rasterRef.current[rasterKey] = raster;
      });
  }, [activeIndices, analysisLayers, indexOpacity, layerPalette]);

  useEffect(() => {
    Object.values(rasterRef.current).forEach((layer) => layer.setOpacity(indexOpacity));
  }, [indexOpacity]);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files).filter((item) => item.name.toLowerCase().endsWith(".zip"));
    if (files.length) {
      onCarFileDrop(files);
    }
  }

  return (
    <div
      className={`absolute inset-0 ${controlsOffset ? "map-controls-offset" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={handleDrop}
    >
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(23,33,28,0.12),transparent_24%,transparent_76%,rgba(23,33,28,0.08))]" />
    </div>
  );
}

function createBaseLayer(baseMap: BaseMapKey, dateFrom: string, dateTo: string, cloudCoverMax: number) {
  if (baseMap === "google_hybrid") {
    return L.tileLayer("/api/basemaps/google-hybrid/{z}/{x}/{y}", {
      pane: "base-map",
      maxZoom: 20,
      attribution: "Google Hybrid"
    });
  }

  if (baseMap === "sentinel_rgb") {
    const osmFallback = L.tileLayer("/api/basemaps/osm/{z}/{x}/{y}", {
      pane: "base-map",
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });
    const sentinelRgb = L.tileLayer(
      `/api/basemaps/sentinel/{z}/{x}/{y}?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(
        dateTo
      )}&cloudCoverMax=${cloudCoverMax}`,
      {
        pane: "base-map",
        minZoom: 7,
        maxNativeZoom: 17,
        maxZoom: 20,
        attribution: "Sentinel-2 L2A RGB"
      }
    );
    return L.layerGroup([osmFallback, sentinelRgb]);
  }

  return L.tileLayer("/api/basemaps/osm/{z}/{x}/{y}", {
    pane: "base-map",
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  });
}

function createMapPanes(map: L.Map) {
  const basePane = map.createPane("base-map");
  basePane.style.zIndex = "180";

  const spectralPane = map.createPane("spectral-raster");
  spectralPane.style.zIndex = "320";

  const standardCarPane = map.createPane("standard-car-overlays");
  standardCarPane.style.zIndex = "390";

  const carPane = map.createPane("car-overlays");
  carPane.style.zIndex = "430";
}

function featureLimitForZoom(zoom: number) {
  if (zoom >= 14) {
    return 1500;
  }
  if (zoom >= 12) {
    return 1000;
  }
  return 650;
}

function simplifyForZoom(zoom: number) {
  if (zoom >= 14) {
    return 0;
  }
  if (zoom >= 12) {
    return 0.00003;
  }
  if (zoom >= 10) {
    return 0.00008;
  }
  return 0.0002;
}

function focusBounds(map: L.Map, bounds: L.LatLngBounds) {
  const fit = () => {
    map.invalidateSize();
    const size = map.getSize();
    const left = size.x >= 1200 ? 500 : 40;
    const right = size.x >= 1200 ? 560 : 40;
    const vertical = size.y >= 760 ? 120 : 56;
    map.fitBounds(bounds, {
      paddingTopLeft: [left, vertical],
      paddingBottomRight: [right, vertical],
      maxZoom: 17
    });
  };

  requestAnimationFrame(fit);
  window.setTimeout(fit, 250);
}

function extendBounds(boundsByCar: Map<string, L.LatLngBounds>, importId: string, layer: L.GeoJSON) {
  const layerBounds = layer.getBounds();
  if (!layerBounds.isValid()) {
    return;
  }

  const bounds = boundsByCar.get(importId);
  if (bounds) {
    bounds.extend(layerBounds);
    return;
  }

  boundsByCar.set(importId, layerBounds);
}

function toLeafletPathOptions(style: DrawingStyle): L.PathOptions {
  return {
    color: style.strokeColor,
    fillColor: style.fillColor,
    weight: style.strokeWidth,
    fillOpacity: style.fillOpacity
  };
}

function withPalette(tileUrl: string, palette: LayerPalette) {
  const separator = tileUrl.includes("?") ? "&" : "?";
  return `${tileUrl}${separator}c0=${encodeURIComponent(palette.low)}&c1=${encodeURIComponent(
    palette.midLow
  )}&c2=${encodeURIComponent(palette.midHigh)}&c3=${encodeURIComponent(palette.high)}`;
}

function encodePalette(palette: LayerPalette) {
  return `${palette.low}-${palette.midLow}-${palette.midHigh}-${palette.high}`;
}

function buildPopupHtml(title: string, properties: GeoJSON.GeoJsonProperties) {
  const rows = Object.entries(properties ?? {})
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 12)
    .map(
      ([key, value]) =>
        `<tr><th>${escapeHtml(formatCarFieldLabel(key))}</th><td>${escapeHtml(formatCarFieldValue(key, value))}</td></tr>`
    )
    .join("");

  return `<div class="car-popup"><h3>${escapeHtml(title)}</h3><table>${rows}</table></div>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function layerToPolygon(layer: L.Layer): GeoJsonPolygon {
  const geojson = (layer as L.Polygon).toGeoJSON() as GeoJSON.Feature<GeoJSON.Polygon>;

  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: geojson.geometry.coordinates
    }
  };
}
