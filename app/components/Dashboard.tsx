"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Cloud,
  Download,
  FileArchive,
  Layers,
  Loader2,
  MapPinned,
  LocateFixed,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  X
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { ClientMap } from "./MapWorkspace";
import type { BaseMapKey, CarFocusRequest, DrawingStyle, LayerPalette, ManagedCarMapItem } from "./MapWorkspace";
import { carImportToAoi, parseCarZip, summarizeCarProperties } from "@/app/lib/car";
import {
  AnalysisMode,
  AnalysisRequest,
  AnalysisResponse,
  GeoJsonPolygon,
  INDEX_OPTIONS,
  SpectralIndex,
  TimeSeriesPoint
} from "@/app/lib/indices";
import type {
  StandardCarMapFilters,
  StandardCarMapLayer,
  StandardCarMetadata,
  StandardCarStateMetadata
} from "@/app/lib/standardCarCatalog";

type GeocodeResult = {
  id: number;
  label: string;
  lat: number;
  lon: number;
  boundingBox?: number[];
};

type ThemeMode = "light" | "dark";

type ManagedCarSidebarItem = ManagedCarMapItem & {
  expanded: boolean;
};

const DEFAULT_LAYER_PALETTE: LayerPalette = {
  low: "#7f3b08",
  midLow: "#f1b75b",
  midHigh: "#94c66b",
  high: "#1d6a4a"
};

const DEFAULT_DRAWING_STYLE: DrawingStyle = {
  strokeColor: "#047857",
  fillColor: "#047857",
  strokeWidth: 2,
  fillOpacity: 0.16
};

const ALL_SPECTRAL_INDICES = Object.keys(INDEX_OPTIONS) as SpectralIndex[];
const DEFAULT_ACTIVE_INDICES: SpectralIndex[] = ["ndvi"];

const INDEX_LINE_COLORS: Record<SpectralIndex, string> = {
  ndvi: "#1d6a4a",
  ndmi: "#287d99",
  mndwi: "#176582",
  nbr: "#be6a3a",
  dnbr: "#a8201a",
  bsi: "#a36f3f",
  ndre: "#79ad5a"
};

const EMPTY_LAYERS: AnalysisResponse["layers"] = [];

const today = new Date();
const defaultTo = today.toISOString().slice(0, 10);
const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 2, today.getDate())
  .toISOString()
  .slice(0, 10);

export function Dashboard() {
  const [panelOpen, setPanelOpen] = useState(true);
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [timelineModalOpen, setTimelineModalOpen] = useState(false);
  const [sentinelLayersExpanded, setSentinelLayersExpanded] = useState(true);
  const [standardCarExpanded, setStandardCarExpanded] = useState(true);
  const [standardCarMetadata, setStandardCarMetadata] = useState<StandardCarMetadata | null>(null);
  const [activeStandardCarLayerIds, setActiveStandardCarLayerIds] = useState<string[]>([]);
  const [standardCarStateId, setStandardCarStateId] = useState("minas_gerais");
  const [standardCarMunicipality, setStandardCarMunicipality] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [aoi, setAoi] = useState<GeoJsonPolygon | null>(null);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [mode, setMode] = useState<AnalysisMode>("custom");
  const [compareFrom, setCompareFrom] = useState("");
  const [compareTo, setCompareTo] = useState("");
  const [cloudCoverMax, setCloudCoverMax] = useState(30);
  const [activeIndices, setActiveIndices] = useState<SpectralIndex[]>(DEFAULT_ACTIVE_INDICES);
  const [baseMap, setBaseMap] = useState<BaseMapKey>("google_hybrid");
  const [indexOpacity, setIndexOpacity] = useState(0.48);
  const [layerPalette, setLayerPalette] = useState<LayerPalette>(DEFAULT_LAYER_PALETTE);
  const [drawingStyle, setDrawingStyle] = useState<DrawingStyle>(DEFAULT_DRAWING_STYLE);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [carImports, setCarImports] = useState<ManagedCarSidebarItem[]>([]);
  const [activeAoiCarId, setActiveAoiCarId] = useState<string | null>(null);
  const [carFocusRequest, setCarFocusRequest] = useState<CarFocusRequest | null>(null);
  const [isLoadingCar, setIsLoadingCar] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [mapTarget, setMapTarget] = useState<{ lat: number; lon: number; boundingBox?: number[] } | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("sentinel-ui-settings");
    if (!saved) {
      return;
    }

    try {
      const parsed = JSON.parse(saved) as {
        themeMode?: ThemeMode;
        indexOpacity?: number;
        layerPalette?: LayerPalette;
        drawingStyle?: DrawingStyle;
      };
      if (parsed.themeMode) setThemeMode(parsed.themeMode);
      if (typeof parsed.indexOpacity === "number") setIndexOpacity(parsed.indexOpacity);
      if (parsed.layerPalette) setLayerPalette(parsed.layerPalette);
      if (parsed.drawingStyle) setDrawingStyle(parsed.drawingStyle);
    } catch {
      window.localStorage.removeItem("sentinel-ui-settings");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "sentinel-ui-settings",
      JSON.stringify({ themeMode, indexOpacity, layerPalette, drawingStyle })
    );
  }, [drawingStyle, indexOpacity, layerPalette, themeMode]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/car/standard/metadata", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Metadados das bases estaduais indisponíveis.");
        }
        return (await response.json()) as StandardCarMetadata;
      })
      .then((metadata) => {
        setStandardCarMetadata(metadata);
        setStandardCarStateId((current) => metadata.states.find((state) => state.id === current)?.id ?? metadata.states[0]?.id ?? "");
        setActiveStandardCarLayerIds((current) => {
          if (current.length) {
            return current;
          }
          const defaultState = metadata.states.find((state) => state.id === standardCarStateId) ?? metadata.states[0];
          return defaultState?.layers.filter((layer) => layer.defaultVisible).map((layer) => layer.id) ?? [];
        });
      })
      .catch((metadataError) => {
        if (!controller.signal.aborted) {
          console.warn(metadataError instanceof Error ? metadataError.message : "Falha ao carregar bases estaduais.");
        }
      });

    return () => controller.abort();
  }, [standardCarStateId]);

  const requestPayload = useMemo<AnalysisRequest | null>(() => {
    if (!aoi) {
      return null;
    }

    return {
      aoi,
      dateFrom,
      dateTo,
      mode,
      compareFrom: compareFrom || undefined,
      compareTo: compareTo || undefined,
      cloudCoverMax,
      selectedIndices: ALL_SPECTRAL_INDICES
    };
  }, [aoi, cloudCoverMax, compareFrom, compareTo, dateFrom, dateTo, mode]);

  async function runSearch() {
    if (!searchText.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(searchText.trim())}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Busca geográfica indisponível.");
      }

      setSearchResults(data.results ?? []);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Erro na busca geográfica.");
    } finally {
      setIsSearching(false);
    }
  }

  async function runAnalysis() {
    if (!requestPayload) {
      setError("Desenhe uma área de interesse no mapa antes de processar.");
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Falha ao processar análise.");
      }

      setAnalysis(data);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "Erro ao processar análise.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function exportGeoJson() {
    if (!requestPayload) {
      setError("Desenhe uma AOI para exportar GeoJSON.");
      return;
    }

    const response = await fetch("/api/export?format=geojson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
      const data = await response.json();
      setError(data.message ?? "Exportação indisponível.");
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sentinel-aoi.geojson";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importCarFiles(files: File[]) {
    const zipFiles = files.filter((file) => file.name.toLowerCase().endsWith(".zip"));
    if (!zipFiles.length) {
      setError("Selecione ou arraste pelo menos um arquivo .zip do CAR.");
      return;
    }

    setIsLoadingCar(true);
    setError(null);

    const importedItems: ManagedCarSidebarItem[] = [];
    const importErrors: string[] = [];
    let lastAoiImport: { id: string; aoi: GeoJsonPolygon } | null = null;

    try {
      for (const file of zipFiles) {
        try {
          const imported = await parseCarZip(file);
          const id = createClientId("car");
          const importedAoi = carImportToAoi(imported);
          importedItems.push({
            id,
            carImport: imported,
            visibleLayerIds: imported.layers.map((layer) => layer.id),
            expanded: true
          });

          if (importedAoi) {
            lastAoiImport = { id, aoi: importedAoi };
          }
        } catch (carError) {
          importErrors.push(`${file.name}: ${carError instanceof Error ? carError.message : "falha ao importar"}`);
        }
      }

      if (importedItems.length) {
        setCarImports((current) => [...current, ...importedItems]);
        setAnalysis(null);

        const focusId = lastAoiImport?.id ?? importedItems[importedItems.length - 1].id;
        setCarFocusRequest({ importId: focusId, nonce: Date.now() });
      }

      if (lastAoiImport) {
        setAoi(lastAoiImport.aoi);
        setActiveAoiCarId(lastAoiImport.id);
      }

      if (importErrors.length) {
        setError(`${importErrors.length} arquivo(s) não foram importados. ${importErrors[0]}`);
      } else if (!importedItems.length) {
        setError("Nenhum shapefile de CAR foi encontrado nos ZIPs selecionados.");
      }
    } finally {
      setIsLoadingCar(false);
    }
  }

  function toggleActiveIndex(index: SpectralIndex) {
    setActiveIndices((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index]
    );
  }

  function toggleStandardCarLayer(layerId: string) {
    setActiveStandardCarLayerIds((current) =>
      current.includes(layerId) ? current.filter((item) => item !== layerId) : [...current, layerId]
    );
  }

  function setStandardCarLayersVisible(state: StandardCarStateMetadata, visible: boolean) {
    setActiveStandardCarLayerIds(visible ? state.layers.filter((layer) => layer.prepared).map((layer) => layer.id) : []);
  }

  function toggleCarImportExpanded(importId: string) {
    setCarImports((current) =>
      current.map((item) => (item.id === importId ? { ...item, expanded: !item.expanded } : item))
    );
  }

  function toggleCarImportVisibility(importId: string) {
    setCarImports((current) =>
      current.map((item) => {
        if (item.id !== importId) {
          return item;
        }

        const allVisible = item.visibleLayerIds.length === item.carImport.layers.length;
        return {
          ...item,
          visibleLayerIds: allVisible ? [] : item.carImport.layers.map((layer) => layer.id)
        };
      })
    );
  }

  function toggleCarLayer(importId: string, layerId: string) {
    setCarImports((current) =>
      current.map((item) =>
        item.id === importId
          ? {
              ...item,
              visibleLayerIds: item.visibleLayerIds.includes(layerId)
                ? item.visibleLayerIds.filter((id) => id !== layerId)
                : [...item.visibleLayerIds, layerId]
            }
          : item
      )
    );
  }

  function setCarImportVisibility(importId: string, visible: boolean) {
    setCarImports((current) =>
      current.map((item) =>
        item.id === importId
          ? { ...item, visibleLayerIds: visible ? item.carImport.layers.map((layer) => layer.id) : [] }
          : item
      )
    );
  }

  function removeCarImport(importId: string) {
    setCarImports((current) => current.filter((item) => item.id !== importId));
    if (activeAoiCarId === importId) {
      setAoi(null);
      setActiveAoiCarId(null);
    }
  }

  function selectCarAsAoi(importId: string) {
    const item = carImports.find((candidate) => candidate.id === importId);
    if (!item) {
      return;
    }

    const carAoi = carImportToAoi(item.carImport);
    if (!carAoi) {
      setError("Este CAR não possui uma camada poligonal para usar como AOI.");
      return;
    }

    setAoi(carAoi);
    setActiveAoiCarId(importId);
    setAnalysis(null);
    setCarFocusRequest({ importId, nonce: Date.now() });
  }

  function handleAoiChange(nextAoi: GeoJsonPolygon | null) {
    setAoi(nextAoi);
    if (nextAoi) {
      setActiveAoiCarId(null);
    }
  }

  const layers = analysis?.layers ?? EMPTY_LAYERS;
  const unavailableProvider = analysis?.providerStatus === "provider_unconfigured";
  const activeAoiCar = activeAoiCarId ? carImports.find((item) => item.id === activeAoiCarId) : null;
  const selectedStandardCarState =
    standardCarMetadata?.states.find((state) => state.id === standardCarStateId) ?? standardCarMetadata?.states[0] ?? null;
  const activeStandardCarLayers = useMemo<StandardCarMapLayer[]>(
    () =>
      selectedStandardCarState?.layers
        .filter((layer) => activeStandardCarLayerIds.includes(layer.id) && layer.prepared)
        .map((layer) => ({
          id: layer.id,
          stateId: selectedStandardCarState.id,
          label: layer.label,
          color: layer.color,
          fillOpacity: layer.fillOpacity,
          minZoom: layer.minZoom
        })) ?? [],
    [activeStandardCarLayerIds, selectedStandardCarState]
  );
  const standardCarFilters = useMemo<StandardCarMapFilters>(
    () => ({
      stateId: selectedStandardCarState?.id ?? standardCarStateId,
      municipality: standardCarMunicipality
    }),
    [selectedStandardCarState?.id, standardCarMunicipality, standardCarStateId]
  );
  const layerByIndex = useMemo(() => new Map(layers.map((layer) => [layer.index, layer])), [layers]);
  const activeChartIndices = useMemo(
    () =>
      activeIndices.filter((index) =>
        Boolean(analysis?.timeSeries.some((point) => typeof point[index] === "number"))
      ),
    [activeIndices, analysis?.timeSeries]
  );
  const mapCarImports = useMemo<ManagedCarMapItem[]>(
    () => carImports.map(({ id, carImport, visibleLayerIds }) => ({ id, carImport, visibleLayerIds })),
    [carImports]
  );

  return (
    <main
      className={`relative h-dvh overflow-hidden text-ink ${themeMode === "dark" ? "theme-dark bg-[#101713]" : "theme-light bg-[#eef2e8]"}`}
    >
      <ClientMap
        activeIndices={activeIndices}
        analysisLayers={layers}
        baseMap={baseMap}
        cloudCoverMax={cloudCoverMax}
        controlsOffset={panelOpen}
        dateFrom={dateFrom}
        dateTo={dateTo}
        drawingStyle={drawingStyle}
        indexOpacity={indexOpacity}
        layerPalette={layerPalette}
        mapTarget={mapTarget}
        carImports={mapCarImports}
        standardCarLayers={activeStandardCarLayers}
        standardCarFilters={standardCarFilters}
        carFocusRequest={carFocusRequest}
        activeAoiCarId={activeAoiCarId}
        onAoiChange={handleAoiChange}
        onCarFileDrop={(files) => void importCarFiles(files)}
      />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex items-start justify-between p-4">
        <div className="pointer-events-auto surface flex max-w-[min(720px,calc(100vw-96px))] items-center gap-3 rounded-lg px-4 py-3 shadow-soft">
          <button
            aria-label={panelOpen ? "Fechar painel" : "Abrir painel"}
            className="grid size-10 shrink-0 place-items-center rounded-md bg-ink text-white transition hover:bg-canopy"
            onClick={() => setPanelOpen((open) => !open)}
          >
            {panelOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
          </button>
          <button
            aria-label="Abrir configurações"
            className="grid size-10 shrink-0 place-items-center rounded-md border border-ink/10 bg-white text-ink transition hover:border-canopy hover:text-canopy"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={19} />
          </button>
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-canopy">
              <ShieldCheck size={15} />
              Sentinel-2 L2A | análise indicativa
            </div>
            <h1 className="text-lg font-semibold leading-tight sm:text-2xl">Sentinel Ambiental</h1>
          </div>
        </div>

        <button
          aria-label={insightsOpen ? "Fechar painel de resultados" : "Abrir painel de resultados"}
          className="pointer-events-auto grid size-10 shrink-0 place-items-center rounded-md bg-ink text-white shadow-soft transition hover:bg-canopy"
          onClick={() => setInsightsOpen((open) => !open)}
        >
          {insightsOpen ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
        </button>
      </header>

      {settingsOpen && (
        <SettingsPanel
          drawingStyle={drawingStyle}
          indexOpacity={indexOpacity}
          layerPalette={layerPalette}
          onClose={() => setSettingsOpen(false)}
          onDrawingStyleChange={setDrawingStyle}
          onIndexOpacityChange={setIndexOpacity}
          onLayerPaletteChange={setLayerPalette}
          onReset={() => {
            setThemeMode("light");
            setIndexOpacity(0.48);
            setLayerPalette(DEFAULT_LAYER_PALETTE);
            setDrawingStyle(DEFAULT_DRAWING_STYLE);
          }}
          onThemeChange={setThemeMode}
          themeMode={themeMode}
        />
      )}

      <aside
        className={`surface absolute bottom-4 top-24 z-[450] flex w-[calc(100vw-32px)] max-w-[430px] flex-col rounded-lg shadow-soft transition-all duration-300 md:left-4 ${
          panelOpen ? "left-4 translate-x-0 opacity-100" : "left-0 -translate-x-[calc(100%+24px)] opacity-0"
        }`}
      >
        <div className="thin-scrollbar flex-1 overflow-y-auto p-4">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Search size={18} className="text-canopy" />
              <h2 className="font-semibold">Buscar região</h2>
            </div>
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-md border border-ink/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-canopy focus:ring-2 focus:ring-canopy/20"
                placeholder="Município, fazenda, coordenada..."
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void runSearch();
                  }
                }}
              />
              <button
                className="grid size-10 place-items-center rounded-md bg-canopy text-white transition hover:bg-ink disabled:cursor-not-allowed disabled:bg-ink/30"
                disabled={isSearching}
                onClick={() => void runSearch()}
                aria-label="Buscar"
              >
                {isSearching ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
              </button>
            </div>
            {searchResults.length > 0 && (
              <div className="space-y-2">
                {searchResults.map((result) => (
                  <button
                    key={result.id}
                    className="w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-left text-xs leading-relaxed transition hover:border-canopy hover:bg-canopy/5"
                    onClick={() => {
                      setMapTarget({
                        lat: result.lat,
                        lon: result.lon,
                        boundingBox: result.boundingBox
                      });
                      setSearchResults([]);
                    }}
                  >
                    {result.label}
                  </button>
                ))}
              </div>
            )}
          </section>

          <Divider />

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <CalendarDays size={18} className="text-canopy" />
              <h2 className="font-semibold">Filtros temporais</h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <LabeledInput label="De" type="date" value={dateFrom} onChange={setDateFrom} />
              <LabeledInput label="Até" type="date" value={dateTo} onChange={setDateTo} />
            </div>
            <label className="block text-xs font-medium text-ink/70">
              Período
              <select
                className="mt-1 w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-sm outline-none focus:border-canopy"
                value={mode}
                onChange={(event) => setMode(event.target.value as AnalysisMode)}
              >
                <option value="custom">Intervalo personalizado</option>
                <option value="dry">Período seco</option>
                <option value="rainy">Período chuvoso</option>
                <option value="month">Mês</option>
                <option value="year">Ano</option>
                <option value="before_after">Comparação antes/depois</option>
              </select>
            </label>
            {mode === "before_after" && (
              <div className="grid grid-cols-2 gap-2">
                <LabeledInput label="Antes" type="date" value={compareFrom} onChange={setCompareFrom} />
                <LabeledInput label="Depois" type="date" value={compareTo} onChange={setCompareTo} />
              </div>
            )}
            <label className="block text-xs font-medium text-ink/70">
              <span className="flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Cloud size={14} />
                  nuvem máxima
                </span>
                <span>{cloudCoverMax}%</span>
              </span>
              <input
                className="mt-2 w-full accent-canopy"
                type="range"
                min="0"
                max="90"
                step="5"
                value={cloudCoverMax}
                onChange={(event) => setCloudCoverMax(Number(event.target.value))}
              />
            </label>
          </section>

          <Divider />

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <MapPinned size={18} className="text-canopy" />
              <h2 className="font-semibold">Área de interesse</h2>
            </div>
            <div className="rounded-md bg-white p-3 text-sm text-ink/70">
              {aoi ? (
                <p>
                  {activeAoiCar
                    ? `AOI carregada a partir de ${formatCarFileName(activeAoiCar.carImport.fileName)}.`
                    : "AOI desenhada. Ajuste o polígono no mapa ou reprocesse com novos filtros."}
                </p>
              ) : (
                <p>Use as ferramentas do mapa para desenhar um polígono da propriedade, talhão ou área de estudo.</p>
              )}
            </div>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-canopy/50 bg-canopy/5 px-4 py-3 text-sm font-semibold text-canopy transition hover:bg-canopy/10">
              {isLoadingCar ? <Loader2 className="animate-spin" size={18} /> : <FileArchive size={18} />}
              {isLoadingCar ? "Importando CAR..." : "Importar ZIP do CAR"}
              <input
                className="hidden"
                type="file"
                multiple
                accept=".zip,application/zip,application/x-zip-compressed"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length) {
                    void importCarFiles(files);
                  }
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </section>

          <Divider />

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Layers size={18} className="text-canopy" />
              <h2 className="font-semibold">Gerenciador de camadas</h2>
            </div>

            {(() => {
              const allSentinelActive = activeIndices.length === ALL_SPECTRAL_INDICES.length;
              const partiallyActive = activeIndices.length > 0 && !allSentinelActive;

              return (
              <div className="rounded-md border border-ink/10 bg-white">
                <div className="flex items-start gap-2 border-b border-ink/10 px-3 py-2">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-canopy"
                    checked={allSentinelActive}
                    ref={(input) => {
                      if (input) {
                        input.indeterminate = partiallyActive;
                      }
                    }}
                    onChange={() => setActiveIndices(allSentinelActive ? [] : ALL_SPECTRAL_INDICES)}
                    aria-label="Alternar índices Sentinel"
                  />
                  <button
                    className="mt-0.5 grid size-5 shrink-0 place-items-center rounded text-ink/60 transition hover:bg-ink/5 hover:text-canopy"
                    onClick={() => setSentinelLayersExpanded((expanded) => !expanded)}
                    aria-label={sentinelLayersExpanded ? "Recolher índices Sentinel" : "Expandir índices Sentinel"}
                  >
                    {sentinelLayersExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">Índices Sentinel</p>
                    <p className="text-xs text-ink/50">
                      {activeIndices.length}/{ALL_SPECTRAL_INDICES.length} índice(s) visíveis
                    </p>
                  </div>
                </div>
                {sentinelLayersExpanded && (
                  <>
                    {unavailableProvider && (
                      <div className="border-b border-ink/10 bg-[#fff7df] px-3 py-2 text-xs leading-relaxed text-[#765700]">
                        Provedor Sentinel não configurado. Nenhum resultado espectral real será exibido.
                      </div>
                    )}
                    <label className="block border-b border-ink/10 px-3 py-2 text-xs font-medium text-ink/70">
                      <span className="flex items-center justify-between">
                        <span>opacidade</span>
                        <span>{Math.round(indexOpacity * 100)}%</span>
                      </span>
                      <input
                        className="mt-2 w-full accent-canopy"
                        type="range"
                        min="0.15"
                        max="0.9"
                        step="0.05"
                        value={indexOpacity}
                        onChange={(event) => setIndexOpacity(Number(event.target.value))}
                      />
                    </label>
                    <div className="divide-y divide-ink/10">
                      {ALL_SPECTRAL_INDICES.map((index) => {
                        const layer = layerByIndex.get(index);
                        const option = INDEX_OPTIONS[index];

                        return (
                          <label key={index} className="flex cursor-pointer items-start gap-2 px-3 py-2 text-xs">
                            <input
                              type="checkbox"
                              className="mt-0.5 size-4 shrink-0 accent-canopy"
                              checked={activeIndices.includes(index)}
                              onChange={() => toggleActiveIndex(index)}
                            />
                            <span
                              className="mt-1 block size-3 shrink-0 rounded-sm"
                              style={{ backgroundColor: INDEX_LINE_COLORS[index] }}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold">{option.label}</span>
                              <span className="block text-ink/55">{describeSentinelLayer(layer, Boolean(analysis))}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              );
            })()}

            {standardCarMetadata && selectedStandardCarState && (
              <div className="rounded-md border border-ink/10 bg-white">
                {(() => {
                  const preparedLayerIds = selectedStandardCarState.layers
                    .filter((layer) => layer.prepared)
                    .map((layer) => layer.id);
                  const activePreparedCount = activeStandardCarLayerIds.filter((id) => preparedLayerIds.includes(id)).length;
                  const allStandardVisible = preparedLayerIds.length > 0 && activePreparedCount === preparedLayerIds.length;
                  const partiallyStandardVisible = activePreparedCount > 0 && !allStandardVisible;

                  return (
                    <>
                      <div className="flex items-start gap-2 border-b border-ink/10 px-3 py-2">
                        <input
                          type="checkbox"
                          className="mt-1 size-4 shrink-0 accent-canopy"
                          checked={allStandardVisible}
                          disabled={!preparedLayerIds.length}
                          ref={(input) => {
                            if (input) {
                              input.indeterminate = partiallyStandardVisible;
                            }
                          }}
                          onChange={() => setStandardCarLayersVisible(selectedStandardCarState, !allStandardVisible)}
                          aria-label="Alternar camadas estaduais do CAR"
                        />
                        <button
                          className="mt-0.5 grid size-5 shrink-0 place-items-center rounded text-ink/60 transition hover:bg-ink/5 hover:text-canopy"
                          onClick={() => setStandardCarExpanded((expanded) => !expanded)}
                          aria-label={standardCarExpanded ? "Recolher CAR estadual" : "Expandir CAR estadual"}
                        >
                          {standardCarExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">CAR Estadual</p>
                          <p className="text-xs text-ink/50">
                            {activePreparedCount}/{preparedLayerIds.length} camada(s) visíveis
                          </p>
                        </div>
                      </div>

                      {standardCarExpanded && (
                        <>
                          <div className="space-y-2 border-b border-ink/10 px-3 py-2">
                            <label className="block text-xs font-medium text-ink/70">
                              Estado
                              <select
                                className="mt-1 w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-xs outline-none focus:border-canopy"
                                value={selectedStandardCarState.id}
                                onChange={(event) => {
                                  const nextState =
                                    standardCarMetadata.states.find((state) => state.id === event.target.value) ??
                                    selectedStandardCarState;
                                  setStandardCarStateId(nextState.id);
                                  setStandardCarMunicipality("");
                                  setActiveStandardCarLayerIds(
                                    nextState.layers.filter((layer) => layer.defaultVisible && layer.prepared).map((layer) => layer.id)
                                  );
                                }}
                              >
                                {standardCarMetadata.states.map((state) => (
                                  <option key={state.id} value={state.id}>
                                    {state.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="block text-xs font-medium text-ink/70">
                              Município
                              <select
                                className="mt-1 w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-xs outline-none focus:border-canopy disabled:cursor-not-allowed disabled:bg-ink/5"
                                disabled={!selectedStandardCarState.cities.length}
                                value={standardCarMunicipality}
                                onChange={(event) => setStandardCarMunicipality(event.target.value)}
                              >
                                <option value="">Todos os municípios</option>
                                {selectedStandardCarState.cities.map((city) => (
                                  <option key={`${city.uf}-${city.name}`} value={city.name}>
                                    {city.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          {!selectedStandardCarState.prepared && (
                            <div className="border-b border-ink/10 bg-[#fff7df] px-3 py-2 text-xs leading-relaxed text-[#765700]">
                              Base estadual ainda não preparada. Execute <span className="font-mono">npm run car:ingest</span> para
                              gerar os índices espaciais locais.
                            </div>
                          )}

                          <div className="divide-y divide-ink/10">
                            {selectedStandardCarState.layers.map((layer) => (
                              <label key={layer.id} className="flex cursor-pointer items-start gap-2 px-3 py-2 text-xs">
                                <input
                                  type="checkbox"
                                  className="mt-0.5 size-4 shrink-0 accent-canopy"
                                  checked={activeStandardCarLayerIds.includes(layer.id)}
                                  disabled={!layer.prepared}
                                  onChange={() => toggleStandardCarLayer(layer.id)}
                                />
                                <span
                                  className="mt-1 block size-3 shrink-0 rounded-sm"
                                  style={{ backgroundColor: layer.color }}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block font-semibold">{layer.label}</span>
                                  <span className="block text-ink/55">
                                    {layer.prepared
                                      ? `${layer.description} Exibe a partir do zoom ${layer.minZoom}.`
                                      : "Aguardando ingestão local da base estadual."}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {carImports.map((item) => {
              const allVisible = item.visibleLayerIds.length === item.carImport.layers.length;
              const partiallyVisible = item.visibleLayerIds.length > 0 && !allVisible;
              const carSummary = summarizeCarProperties(item.carImport);

              return (
                <div key={item.id} className="rounded-md border border-ink/10 bg-white">
                  <div className="flex items-start gap-2 border-b border-ink/10 px-3 py-2">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 accent-canopy"
                      checked={allVisible}
                      ref={(input) => {
                        if (input) {
                          input.indeterminate = partiallyVisible;
                        }
                      }}
                      onChange={() => toggleCarImportVisibility(item.id)}
                      aria-label={`Alternar ${item.carImport.fileName}`}
                    />
                    <button
                      className="mt-0.5 grid size-5 shrink-0 place-items-center rounded text-ink/60 transition hover:bg-ink/5 hover:text-canopy"
                      onClick={() => toggleCarImportExpanded(item.id)}
                      aria-label={item.expanded ? "Recolher CAR" : "Expandir CAR"}
                    >
                      {item.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">{formatCarFileName(item.carImport.fileName)}</p>
                        {activeAoiCarId === item.id && (
                          <span className="rounded bg-canopy/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-canopy">
                            AOI
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-ink/50">
                        {item.visibleLayerIds.length}/{item.carImport.layers.length} camada(s) visíveis
                      </p>
                    </div>
                    <button
                      className="grid size-7 shrink-0 place-items-center rounded-md text-ink/60 transition hover:bg-canopy/10 hover:text-canopy"
                      onClick={() => setCarFocusRequest({ importId: item.id, nonce: Date.now() })}
                      aria-label="Centralizar CAR"
                    >
                      <LocateFixed size={15} />
                    </button>
                    <button
                      className="grid size-7 shrink-0 place-items-center rounded-md text-ink/60 transition hover:bg-ember/10 hover:text-ember"
                      onClick={() => removeCarImport(item.id)}
                      aria-label="Remover CAR"
                    >
                      <X size={15} />
                    </button>
                  </div>

                  {item.expanded && (
                    <div>
                      <div className="flex gap-1 border-b border-ink/10 px-3 py-2">
                        <button
                          className="rounded-md px-2 py-1 text-xs font-semibold text-canopy transition hover:bg-canopy/10"
                          onClick={() => setCarImportVisibility(item.id, true)}
                        >
                          Todas
                        </button>
                        <button
                          className="rounded-md px-2 py-1 text-xs font-semibold text-ink/55 transition hover:bg-ink/5"
                          onClick={() => setCarImportVisibility(item.id, false)}
                        >
                          Nenhuma
                        </button>
                        <button
                          className="ml-auto rounded-md px-2 py-1 text-xs font-semibold text-ink transition hover:bg-canopy/10 hover:text-canopy"
                          onClick={() => selectCarAsAoi(item.id)}
                        >
                          Usar como AOI
                        </button>
                      </div>
                      <div className="divide-y divide-ink/10">
                        {item.carImport.layers.map((layer) => {
                          const isVisible = item.visibleLayerIds.includes(layer.id);
                          return (
                            <label key={layer.id} className="flex cursor-pointer items-start gap-2 px-3 py-2 text-xs">
                              <input
                                type="checkbox"
                                className="mt-0.5 size-4 shrink-0 accent-canopy"
                                checked={isVisible}
                                onChange={() => toggleCarLayer(item.id, layer.id)}
                              />
                              <span
                                className="mt-1 block size-3 shrink-0 rounded-sm"
                                style={{ backgroundColor: layer.color }}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block font-semibold">{layer.label}</span>
                                <span className="text-ink/55">{formatFeatureCount(layer.features.length)}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      {carSummary.length > 0 && (
                        <div className="space-y-1 border-t border-ink/10 px-3 py-2 text-xs">
                          {carSummary.slice(0, 6).map(({ key, label, value }) => (
                            <div key={key} className="flex justify-between gap-3">
                              <span className="text-ink/55">{label}</span>
                              <span className="max-w-[220px] truncate text-right font-medium">{value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {item.carImport.warnings.length > 0 && (
                        <div className="border-t border-ink/10 bg-[#fff7df] px-3 py-2 text-xs text-[#765700]">
                          {item.carImport.warnings.length} camada(s) com aviso de importação.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          <Divider />

          <section className="space-y-3">
            <button
              className="flex w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-canopy disabled:cursor-not-allowed disabled:bg-ink/35"
              disabled={isAnalyzing}
              onClick={() => void runAnalysis()}
            >
              {isAnalyzing ? <Loader2 className="animate-spin" size={18} /> : <Layers size={18} />}
              Processar análise
            </button>
            <button
              className="flex w-full items-center justify-center gap-2 rounded-md border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:border-canopy"
              onClick={() => void exportGeoJson()}
            >
              <Download size={18} />
              Exportar AOI GeoJSON
            </button>
          </section>

          {error && (
            <div className="mt-4 flex gap-2 rounded-md border border-ember/30 bg-ember/10 p-3 text-sm text-ember">
              <AlertTriangle className="mt-0.5 shrink-0" size={18} />
              <span>{error}</span>
            </div>
          )}

          {analysis && (
            <>
              <Divider />
              <section className="space-y-3">
                <h2 className="font-semibold">Legenda dinâmica</h2>
                {withConfiguredPalette(
                  (layers.find((layer) => activeIndices.includes(layer.index)) ?? layers[0])?.legend ?? [],
                  layerPalette
                ).map((stop) => (
                  <div key={`${stop.color}-${stop.label}`} className="flex items-center gap-2 text-xs">
                    <span className="size-4 rounded-sm" style={{ backgroundColor: stop.color }} />
                    <span>{stop.label}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 text-xs text-ink/60">
                  <span className="size-4 rounded-sm border border-ink/15 bg-white" />
                  <span>sem cor: nuvem/sombra/SCL inválido, sem dado ou tile sem pixel claro</span>
                </div>
              </section>
            </>
          )}
        </div>
      </aside>

      <aside
        className={`surface absolute bottom-4 top-20 z-[430] flex w-[calc(100vw-32px)] max-w-[380px] flex-col rounded-lg shadow-soft transition-all duration-300 md:right-4 ${
          insightsOpen ? "right-4 translate-x-0 opacity-100" : "right-0 translate-x-[calc(100%+24px)] opacity-0"
        }`}
      >
        <div className="border-b border-ink/10 p-3">
          <div className="grid grid-cols-3 gap-1">
            {[
              ["osm", "OSM"],
              ["google_hybrid", "Google Híbrido"],
              ["sentinel_rgb", "Sentinel"]
            ].map(([value, label]) => (
              <button
                key={value}
                className={`min-h-10 rounded-md px-2 py-2 text-xs font-semibold transition ${
                  baseMap === value ? "bg-ink text-white" : "bg-white text-ink/70 hover:bg-canopy/10"
                }`}
                onClick={() => setBaseMap(value as BaseMapKey)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="border-b border-ink/10 p-4">
          <h2 className="font-semibold">Resultados</h2>
        </div>
        <div className="thin-scrollbar flex-1 space-y-3 overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-2">
            {(analysis?.indicators ?? []).slice(0, 6).map((indicator) => (
              <div key={indicator.key} className="rounded-md border border-ink/10 bg-white p-3">
                <p className="text-xs font-medium text-ink/55">{indicator.label}</p>
                <p className="mt-0.5 text-base font-semibold">{indicator.value}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink/60">{indicator.description}</p>
              </div>
            ))}
            {!analysis &&
              ["Vegetação", "Água", "Solo", "Queimada", "Mudança", "CAR"].map((label) => (
                <div key={label} className="rounded-md border border-ink/10 bg-white p-3">
                  <p className="text-xs font-medium text-ink/55">{label}</p>
                  <p className="mt-0.5 text-base font-semibold">aguardando</p>
                  <p className="mt-1 text-xs text-ink/60">Sem análise processada.</p>
                </div>
              ))}
          </div>

          <button
            className="block w-full rounded-md border border-ink/10 bg-white p-3 text-left transition hover:border-canopy hover:bg-canopy/5 disabled:cursor-not-allowed disabled:hover:border-ink/10 disabled:hover:bg-white"
            disabled={!analysis?.timeSeries.length}
            onClick={() => setTimelineModalOpen(true)}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Série temporal da AOI</h3>
                <p className="text-xs text-ink/60">
                  {analysis?.timeSeries.length
                    ? `Exibindo ${formatIndexList(activeChartIndices)}.`
                    : "Sem série temporal carregada."}
                </p>
              </div>
              <span className="rounded-md bg-canopy/10 px-2 py-1 text-xs font-semibold text-canopy">
                indicativo
              </span>
            </div>
            <div className="h-40">
              {analysis?.timeSeries.length && activeChartIndices.length ? (
                <TimeSeriesChart data={analysis.timeSeries} indices={activeChartIndices} />
              ) : (
                <div className="grid h-full place-items-center rounded-md bg-[#f6f8f4] text-center text-sm text-ink/55">
                  <p className="font-medium text-ink/70">
                    {analysis?.timeSeries.length ? "Nenhum índice selecionado" : "Sem série temporal disponível"}
                  </p>
                </div>
              )}
            </div>
          </button>
        </div>
      </aside>

      {timelineModalOpen && analysis?.timeSeries.length && (
        <TimelineModal
          data={analysis.timeSeries}
          indices={activeChartIndices}
          onClose={() => setTimelineModalOpen(false)}
        />
      )}
    </main>
  );
}

function TimelineModal({
  data,
  indices,
  onClose
}: {
  data: TimeSeriesPoint[];
  indices: SpectralIndex[];
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-[720] flex items-center justify-center bg-ink/35 p-4">
      <button className="absolute inset-0 cursor-default" aria-label="Fechar série temporal" onClick={onClose} />
      <section className="surface relative flex max-h-[calc(100dvh-32px)] w-full max-w-5xl flex-col rounded-lg shadow-soft">
        <div className="flex items-start justify-between gap-3 border-b border-ink/10 p-4">
          <div>
            <h2 className="text-lg font-semibold">Série temporal da AOI</h2>
            <p className="mt-1 text-sm text-ink/60">Métricas exibidas: {formatIndexList(indices)}.</p>
          </div>
          <button
            className="grid size-9 shrink-0 place-items-center rounded-md border border-ink/10 bg-white text-ink transition hover:border-canopy hover:text-canopy"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>
        <div className="h-[min(64vh,560px)] min-h-[320px] p-4">
          {indices.length ? (
            <TimeSeriesChart data={data} indices={indices} />
          ) : (
            <div className="grid h-full place-items-center rounded-md bg-[#f6f8f4] text-center text-sm text-ink/55">
              <p className="font-medium text-ink/70">Nenhum índice Sentinel selecionado no gerenciador de camadas.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function TimeSeriesChart({ data, indices }: { data: TimeSeriesPoint[]; indices: SpectralIndex[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="#d6ded1" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis domain={[-1, 1]} tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(value, name) => [
            formatTooltipValue(value),
            INDEX_OPTIONS[name as SpectralIndex]?.label ?? String(name)
          ]}
        />
        {indices.map((index) => (
          <Line
            key={index}
            connectNulls
            dataKey={index}
            dot={false}
            name={INDEX_OPTIONS[index].label}
            stroke={INDEX_LINE_COLORS[index]}
            strokeWidth={2}
            type="monotone"
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function describeSentinelLayer(layer: AnalysisResponse["layers"][number] | undefined, hasAnalysis: boolean) {
  if (!hasAnalysis) {
    return "seleção pronta; processe a análise para carregar no mapa.";
  }

  if (layer?.available) {
    return "visível no mapa quando marcado.";
  }

  return layer?.unavailableReason ?? "camada indisponível no processamento atual.";
}

function formatIndexList(indices: SpectralIndex[]) {
  if (!indices.length) {
    return "nenhum índice selecionado";
  }

  return indices.map((index) => INDEX_OPTIONS[index].label).join(", ");
}

function formatTooltipValue(value: unknown) {
  return typeof value === "number" ? value.toFixed(3) : String(value);
}

function SettingsPanel({
  drawingStyle,
  indexOpacity,
  layerPalette,
  onClose,
  onDrawingStyleChange,
  onIndexOpacityChange,
  onLayerPaletteChange,
  onReset,
  onThemeChange,
  themeMode
}: {
  drawingStyle: DrawingStyle;
  indexOpacity: number;
  layerPalette: LayerPalette;
  onClose: () => void;
  onDrawingStyleChange: (style: DrawingStyle) => void;
  onIndexOpacityChange: (opacity: number) => void;
  onLayerPaletteChange: (palette: LayerPalette) => void;
  onReset: () => void;
  onThemeChange: (theme: ThemeMode) => void;
  themeMode: ThemeMode;
}) {
  return (
    <div className="absolute inset-0 z-[700]">
      <button className="absolute inset-0 cursor-default bg-ink/20" aria-label="Fechar configurações" onClick={onClose} />
      <section className="surface thin-scrollbar absolute bottom-4 right-4 top-4 w-[calc(100vw-32px)] max-w-[380px] overflow-y-auto rounded-lg p-4 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-canopy">
              <Settings size={14} />
              aparência
            </div>
            <h2 className="text-lg font-semibold">Configurações</h2>
          </div>
          <button
            className="grid size-9 place-items-center rounded-md border border-ink/10 bg-white text-ink transition hover:border-canopy hover:text-canopy"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Tema</h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["light", "Light"],
              ["dark", "Dark"]
            ].map(([value, label]) => (
              <button
                key={value}
                className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
                  themeMode === value ? "border-canopy bg-canopy/10 text-canopy" : "border-ink/10 bg-white text-ink/70"
                }`}
                onClick={() => onThemeChange(value as ThemeMode)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <Divider />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Camadas de índice</h3>
          <label className="block text-xs font-medium text-ink/70">
            <span className="flex items-center justify-between">
              <span>opacidade</span>
              <span>{Math.round(indexOpacity * 100)}%</span>
            </span>
            <input
              className="mt-2 w-full accent-canopy"
              type="range"
              min="0.15"
              max="0.9"
              step="0.05"
              value={indexOpacity}
              onChange={(event) => onIndexOpacityChange(Number(event.target.value))}
            />
          </label>
          <ColorGrid
            colors={[
              ["low", "baixo", layerPalette.low],
              ["midLow", "médio baixo", layerPalette.midLow],
              ["midHigh", "médio alto", layerPalette.midHigh],
              ["high", "alto", layerPalette.high]
            ]}
            onChange={(key, value) => onLayerPaletteChange({ ...layerPalette, [key]: value })}
          />
        </section>

        <Divider />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Desenho da AOI</h3>
          <ColorGrid
            colors={[
              ["strokeColor", "linha", drawingStyle.strokeColor],
              ["fillColor", "preenchimento", drawingStyle.fillColor]
            ]}
            onChange={(key, value) => onDrawingStyleChange({ ...drawingStyle, [key]: value })}
          />
          <label className="block text-xs font-medium text-ink/70">
            <span className="flex items-center justify-between">
              <span>espessura da linha</span>
              <span>{drawingStyle.strokeWidth}px</span>
            </span>
            <input
              className="mt-2 w-full accent-canopy"
              type="range"
              min="1"
              max="6"
              step="1"
              value={drawingStyle.strokeWidth}
              onChange={(event) => onDrawingStyleChange({ ...drawingStyle, strokeWidth: Number(event.target.value) })}
            />
          </label>
          <label className="block text-xs font-medium text-ink/70">
            <span className="flex items-center justify-between">
              <span>opacidade do preenchimento</span>
              <span>{Math.round(drawingStyle.fillOpacity * 100)}%</span>
            </span>
            <input
              className="mt-2 w-full accent-canopy"
              type="range"
              min="0"
              max="0.5"
              step="0.02"
              value={drawingStyle.fillOpacity}
              onChange={(event) => onDrawingStyleChange({ ...drawingStyle, fillOpacity: Number(event.target.value) })}
            />
          </label>
        </section>

        <button
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-md border border-ink/10 bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:border-canopy hover:text-canopy"
          onClick={onReset}
        >
          <RotateCcw size={16} />
          Restaurar padrão
        </button>
      </section>
    </div>
  );
}

function ColorGrid({
  colors,
  onChange
}: {
  colors: Array<[string, string, string]>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {colors.map(([key, label, value]) => (
        <label key={key} className="rounded-md border border-ink/10 bg-white p-3 text-xs font-medium text-ink/70">
          <span className="mb-2 block">{label}</span>
          <div className="flex items-center gap-2">
            <input
              className="size-9 cursor-pointer rounded-md border-0 bg-transparent p-0"
              type="color"
              value={value}
              onChange={(event) => onChange(key, event.target.value)}
            />
            <span className="font-mono text-[11px] uppercase text-ink/60">{value}</span>
          </div>
        </label>
      ))}
    </div>
  );
}

function withConfiguredPalette(
  legend: Array<{ color: string; label: string }>,
  palette: LayerPalette
) {
  const colors = [palette.low, palette.midLow, palette.midHigh, palette.high];
  return legend.map((stop, index) => ({
    ...stop,
    color: colors[index] ?? stop.color
  }));
}

function formatFeatureCount(count: number) {
  return `${count} ${count === 1 ? "feição" : "feições"}`;
}

function formatCarFileName(fileName: string) {
  return fileName.replace(/\.zip$/i, "");
}

function createClientId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function Divider() {
  return <div className="my-5 h-px bg-ink/10" />;
}

function LabeledInput({
  label,
  value,
  type,
  onChange
}: {
  label: string;
  value: string;
  type: "date";
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs font-medium text-ink/70">
      {label}
      <input
        className="mt-1 w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-sm outline-none focus:border-canopy"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
