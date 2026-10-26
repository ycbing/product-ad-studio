import { randomUUID, createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool, transaction } from "../lib/db";
import { ownerId } from "../lib/local-access";
import { storagePath, prepareStorage } from "../lib/storage";
import { ruleConcepts } from "../lib/concepts";
if (
  !(await pool.query("SELECT 1 FROM projects WHERE owner_id=$1", [ownerId()]))
    .rowCount
) {
  await prepareStorage();
  await mkdir(storagePath("assets"), { recursive: true });
  const id = randomUUID();
  const product = {
    name: "玻璃收纳罐",
    benefits: [
      "透明罐身，内容一眼看清",
      "常用食材，分开整理",
      "按自己的习惯摆放",
    ],
    audience: "喜欢整理厨房的家庭用户",
    scene: "厨房收纳",
    price: "",
    offer: "",
    brand: "DAILY OBJECTS",
    cta: "选择适合你的尺寸",
    forbidden: "不宣传密封、防潮、耐热等未验证功能",
  };
  await transaction(async (c) => {
    await c.query(
      "INSERT INTO projects(id,owner_id,document) VALUES($1,$2,$3)",
      [id, ownerId(), {}],
    );
    const list = [];
    for (const [file, mime, width, height, duration] of [
      ["public/demo/cover.png", "image/png", 540, 960, null],
      ["renderer/public/footage/shelf.mp4", "video/mp4", 1080, 1920, 10.466667],
      ["renderer/public/footage/counter.mp4", "video/mp4", 1920, 1080, 11.1],
    ] as const) {
      const aid = randomUUID(),
        key = `assets/${aid}${path.extname(file)}`;
      await copyFile(file, storagePath(key));
      const asset = {
        id: aid,
        projectId: id,
        name: path.basename(file),
        mime,
        kind: mime.startsWith("image")
          ? ("image" as const)
          : ("video" as const),
        width,
        height,
        duration,
        sha256: createHash("sha256")
          .update(await readFile(file))
          .digest("hex"),
        source: "RDNE / Pexels · 实拍品类演示素材",
        url: `/api/assets/${aid}`,
      };
      await c.query(
        "INSERT INTO assets(id,project_id,owner_id,storage_key,metadata) VALUES($1,$2,$3,$4,$5)",
        [aid, id, ownerId(), key, asset],
      );
      list.push(asset);
    }
    const concepts = ruleConcepts(product, list);
    await c.query("UPDATE projects SET document=$1 WHERE id=$2", [
      {
        product,
        concepts,
        selectedConceptId: concepts[0].id,
        shots: concepts[0].shots,
        ttsEnabled: true,
        musicEnabled: true,
      },
      id,
    ]);
  });
  console.log("Seeded real-footage example project.");
} else console.log("Existing projects preserved.");
await pool.end();
