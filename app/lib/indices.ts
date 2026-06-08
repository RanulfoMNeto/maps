export type SpectralIndex = "ndvi" | "ndmi" | "mndwi" | "nbr" | "dnbr" | "bsi" | "ndre";

export type ClassificationKey =
  | "water"
  | "persistentVegetation"
  | "exposedSoil"
  | "possibleBurn"
  | "degradation"
  | "recentChange";

export type ValidationStatus = "indicative_not_validated" | "field_validated";

export type AnalysisMode = "custom" | "dry" | "rainy" | "month" | "year" | "before_after";

export type GeoJsonPolygon = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
};

export type AnalysisRequest = {
  aoi: GeoJsonPolygon;
  dateFrom: string;
  dateTo: string;
  mode: AnalysisMode;
  compareFrom?: string;
  compareTo?: string;
  cloudCoverMax: number;
  selectedIndices: SpectralIndex[];
};

export type TimeSeriesPoint = {
  date: string;
  ndvi?: number;
  ndmi?: number;
  mndwi?: number;
  nbr?: number;
  dnbr?: number;
  bsi?: number;
  ndre?: number;
};

export type Indicator = {
  key: ClassificationKey;
  label: string;
  value: string;
  confidence: "low" | "medium" | "high" | "unavailable";
  description: string;
};

export type RasterLayer = {
  index: SpectralIndex;
  label: string;
  tileUrl?: string;
  legend: LegendStop[];
  available: boolean;
  unavailableReason?: string;
};

export type LegendStop = {
  color: string;
  label: string;
};

export type AnalysisResponse = {
  provider: "sentinel_hub" | "google_earth_engine" | "not_configured";
  providerStatus: "ready" | "provider_unconfigured" | "error";
  validationStatus: ValidationStatus;
  generatedAt: string;
  message: string;
  layers: RasterLayer[];
  indicators: Indicator[];
  timeSeries: TimeSeriesPoint[];
  exports: {
    geotiff: boolean;
    png: boolean;
    csv: boolean;
    geojson: boolean;
    pdf: boolean;
  };
};

export const INDEX_OPTIONS: Record<SpectralIndex, { label: string; formula: string; purpose: string }> = {
  ndvi: {
    label: "NDVI",
    formula: "(B08 - B04) / (B08 + B04)",
    purpose: "vigor e cobertura vegetal"
  },
  ndmi: {
    label: "NDMI",
    formula: "(B08 - B11) / (B08 + B11)",
    purpose: "umidade da vegetação e estresse hídrico"
  },
  mndwi: {
    label: "MNDWI",
    formula: "(B03 - B11) / (B03 + B11)",
    purpose: "água superficial provável"
  },
  nbr: {
    label: "NBR",
    formula: "(B08 - B12) / (B08 + B12)",
    purpose: "severidade e cicatriz de queimada"
  },
  dnbr: {
    label: "dNBR",
    formula: "NBR antes - NBR depois",
    purpose: "mudança pós-fogo ou distúrbio"
  },
  bsi: {
    label: "BSI",
    formula: "((B11 + B04) - (B08 + B02)) / ((B11 + B04) + (B08 + B02))",
    purpose: "solo exposto e baixa cobertura"
  },
  ndre: {
    label: "NDRE",
    formula: "(B08 - B05) / (B08 + B05)",
    purpose: "vigor em vegetação densa e agricultura"
  }
};

export const INDEX_LEGENDS: Record<SpectralIndex, LegendStop[]> = {
  ndvi: [
    { color: "#7f3b08", label: "< 0.15 baixo" },
    { color: "#f1b75b", label: "0.15-0.35 ralo" },
    { color: "#94c66b", label: "0.35-0.60 médio" },
    { color: "#1d6a4a", label: "> 0.60 alto" }
  ],
  ndmi: [
    { color: "#8a5f36", label: "seco" },
    { color: "#d7c36a", label: "moderado" },
    { color: "#4fa58f", label: "úmido" },
    { color: "#1d5d83", label: "muito úmido" }
  ],
  mndwi: [
    { color: "#8d7e6d", label: "não água" },
    { color: "#c9ddd6", label: "incerto" },
    { color: "#55a6bd", label: "água provável" },
    { color: "#176582", label: "água forte" }
  ],
  nbr: [
    { color: "#4f2d1f", label: "baixo" },
    { color: "#be6a3a", label: "distúrbio" },
    { color: "#b4c66a", label: "vegetado" },
    { color: "#2f704e", label: "alto" }
  ],
  dnbr: [
    { color: "#306a48", label: "recuperação" },
    { color: "#e6d9a5", label: "sem mudança" },
    { color: "#d6843a", label: "mudança média" },
    { color: "#a8201a", label: "mudança forte" }
  ],
  bsi: [
    { color: "#245b4d", label: "coberto" },
    { color: "#b7c77a", label: "misto" },
    { color: "#c58d50", label: "solo provável" },
    { color: "#7d4e2f", label: "solo forte" }
  ],
  ndre: [
    { color: "#7a5237", label: "baixo" },
    { color: "#d5bf67", label: "médio" },
    { color: "#79ad5a", label: "alto" },
    { color: "#245f42", label: "muito alto" }
  ]
};

export function buildUnavailableIndicators(): Indicator[] {
  return [
    {
      key: "water",
      label: "Água provável",
      value: "sem dados",
      confidence: "unavailable",
      description: "Configure um provedor Sentinel para calcular MNDWI na área selecionada."
    },
    {
      key: "persistentVegetation",
      label: "Vegetação persistente",
      value: "sem dados",
      confidence: "unavailable",
      description: "Depende de série temporal NDVI/NDRE com máscara de nuvem."
    },
    {
      key: "exposedSoil",
      label: "Solo exposto",
      value: "sem dados",
      confidence: "unavailable",
      description: "Depende de BSI e baixa cobertura vegetal no período escolhido."
    },
    {
      key: "possibleBurn",
      label: "Possível queimada",
      value: "sem dados",
      confidence: "unavailable",
      description: "Depende de NBR/dNBR e comparação antes/depois."
    },
    {
      key: "degradation",
      label: "Degradação",
      value: "sem dados",
      confidence: "unavailable",
      description: "Exige tendência temporal, contexto territorial e validação."
    },
    {
      key: "recentChange",
      label: "Mudança recente",
      value: "sem dados",
      confidence: "unavailable",
      description: "Use comparação antes/depois quando houver provedor configurado."
    }
  ];
}

export function buildUnavailableLayers(indices: SpectralIndex[]): RasterLayer[] {
  return indices.map((index) => ({
    index,
    label: INDEX_OPTIONS[index].label,
    legend: INDEX_LEGENDS[index],
    available: false,
    unavailableReason: "Camada indisponível até configurar Sentinel Hub Process API/Statistical API ou Google Earth Engine."
  }));
}
