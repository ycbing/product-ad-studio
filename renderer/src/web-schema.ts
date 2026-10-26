import { z } from "zod";
export const webSchema = z.object({
  format: z.literal("9:16"),
  productName: z.string(),
  brand: z.string(),
  price: z.string().optional(),
  offer: z.string().optional(),
  cta: z.string().optional(),
  music: z.string().nullable(),
  shots: z
    .array(
      z.object({
        id: z.string(),
        headline: z.string(),
        caption: z.string(),
        seconds: z.number(),
        source: z.string(),
        kind: z.enum(["image", "video"]),
        fit: z.enum(["cover", "contain"]),
        trimBefore: z.number(),
        audio: z.string().nullable(),
        voiceSeconds: z.number(),
      }),
    )
    .length(5),
});
export type WebProps = z.infer<typeof webSchema>;
