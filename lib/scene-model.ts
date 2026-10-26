import { z } from "zod";
export const sceneRoles = [
  "context",
  "prepare",
  "action",
  "detail",
  "result",
] as const;
export const roleNames: Record<(typeof sceneRoles)[number], string> = {
  context: "环境与人物",
  prepare: "准备操作",
  action: "主要使用动作",
  detail: "使用细节",
  result: "使用结果",
};
export const subjectBoxSchema = z
  .object({
    left: z.number().min(0).max(100),
    top: z.number().min(0).max(100),
    right: z.number().min(0).max(100),
    bottom: z.number().min(0).max(100),
  })
  .refine(
    (b) => b.right > b.left && b.bottom > b.top,
    "保护区域的右下边界须大于左上边界",
  );
export const segmentSchema = z
  .object({
    id: z.string().uuid(),
    role: z.enum(sceneRoles),
    start: z.number().min(0),
    end: z.number().positive(),
    label: z.string().trim().min(1).max(100),
    focusX: z.number().min(0).max(100),
    focusY: z.number().min(0).max(100),
    zoom: z.number().min(1).max(1.6),
    subject: subjectBoxSchema,
  })
  .refine((s) => s.end - s.start >= 1, "每段至少一秒");
export const reviewInputSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    assetId: z.string().uuid(),
    continuityKey: z.string().trim().min(1).max(80),
    confirmed: z.literal(true),
    segments: z.array(segmentSchema).min(1).max(15),
  })
  .refine(
    (r) => new Set(r.segments.map((s) => s.id)).size === r.segments.length,
    "片段编号重复",
  );
export type SceneSegment = z.infer<typeof segmentSchema>;
export type SceneReview = {
  id: string;
  sha256: string;
  productIdentity: string;
  continuityKey: string;
  confirmed: true;
  segments: SceneSegment[];
};

export function productIdentity(p: { name: string; brand: string }) {
  return JSON.stringify([
    p.name.trim().normalize("NFKC").toLowerCase(),
    p.brand.trim().normalize("NFKC").toLowerCase(),
  ]);
}
