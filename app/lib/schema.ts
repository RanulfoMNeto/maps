import { z } from "zod";

export const spectralIndexSchema = z.enum(["ndvi", "ndmi", "mndwi", "nbr", "dnbr", "bsi", "ndre"]);

export const analysisRequestSchema = z.object({
  aoi: z.object({
    type: z.literal("Feature"),
    properties: z.record(z.unknown()).default({}),
    geometry: z.object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1)
    })
  }),
  dateFrom: z.string().min(10),
  dateTo: z.string().min(10),
  mode: z.enum(["custom", "dry", "rainy", "month", "year", "before_after"]),
  compareFrom: z.string().optional(),
  compareTo: z.string().optional(),
  cloudCoverMax: z.number().min(0).max(100),
  selectedIndices: z.array(spectralIndexSchema).min(1)
});
