export type StandardCarLayerKind =
  | "property"
  | "app"
  | "hydrography"
  | "vegetation"
  | "land_use"
  | "legal_reserve"
  | "restricted_use"
  | "easement";

export type StandardCarLayerDefinition = {
  id: string;
  label: string;
  tableName: string;
  zipFile: string;
  alternateZipFiles?: string[];
  color: string;
  fillOpacity: number;
  minZoom: number;
  defaultVisible: boolean;
  kind: StandardCarLayerKind;
  description: string;
};

export type StandardCarStateDefinition = {
  id: string;
  label: string;
  uf: string;
  sourceDir: string;
  databaseFile: string;
  areaTableName: string;
  layers: StandardCarLayerDefinition[];
};

export type StandardCarCity = {
  name: string;
  uf: string;
};

export type StandardCarLayerMetadata = StandardCarLayerDefinition & {
  prepared: boolean;
};

export type StandardCarStateMetadata = Omit<StandardCarStateDefinition, "layers"> & {
  prepared: boolean;
  cities: StandardCarCity[];
  layers: StandardCarLayerMetadata[];
};

export type StandardCarMetadata = {
  generatedAt: string;
  states: StandardCarStateMetadata[];
};

export type StandardCarMapLayer = Pick<
  StandardCarLayerDefinition,
  "id" | "label" | "color" | "fillOpacity" | "minZoom"
> & {
  stateId: string;
};

export type StandardCarMapFilters = {
  stateId: string;
  municipality: string;
};

export const STANDARD_CAR_STATES: StandardCarStateDefinition[] = [
  {
    id: "minas_gerais",
    label: "Minas Gerais",
    uf: "MG",
    sourceDir: "car/minas_gerais",
    databaseFile: "data/car-standard/minas_gerais.gpkg",
    areaTableName: "car_mg_area_imovel",
    layers: [
      {
        id: "area_imovel",
        label: "Área do Imóvel",
        tableName: "car_mg_area_imovel",
        zipFile: "AREA_IMOVEL.zip",
        color: "#047857",
        fillOpacity: 0.08,
        minZoom: 9,
        defaultVisible: false,
        kind: "property",
        description: "Polígono declarado do imóvel rural."
      },
      {
        id: "apps",
        label: "APP",
        tableName: "car_mg_apps",
        zipFile: "APPS.zip",
        alternateZipFiles: ["outros/APPS.zip"],
        color: "#2563eb",
        fillOpacity: 0.18,
        minZoom: 10,
        defaultVisible: false,
        kind: "app",
        description: "Áreas de Preservação Permanente declaradas."
      },
      {
        id: "reserva_legal",
        label: "Reserva Legal",
        tableName: "car_mg_reserva_legal",
        zipFile: "RESERVA_LEGAL.zip",
        color: "#1d6a4a",
        fillOpacity: 0.16,
        minZoom: 10,
        defaultVisible: false,
        kind: "legal_reserve",
        description: "Reserva Legal declarada."
      },
      {
        id: "vegetacao_nativa",
        label: "Vegetação Nativa",
        tableName: "car_mg_vegetacao_nativa",
        zipFile: "VEGETACAO_NATIVA.zip",
        color: "#16a34a",
        fillOpacity: 0.18,
        minZoom: 10,
        defaultVisible: false,
        kind: "vegetation",
        description: "Remanescentes de vegetação nativa declarados."
      },
      {
        id: "hidrografia",
        label: "Hidrografia",
        tableName: "car_mg_hidrografia",
        zipFile: "HIDROGRAFIA.zip",
        alternateZipFiles: ["outros/HIDROGRAFIA.zip"],
        color: "#0ea5e9",
        fillOpacity: 0.12,
        minZoom: 10,
        defaultVisible: false,
        kind: "hydrography",
        description: "Hidrografia declarada nas bases do CAR."
      },
      {
        id: "area_consolidada",
        label: "Área Consolidada",
        tableName: "car_mg_area_consolidada",
        zipFile: "AREA_CONSOLIDADA.zip",
        color: "#c58d50",
        fillOpacity: 0.18,
        minZoom: 10,
        defaultVisible: false,
        kind: "land_use",
        description: "Área rural consolidada declarada."
      },
      {
        id: "uso_restrito",
        label: "Uso Restrito",
        tableName: "car_mg_uso_restrito",
        zipFile: "USO_RESTRITO.zip",
        color: "#7c3aed",
        fillOpacity: 0.16,
        minZoom: 10,
        defaultVisible: false,
        kind: "restricted_use",
        description: "Área de uso restrito declarada."
      },
      {
        id: "servidao_administrativa",
        label: "Servidão Administrativa",
        tableName: "car_mg_servidao_administrativa",
        zipFile: "SERVIDAO_ADMINISTRATIVA.zip",
        color: "#9333ea",
        fillOpacity: 0.16,
        minZoom: 10,
        defaultVisible: false,
        kind: "easement",
        description: "Servidão administrativa declarada."
      },
      {
        id: "area_pousio",
        label: "Área de Pousio",
        tableName: "car_mg_area_pousio",
        zipFile: "AREA_POUSIO.zip",
        color: "#d97706",
        fillOpacity: 0.18,
        minZoom: 10,
        defaultVisible: false,
        kind: "land_use",
        description: "Área de pousio declarada."
      }
    ]
  }
];

export function findStandardCarState(stateId: string) {
  return STANDARD_CAR_STATES.find((state) => state.id === stateId);
}

export function findStandardCarLayer(stateId: string, layerId: string) {
  return findStandardCarState(stateId)?.layers.find((layer) => layer.id === layerId);
}
