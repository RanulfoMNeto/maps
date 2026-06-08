import type { GeoJsonPolygon } from "./indices";

export type CarGeometry =
  | GeoJSON.Polygon
  | GeoJSON.MultiPolygon
  | GeoJSON.LineString
  | GeoJSON.MultiLineString
  | GeoJSON.Point
  | GeoJSON.MultiPoint;

export type CarFeature = GeoJSON.Feature<CarGeometry, Record<string, unknown>>;

export type CarLayer = {
  id: string;
  label: string;
  sourceName: string;
  projection?: string;
  color: string;
  features: CarFeature[];
  fields: string[];
};

export type CarImport = {
  fileName: string;
  layers: CarLayer[];
  warnings: string[];
};

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
};

type ShpGeometry = CarGeometry | null;

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;

const LAYER_COLORS: Record<string, string> = {
  area_do_imovel: "#047857",
  reserva_legal: "#1d6a4a",
  area_de_preservacao_permanente: "#2563eb",
  cobertura_do_solo: "#c58d50",
  servidao_administrativa: "#7c3aed",
  marcadores_area_de_preservacao_permanente: "#dc2626"
};

const LAYER_LABELS: Record<string, string> = {
  area_do_imovel: "Área do Imóvel",
  reserva_legal: "Reserva Legal",
  area_de_preservacao_permanente: "Área de Preservação Permanente",
  cobertura_do_solo: "Cobertura do Solo",
  servidao_administrativa: "Servidão Administrativa",
  marcadores_area_de_preservacao_permanente: "Marcadores de APP"
};

const FIELD_LABELS: Record<string, string> = {
  area: "Área",
  cod_estado: "UF",
  cod_imovel: "Código do imóvel",
  cod_tema: "Código do tema",
  des_condic: "Condição",
  estado: "Estado",
  ind_status: "Status",
  ind_tipo: "Tipo",
  mod_fiscal: "Módulos fiscais",
  modfiscais: "Módulos fiscais",
  municipio: "Município",
  nom_tema: "Tema",
  num_area: "Área",
  recibo: "Recibo CAR",
  tema: "Tema"
};

const SUMMARY_FIELD_ORDER = [
  "recibo",
  "cod_imovel",
  "municipio",
  "estado",
  "cod_estado",
  "tema",
  "nom_tema",
  "area",
  "num_area",
  "modfiscais",
  "mod_fiscal",
  "ind_status",
  "ind_tipo",
  "des_condic"
];

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const WINDOWS_1252_DECODER = new TextDecoder("windows-1252");
const DISPLAY_NUMBER_FORMAT = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 4
});

export async function parseCarZip(file: File): Promise<CarImport> {
  const buffer = await file.arrayBuffer();
  const topEntries = await readZip(buffer);
  const warnings: string[] = [];
  const layers: CarLayer[] = [];

  for (const entry of topEntries) {
    if (!entry.name.toLowerCase().endsWith(".zip")) {
      continue;
    }

    try {
      const nestedBuffer = await inflateZipEntry(buffer, entry);
      const layer = await parseShapefileZip(nestedBuffer, entry.name);
      if (layer.features.length) {
        layers.push(layer);
      }
    } catch (error) {
      warnings.push(`${entry.name}: ${error instanceof Error ? error.message : "falha ao ler camada"}`);
    }
  }

  if (!layers.length) {
    const directLayer = await parseShapefileZip(buffer, file.name).catch((error: unknown) => {
      warnings.push(error instanceof Error ? error.message : "ZIP sem shapefile reconhecido.");
      return null;
    });
    if (directLayer?.features.length) {
      layers.push(directLayer);
    }
  }

  if (!layers.length) {
    throw new Error("Nenhum shapefile de CAR foi encontrado no ZIP.");
  }

  return { fileName: file.name, layers, warnings };
}

export function carImportToAoi(carImport: CarImport): GeoJsonPolygon | null {
  const areaLayer =
    carImport.layers.find((layer) => normalizeName(layer.label).includes("area_do_imovel")) ?? carImport.layers[0];
  const polygon = areaLayer.features.find(
    (feature) => feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon"
  );

  if (!polygon) {
    return null;
  }

  if (polygon.geometry.type === "Polygon") {
    return {
      type: "Feature",
      properties: { ...polygon.properties, source: "CAR" },
      geometry: {
        type: "Polygon",
        coordinates: polygon.geometry.coordinates
      }
    };
  }

  const coordinates = polygon.geometry.coordinates as GeoJSON.MultiPolygon["coordinates"];

  return {
    type: "Feature",
    properties: { ...polygon.properties, source: "CAR" },
    geometry: {
      type: "Polygon",
      coordinates: coordinates[0]
    }
  };
}

export function summarizeCarProperties(carImport: CarImport) {
  const areaLayer = carImport.layers.find((layer) => normalizeName(layer.label).includes("area_do_imovel"));
  const properties = areaLayer?.features[0]?.properties ?? carImport.layers[0]?.features[0]?.properties ?? {};
  const entries = Object.entries(properties).filter(([, value]) => value !== null && value !== undefined && value !== "");
  const normalizedOrder = SUMMARY_FIELD_ORDER.map((field) => normalizeName(field));
  const ordered = [
    ...normalizedOrder
      .map((key) => entries.find(([field]) => normalizeName(field) === key))
      .filter((entry): entry is [string, unknown] => Boolean(entry)),
    ...entries.filter(([field]) => !normalizedOrder.includes(normalizeName(field)))
  ];

  return ordered.slice(0, 10).map(([key, value]) => ({
    key,
    label: formatCarFieldLabel(key),
    value: formatCarFieldValue(key, value)
  }));
}

export function formatCarFieldLabel(fieldName: string) {
  const normalized = normalizeName(fieldName);
  return FIELD_LABELS[normalized] ?? humanizeLayerName(fieldName);
}

export function formatCarFieldValue(fieldName: string, value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const normalized = normalizeName(fieldName);

  if (typeof value === "number") {
    const formatted = DISPLAY_NUMBER_FORMAT.format(value);
    return ["area", "num_area"].includes(normalized) ? `${formatted} ha` : formatted;
  }

  if (typeof value === "boolean") {
    return value ? "Sim" : "Não";
  }

  const text = repairMojibake(String(value).trim());
  if (!text) {
    return "";
  }

  if (["tema", "nom_tema"].includes(normalized)) {
    return LAYER_LABELS[normalizeName(text)] ?? text;
  }

  if (["area", "num_area"].includes(normalized)) {
    const numeric = Number(text.replace(",", "."));
    return Number.isFinite(numeric) ? `${DISPLAY_NUMBER_FORMAT.format(numeric)} ha` : text;
  }

  if (["mod_fiscal", "modfiscais"].includes(normalized)) {
    const numeric = Number(text.replace(",", "."));
    return Number.isFinite(numeric) ? DISPLAY_NUMBER_FORMAT.format(numeric) : text;
  }

  return text;
}

async function parseShapefileZip(buffer: ArrayBuffer, sourceName: string): Promise<CarLayer> {
  const entries = await readZip(buffer);
  const shpEntry = findEntry(entries, ".shp");
  const dbfEntry = findEntry(entries, ".dbf");
  const prjEntry = findEntry(entries, ".prj");

  if (!shpEntry) {
    throw new Error("arquivo .shp ausente");
  }

  const shpBuffer = await inflateZipEntry(buffer, shpEntry);
  const geometries = parseShp(shpBuffer);
  const records = dbfEntry ? parseDbf(await inflateZipEntry(buffer, dbfEntry)) : [];
  const projection = prjEntry ? decodeText(await inflateZipEntry(buffer, prjEntry)).trim() : undefined;
  const label = humanizeLayerName(sourceName.replace(/\.zip$/i, ""));
  const id = normalizeName(label);
  const color = LAYER_COLORS[id] ?? "#0f766e";

  const features = geometries
    .map((geometry, index): CarFeature | null => {
      if (!geometry) {
        return null;
      }

      return {
        type: "Feature",
        properties: records[index] ?? {},
        geometry
      };
    })
    .filter((feature): feature is CarFeature => Boolean(feature));

  return {
    id,
    label,
    sourceName,
    projection,
    color,
    features,
    fields: records[0] ? Object.keys(records[0]) : []
  };
}

async function readZip(buffer: ArrayBuffer): Promise<ZipEntry[]> {
  const view = new DataView(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY) {
      throw new Error("diretorio central ZIP invalido");
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decodeText(buffer.slice(offset + 46, offset + 46 + nameLength));

    if (view.getUint32(localHeaderOffset, true) !== ZIP_LOCAL_FILE_HEADER) {
      throw new Error(`cabecalho local ZIP invalido em ${name}`);
    }

    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;

    entries.push({ name, method, compressedSize, uncompressedSize, dataOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries.filter((entry) => !entry.name.endsWith("/"));
}

function findEndOfCentralDirectory(view: DataView) {
  const minimumOffset = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }

  throw new Error("arquivo ZIP invalido");
}

async function inflateZipEntry(sourceBuffer: ArrayBuffer, entry: ZipEntry): Promise<ArrayBuffer> {
  const compressed = sourceBuffer.slice(entry.dataOffset, entry.dataOffset + entry.compressedSize);

  if (entry.method === 0) {
    return compressed;
  }

  if (entry.method !== 8) {
    throw new Error(`metodo ZIP nao suportado: ${entry.method}`);
  }

  if (typeof DecompressionStream === "undefined") {
    throw new Error("este navegador nao suporta descompressao ZIP local");
  }

  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const output = await new Response(stream).arrayBuffer();

  if (entry.uncompressedSize && output.byteLength !== entry.uncompressedSize) {
    throw new Error(`tamanho descomprimido inesperado em ${entry.name}`);
  }

  return output;
}

function parseShp(buffer: ArrayBuffer): ShpGeometry[] {
  const view = new DataView(buffer);
  const geometries: ShpGeometry[] = [];
  let offset = 100;

  while (offset + 8 <= view.byteLength) {
    const contentLength = view.getInt32(offset + 4, false) * 2;
    const contentOffset = offset + 8;

    if (contentLength <= 0 || contentOffset + contentLength > view.byteLength) {
      break;
    }

    geometries.push(parseShapeRecord(view, contentOffset));
    offset = contentOffset + contentLength;
  }

  return geometries;
}

function parseShapeRecord(view: DataView, offset: number): ShpGeometry {
  const shapeType = view.getInt32(offset, true);

  if (shapeType === 0) {
    return null;
  }

  if (shapeType === 1 || shapeType === 11 || shapeType === 21) {
    return {
      type: "Point",
      coordinates: [view.getFloat64(offset + 4, true), view.getFloat64(offset + 12, true)]
    };
  }

  if (shapeType === 3 || shapeType === 13 || shapeType === 23) {
    return parsePolyShape(view, offset, "LineString");
  }

  if (shapeType === 5 || shapeType === 15 || shapeType === 25) {
    return parsePolyShape(view, offset, "Polygon");
  }

  if (shapeType === 8 || shapeType === 18 || shapeType === 28) {
    const numberOfPoints = view.getInt32(offset + 36, true);
    const coordinates: number[][] = [];
    let pointOffset = offset + 40;
    for (let index = 0; index < numberOfPoints; index += 1) {
      coordinates.push([view.getFloat64(pointOffset, true), view.getFloat64(pointOffset + 8, true)]);
      pointOffset += 16;
    }
    return { type: "MultiPoint", coordinates };
  }

  return null;
}

function parsePolyShape(view: DataView, offset: number, target: "Polygon" | "LineString") {
  const numberOfParts = view.getInt32(offset + 36, true);
  const numberOfPoints = view.getInt32(offset + 40, true);
  const partStartOffset = offset + 44;
  const pointStartOffset = partStartOffset + numberOfParts * 4;
  const partStarts: number[] = [];

  for (let index = 0; index < numberOfParts; index += 1) {
    partStarts.push(view.getInt32(partStartOffset + index * 4, true));
  }

  const points: number[][] = [];
  for (let index = 0; index < numberOfPoints; index += 1) {
    const pointOffset = pointStartOffset + index * 16;
    points.push([view.getFloat64(pointOffset, true), view.getFloat64(pointOffset + 8, true)]);
  }

  const parts = partStarts.map((start, index) => points.slice(start, partStarts[index + 1] ?? points.length));

  if (target === "LineString") {
    return parts.length === 1
      ? ({ type: "LineString", coordinates: parts[0] } satisfies GeoJSON.LineString)
      : ({ type: "MultiLineString", coordinates: parts } satisfies GeoJSON.MultiLineString);
  }

  const polygons: number[][][][] = [];
  let currentPolygon: number[][][] | null = null;

  parts.forEach((ring) => {
    const closedRing = ensureClosedRing(ring);
    if (signedRingArea(closedRing) > 0 || !currentPolygon) {
      currentPolygon = [closedRing];
      polygons.push(currentPolygon);
      return;
    }
    currentPolygon.push(closedRing);
  });

  if (polygons.length <= 1) {
    return { type: "Polygon", coordinates: polygons[0] ?? [] } satisfies GeoJSON.Polygon;
  }

  return { type: "MultiPolygon", coordinates: polygons } satisfies GeoJSON.MultiPolygon;
}

function parseDbf(buffer: ArrayBuffer): Array<Record<string, unknown>> {
  const view = new DataView(buffer);
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const fields: Array<{ name: string; type: string; length: number; decimal: number; offset: number }> = [];
  let offset = 32;
  let fieldOffset = 1;

  while (offset < headerLength && view.getUint8(offset) !== 0x0d) {
    const nameBytes = new Uint8Array(buffer.slice(offset, offset + 11));
    const nullIndex = nameBytes.indexOf(0);
    const name = decodeText(nameBytes.slice(0, nullIndex === -1 ? undefined : nullIndex)).trim();
    const type = String.fromCharCode(view.getUint8(offset + 11));
    const length = view.getUint8(offset + 16);
    const decimal = view.getUint8(offset + 17);
    fields.push({ name, type, length, decimal, offset: fieldOffset });
    fieldOffset += length;
    offset += 32;
  }

  const records: Array<Record<string, unknown>> = [];
  for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
    const recordOffset = headerLength + recordIndex * recordLength;
    if (view.getUint8(recordOffset) === 0x2a) {
      continue;
    }

    const record: Record<string, unknown> = {};
    fields.forEach((field) => {
      const valueBuffer = buffer.slice(recordOffset + field.offset, recordOffset + field.offset + field.length);
      record[field.name] = parseDbfValue(decodeText(valueBuffer).trim(), field.type, field.decimal);
    });
    records.push(record);
  }

  return records;
}

function parseDbfValue(value: string, type: string, decimal: number) {
  if (!value) {
    return "";
  }

  if (type === "N" || type === "F") {
    const numeric = Number(value.replace(",", "."));
    return Number.isFinite(numeric) ? numeric : value;
  }

  if (type === "L") {
    return ["Y", "y", "T", "t", "S", "s"].includes(value);
  }

  if (type === "D" && /^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  if (decimal > 0) {
    const numeric = Number(value.replace(",", "."));
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return value;
}

function findEntry(entries: ZipEntry[], extension: string) {
  return entries.find((entry) => entry.name.toLowerCase().endsWith(extension));
}

function decodeText(buffer: ArrayBuffer | Uint8Array) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    return WINDOWS_1252_DECODER.decode(bytes);
  }
}

function humanizeLayerName(name: string) {
  const normalized = normalizeName(name);
  if (LAYER_LABELS[normalized]) {
    return LAYER_LABELS[normalized];
  }

  return repairMojibake(name)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replace(/(^|\s)(\p{L})/gu, (_match, space: string, letter: string) => `${space}${letter.toLocaleUpperCase("pt-BR")}`);
}

function normalizeName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function ensureClosedRing(ring: number[][]) {
  if (ring.length < 2) {
    return ring;
  }

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring;
  }

  return [...ring, first];
}

function signedRingArea(ring: number[][]) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];
    area += (next[0] - current[0]) * (next[1] + current[1]);
  }
  return area;
}

function repairMojibake(value: string) {
  if (!/[ÃÂ�]/.test(value)) {
    return value;
  }

  const bytes = new Uint8Array([...value].map((character) => character.charCodeAt(0) & 0xff));
  try {
    const repaired = UTF8_DECODER.decode(bytes);
    return mojibakeScore(repaired) < mojibakeScore(value) ? repaired : value;
  } catch {
    return value;
  }
}

function mojibakeScore(value: string) {
  return (value.match(/[ÃÂ�]/g) ?? []).length;
}
