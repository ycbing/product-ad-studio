import { z } from "zod";
import type { SceneReview } from "./scene-model";
export const productSchema = z.object({
  name: z.string().max(40),
  benefits: z.array(z.string().max(100)).max(6),
  audience: z.string().max(100),
  scene: z.string().max(100),
  price: z.string().max(40),
  offer: z.string().max(80),
  brand: z.string().max(40),
  cta: z.string().max(60),
  forbidden: z.string().max(300),
});
export const shotSchema = z.object({
  id: z.string().uuid(),
  headline: z
    .string()
    .trim()
    .min(1)
    .max(48)
    .refine((v) => v.split(/\r?\n/).length <= 3, "主文案最多三行"),
  caption: z.string().max(80),
  seconds: z.number().min(1).max(10).multipleOf(0.5),
  assetId: z.string().uuid().nullable(),
  trimBefore: z.number().min(0),
  role: z.enum(["context", "prepare", "action", "detail", "result"]).optional(),
  reviewId: z.string().uuid().optional(),
  segmentId: z.string().uuid().optional(),
  textPlacement: z.enum(["top", "bottom"]).optional(),
  textMode: z.enum(["title", "subtitle", "none"]).optional(),
  zoom: z.number().min(1).max(1.6).optional(),
  sourceVolume: z.number().min(0).max(1).optional(),
  focusX: z.number().min(0).max(100).optional(),
  focusY: z.number().min(0).max(100).optional(),
  description: z.string().max(300),
  allowGenerated: z.literal(false),
  fit: z.enum(["cover", "contain"]),
});
export const shotsSchema = z
  .array(shotSchema)
  .length(5)
  .superRefine((shots, ctx) => {
    const total = shots.reduce((n, s) => n + s.seconds, 0);
    if (total < 15 || total > 25)
      ctx.addIssue({ code: "custom", message: "总时长须为 15–25 秒" });
    if (new Set(shots.map((s) => s.id)).size !== 5)
      ctx.addIssue({ code: "custom", message: "镜头编号重复" });
  });
export const projectPatch = z.object({
  productionMode: z.enum(["scene", "presentation"]).optional(),
  sceneGroup: z.string().trim().max(80).optional(),
  expectedRevision: z.number().int().positive(),
  product: productSchema,
  shots: z.array(shotSchema).max(5),
  ttsEnabled: z.boolean(),
  musicEnabled: z.boolean(),
});
export type Product = z.infer<typeof productSchema>;
export type Shot = z.infer<typeof shotSchema>;
export type Concept = {
  id: string;
  title: string;
  hook: string;
  summary: string;
  source: "rule" | "model";
  estimatedSeconds: number;
  shots: Shot[];
};
export type Project = {
  productionMode?: "scene" | "presentation";
  sceneGroup?: string;
  id: string;
  revision: number;
  status: string;
  product: Product;
  concepts: Concept[];
  selectedConceptId: string | null;
  shots: Shot[];
  ttsEnabled: boolean;
  musicEnabled?: boolean;
  coverUrl?: string;
  createdAt: string;
  updatedAt: string;
};
export type Asset = {
  sceneReview?: SceneReview;
  id: string;
  projectId: string;
  name: string;
  mime: string;
  kind: "image" | "video";
  width: number;
  height: number;
  duration: number | null;
  sha256: string;
  source: string;
  url: string;
};
export type Job = {
  id: string;
  projectId: string;
  revision: number;
  kind: "sample" | "render" | "voice";
  shotId: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  stage: string;
  error: string | null;
  retryable: boolean;
  attempts: number;
  createdAt: string;
};
export type Artifact = {
  pipelineVersion?: string;
  id: string;
  jobId: string;
  projectId: string;
  revision: number;
  kind: "sample" | "render" | "voice";
  url: string;
  width: number;
  height: number;
  duration: number;
  createdAt: string;
};
export const emptyProduct: Product = {
  name: "",
  benefits: [],
  audience: "",
  scene: "",
  price: "",
  offer: "",
  brand: "",
  cta: "查看商品详情",
  forbidden: "",
};
export function isStale(
  p: Pick<Project, "revision">,
  a: Pick<Artifact, "revision">,
) {
  return p.revision !== a.revision;
}
export function assertReady(p: Product) {
  if (!p.name.trim() || !p.audience.trim() || !p.benefits.some((x) => x.trim()))
    throw new Error("请填写商品名、目标人群及至少一个已确认卖点");
}
export function validateSources(shots: Shot[], assets: Asset[]) {
  shotsSchema.parse(shots);
  for (const shot of shots) {
    const a = assets.find((a) => a.id === shot.assetId);
    if (!a) throw new Error("请为每个镜头选择自己的商品素材");
    if (
      a.kind === "video" &&
      shot.trimBefore + shot.seconds > (a.duration ?? 0) + 0.001
    )
      throw new Error(
        `镜头素材只有 ${a.duration?.toFixed(1)} 秒，请缩短镜头或调整起点`,
      );
  }
}
