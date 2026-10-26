"use client";
import { currentArtifact } from "../lib/production-version";
import { AssetReviewEditor } from "./asset-review";
import { sceneQuality } from "../lib/scene-quality";
import { roleNames } from "../lib/scene-model";
import { storyWarnings } from "../lib/story-quality";
import { useEffect, useRef, useState } from "react";
import {
  Plus,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Film,
  FolderOpen,
  LayoutGrid,
  Upload,
  Image as ImageIcon,
  Video,
  Play,
  Download,
  Save,
  LoaderCircle,
  RefreshCw,
  Trash2,
  Copy,
  Volume2,
  Settings2,
  BookOpen,
  Clapperboard,
  Clock3,
  CheckCircle2,
  AlertCircle,
  X,
  Sparkles,
  MoreHorizontal,
} from "lucide-react";
import { titleFontSize, sceneTitleFontSize } from "@/renderer/src/web-layout";
import type {
  Project,
  Asset,
  Shot,
  Job,
  Artifact,
  Concept,
} from "@/lib/models";
type Detail = {
  project: Project;
  assets: Asset[];
  jobs: Job[];
  artifacts: Artifact[];
  approved: boolean;
  usage: {
    provider: string;
    operation: string;
    cost: string | null;
    units: Record<string, number>;
  }[];
};
type Capabilities = {
  mode: string;
  text: boolean;
  voice: string;
  message: string;
};
const steps = ["商品资料", "剧情方案", "分镜工作台", "预览与导出"];
const statusNames: Record<string, string> = {
  draft: "草稿",
  review: "待确认",
  completed: "已完成",
};
async function api<T = any>(
  url: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await fetch("/api/" + url, {
    method,
    headers:
      data instanceof FormData
        ? {}
        : data
          ? { "Content-Type": "application/json" }
          : {},
    body:
      data instanceof FormData ? data : data ? JSON.stringify(data) : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || "请求失败");
  return value;
}
function Media({
  asset,
  fit = "cover",
  className = "",
  trim = 0,
  focusX = 50,
  focusY = 50,
  zoom = 1,
  seconds,
}: {
  asset?: Asset;
  fit?: "cover" | "contain";
  className?: string;
  trim?: number;
  focusX?: number;
  focusY?: number;
  zoom?: number;
  seconds?: number;
}) {
  return !asset ? (
    <div className={"missing-media " + className}>
      <ImageIcon size={36} />
      <span>选择真实商品素材</span>
    </div>
  ) : asset.kind === "video" ? (
    <video
      key={asset.id + trim}
      className={className}
      src={asset.url + `#t=${trim}`}
      style={{
        objectFit: fit,
        objectPosition: `${focusX}% ${focusY}%`,
        transform: `scale(${zoom})`,
        transformOrigin: `${focusX}% ${focusY}%`,
      }}
      muted
      playsInline
      loop
      autoPlay
      onTimeUpdate={(e) => {
        if (seconds && e.currentTarget.currentTime >= trim + seconds)
          e.currentTarget.currentTime = trim;
      }}
      onLoadedMetadata={(e) => {
        e.currentTarget.currentTime = trim;
      }}
    />
  ) : (
    <img
      className={className}
      src={asset.url}
      alt={asset.name}
      style={{
        objectFit: fit,
        objectPosition: `${focusX}% ${focusY}%`,
        transform: `scale(${zoom})`,
        transformOrigin: `${focusX}% ${focusY}%`,
      }}
    />
  );
}
export default function Studio() {
  const [reviewingAsset, setReviewingAsset] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Project | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [guide, setGuide] = useState(false);
  const [settings, setSettings] = useState(false);
  const [approvedBox, setApprovedBox] = useState(false);
  const [hooks, setHooks] = useState<Record<string, string>>({});

  const fileRef = useRef<HTMLInputElement>(null);
  const projectId = detail?.project.id;
  const p = draft;
  const assets = detail?.assets ?? [];
  const quality = p ? sceneQuality(p, assets) : null;
  const currentShot = p?.shots[selected];
  const shotAsset = assets.find((a) => a.id === currentShot?.assetId);
  const activeJob =
    detail?.jobs.find((j) => j.status === "running") ??
    detail?.jobs.find((j) => j.status === "queued");
  const sample =
    detail?.artifacts.find((a) => a.kind === "sample" && currentArtifact(a)) ??
    detail?.artifacts.find((a) => a.kind === "sample");
  const final =
    detail?.artifacts.find((a) => a.kind === "render" && currentArtifact(a)) ??
    detail?.artifacts.find((a) => a.kind === "render");
  const shown =
    final?.revision === p?.revision && currentArtifact(final) ? final : sample;
  const stale =
    !!shown &&
    (shown.revision !== p?.revision || !currentArtifact(shown) || dirty);
  const currentVoice = detail?.artifacts.find(
    (a) =>
      a.kind === "voice" &&
      a.revision === p?.revision &&
      detail.jobs.some((j) => j.id === a.jobId && j.shotId === currentShot?.id),
  );
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [projectId, step]);
  async function refreshList() {
    const data = await api<{ projects: Project[] }>("projects");
    setProjects(data.projects);
  }
  async function load(id: string, keepDraft = false) {
    const data = await api<Detail>("projects/" + id);
    setDetail(data);
    if (!keepDraft) {
      setDraft(data.project);
      setDirty(false);
    }
    return data;
  }
  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    Promise.all([
      refreshList(),
      api<Capabilities>("capabilities").then(setCaps),
    ]).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!projectId || !activeJob) return;
    const timer = setInterval(() => {
      api<Detail>("projects/" + projectId)
        .then((data) =>
          setDetail((old) => (old?.project.id === projectId ? data : old)),
        )
        .catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [projectId, activeJob?.id]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    setApprovedBox(false);
  }, [p?.revision, dirty]);
  function editProduct(key: string, value: any) {
    if (!p) return;
    setDraft({ ...p, product: { ...p.product, [key]: value } });
    setDirty(true);
  }
  function editShot(key: string, value: any) {
    if (!p) return;
    setDraft({
      ...p,
      shots: p.shots.map((s, i) =>
        i === selected ? { ...s, [key]: value } : s,
      ),
    });
    setDirty(true);
  }
  async function save() {
    if (!p) throw Error("未选择项目");
    if (!dirty) return p;
    const result = await api<{ project: Project }>(
      "projects/" + p.id,
      "PATCH",
      {
        expectedRevision: p.revision,
        productionMode: p.productionMode ?? "presentation",
        sceneGroup: p.sceneGroup ?? "",
        product: p.product,
        shots: p.shots,
        ttsEnabled: p.ttsEnabled,
        musicEnabled: p.musicEnabled !== false,
      },
    );
    setDraft(result.project);
    setDirty(false);
    await load(p.id);
    await refreshList();
    return result.project;
  }
  async function open(id: string) {
    await load(id);
    const found = projects.find((x) => x.id === id);
    setStep(found?.shots.length ? 2 : 0);
    setSelected(0);
    setHooks({});
  }
  async function create() {
    if (dirty && !confirm("离开后未保存的修改会丢失，继续吗？")) return;
    const result = await api<{ project: Project }>("projects", "POST", {});
    await load(result.project.id);
    await refreshList();
    setStep(0);
    setSelected(0);
  }
  async function back() {
    if (dirty && !confirm("返回会丢弃未保存修改，继续吗？")) return;
    setDetail(null);
    setDraft(null);
    setDirty(false);
    await refreshList();
  }
  async function generate() {
    const saved = await save();
    await api("projects/" + saved.id + "/concepts", "POST", {});
    await load(saved.id);
    setStep(1);
    setNotice(
      caps?.text
        ? "剧情方案已生成，请核对商品事实"
        : "已生成三种规则方案，可自行修改",
    );
  }
  async function selectConcept(c: Concept) {
    if (!p) return;
    await api("projects/" + p.id + "/select", "POST", {
      conceptId: c.id,
      expectedRevision: p.revision,
      hook: hooks[c.id] ?? c.hook,
    });
    await load(p.id);
    setStep(2);
    setSelected(0);
  }
  async function queue(kind: "sample" | "render" | "voice") {
    const saved = await save();
    const result = await api<{ job: Job }>(
      "projects/" + saved.id + "/jobs",
      "POST",
      {
        kind,
        expectedRevision: saved.revision,
        shotId: kind === "voice" ? currentShot?.id : undefined,
      },
    );
    await load(saved.id);
    if (kind !== "voice") setStep(3);
    if (result.job.status === "succeeded") {
      setNotice("已复用当前版本的结果，没有新增渲染或配音调用");
      return;
    }
    if (result.job.status === "failed")
      throw Error("此版本上次任务失败，请到任务记录查看原因并重试");
    setNotice(
      kind === "voice"
        ? "配音已加入队列，完成后可在右侧试听"
        : "渲染任务已加入队列",
    );
  }
  async function upload(files: FileList | null) {
    if (!p || !files) return;
    await act("上传素材", async () => {
      for (const file of Array.from(files)) {
        const data = new FormData();
        data.append("file", file);
        const r = await api<{ assets: Asset[] }>(
          "projects/" + p.id + "/assets",
          "POST",
          data,
        );
        setDetail((d) => (d ? { ...d, assets: r.assets } : d));
      }
      setNotice("素材已上传，原始文件已保留");
    });
  }
  const total = p?.shots.reduce((n, s) => n + s.seconds, 0) ?? 0;
  const disabled = !!busy;
  return (
    <div className="shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => void act("返回项目", back)}>
          <span className="brand-mark">
            <Clapperboard size={24} />
          </span>
          <span>
            拾序<span className="brand-en">AD STUDIO</span>
          </span>
        </button>
        <div className="sidebar-label">创作空间</div>
        <button
          className="nav-item active"
          onClick={() => void act("返回项目", back)}
        >
          <LayoutGrid size={18} />
          <span>项目工作台</span>
          <span className="nav-count">{projects.length}</span>
        </button>
        <button className="nav-item" onClick={() => setGuide(true)}>
          <BookOpen size={18} />
          <span>创作指南</span>
          <ArrowUpRight size={14} />
        </button>
        <div className="sidebar-note">
          <span className="mini-label">A LITTLE MORE REAL.</span>
          <p>
            让真实的商品，
            <br />
            讲好自己的故事。
          </p>
          <div className="note-line" />
          <span>素材 · 剧情 · 成片</span>
        </div>
        <button
          className="nav-item settings-nav"
          onClick={() => setSettings(true)}
        >
          <Settings2 size={18} />
          <span>服务与设置</span>
        </button>
        <div className="local-status">
          <span />
          <div>
            本机工作室<small>独立数据库 · 真实渲染</small>
          </div>
          <span className="avatar">本</span>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span className="breadcrumb">
            创作空间 <ChevronRight size={14} />{" "}
            {p ? p.product.name || "新建广告" : "项目工作台"}
          </span>
          <div className="top-meta">
            <span className="mode-pill">
              <span />
              {caps?.text ? "AI 服务已连接" : "规则方案模式"}
            </span>
            <span className="top-date">PRODUCT AD STUDIO</span>
          </div>
        </header>
        {(error || notice) && (
          <div
            role={error ? "alert" : "status"}
            className={"toast " + (error ? "error" : "")}
          >
            <span>
              {error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            </span>
            {error || notice}
            <button
              aria-label="关闭提示"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {!p ? (
          <section className="dashboard">
            <div className="page-heading">
              <div>
                <div className="eyebrow">YOUR CREATIVE WORKSPACE</div>
                <h1>
                  让商品，自己讲故事<span>。</span>
                </h1>
                <p>用真实素材，把日常卖点变成一条可编辑的广告。</p>
              </div>
              <button
                className="button primary"
                disabled={disabled}
                onClick={() => void act("新建项目", create)}
              >
                <Plus size={17} />
                新建商品广告
              </button>
            </div>
            <div className="hero-panel">
              <div className="hero-copy">
                <span className="small-badge">
                  <span />
                  从真实素材开始
                </span>
                <h2>
                  好广告，
                  <br />
                  先让商品被看见。
                </h2>
                <p>
                  上传真实素材，规划一个场景。
                  <br />
                  在五个镜头里，把故事讲清楚。
                </p>
                <button
                  className="hero-link"
                  onClick={() => void act("新建项目", create)}
                >
                  开始第一条广告 <ArrowRight size={18} />
                </button>
                <div className="hero-tags">
                  <span>真实素材保留</span>
                  <i />
                  <span>五镜头可编辑</span>
                  <i />
                  <span>1080P 导出</span>
                </div>
              </div>
              <div className="hero-photo">
                <img src="/demo/cover.png" alt="真实厨房中的玻璃收纳罐" />
                <div className="photo-overlay" />
                <span className="photo-label">REAL FOOTAGE / KITCHEN</span>
                <span className="photo-caption">日常里的秩序感。</span>
                <button
                  className="hero-play"
                  aria-label="打开实拍示例"
                  onClick={() =>
                    void act("打开实拍示例", async () => {
                      const demo = projects.find(
                        (x) => x.product.name === "玻璃收纳罐",
                      );
                      if (demo) {
                        await load(demo.id);
                        setStep(3);
                      }
                    })
                  }
                >
                  <Play size={20} fill="currentColor" />
                </button>
              </div>
            </div>
            <div className="section-heading">
              <h2>
                我的项目 <span>{projects.length}</span>
              </h2>
              <span>每一次修改，都值得保留</span>
            </div>
            <div className="project-grid">
              {projects.map((project, i) => (
                <article className="project-card" key={project.id}>
                  <button
                    className="project-cover"
                    onClick={() => void act("打开项目", () => open(project.id))}
                  >
                    {project.coverUrl ? (
                      <img src={project.coverUrl} alt="商品项目封面" />
                    ) : (
                      <div className="generic-cover">
                        <Film size={38} />
                        <span>{project.product.name || "新的故事"}</span>
                      </div>
                    )}
                    <span className={"status-badge " + project.status}>
                      {statusNames[project.status] || "草稿"}
                    </span>
                    <span className="aspect-tag">9:16</span>
                    <span className="card-hover">
                      继续创作 <ArrowRight size={16} />
                    </span>
                  </button>
                  <div className="project-card-body">
                    <button
                      className="project-title"
                      onClick={() =>
                        void act("打开项目", () => open(project.id))
                      }
                    >
                      {project.product.name || "未命名商品广告"}
                    </button>
                    <p>
                      {project.product.benefits[0] ||
                        "添加商品资料，开始你的创作"}
                    </p>
                    <div className="project-meta">
                      <span>
                        <Clock3 size={12} />
                        {new Date(project.updatedAt).toLocaleDateString(
                          "zh-CN",
                        )}{" "}
                        · v{project.revision}
                      </span>
                      <div>
                        <button
                          title="复制项目"
                          onClick={() =>
                            void act("复制项目", async () => {
                              await api(
                                "projects/" + project.id + "/duplicate",
                                "POST",
                                {},
                              );
                              await refreshList();
                            })
                          }
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          title="删除项目"
                          onClick={() => {
                            if (
                              confirm(
                                "删除此项目？原始素材将保留在本机存储，后台任务将停止排队。",
                              )
                            )
                              void act("删除项目", async () => {
                                await api("projects/" + project.id, "DELETE");
                                await refreshList();
                              });
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
              <button
                className="new-project-card"
                disabled={disabled}
                onClick={() => void act("新建项目", create)}
              >
                <span>
                  <Plus size={26} />
                </span>
                <strong>一个新的故事</strong>
                <p>把你的下一个商品，带到这里。</p>
              </button>
            </div>
            <div className="bottom-note">
              <CheckCircle2 size={15} />
              渲染在本机执行。你的商品原始素材会保留，生成内容可随时修改。
            </div>
          </section>
        ) : (
          <section className="workspace">
            <div className="workspace-heading">
              <div className="workspace-title">
                <button
                  className="icon-button"
                  title="返回项目"
                  onClick={() => void act("返回项目", back)}
                >
                  <ArrowLeft size={19} />
                </button>
                <div>
                  <h1>
                    {p.product.name || "新建商品广告"}{" "}
                    <span className="version">v{p.revision}</span>
                  </h1>
                  <p>
                    {dirty ? (
                      <span className="unsaved">
                        有未保存的修改 · 旧成片将失效
                      </span>
                    ) : (
                      "修改已保存到本机数据库"
                    )}
                  </p>
                </div>
              </div>
              <button
                className="button secondary"
                disabled={disabled || !dirty}
                onClick={() =>
                  void act("保存修改", async () => {
                    await save();
                    setNotice("修改已保存");
                  })
                }
              >
                {busy === "保存修改" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Save size={16} />
                )}
                保存修改
              </button>
            </div>
            <nav className="steps" aria-label="制作步骤">
              {steps.map((name, i) => (
                <button
                  key={name}
                  className={step === i ? "selected" : step > i ? "passed" : ""}
                  disabled={i > 1 && !p.shots.length}
                  onClick={() => setStep(i)}
                >
                  <span>
                    {step > i ? (
                      <Check size={13} />
                    ) : (
                      String(i + 1).padStart(2, "0")
                    )}
                  </span>
                  {name}
                  {i < 3 && <ChevronRight size={15} />}
                </button>
              ))}
            </nav>
            {step === 0 && (
              <div className="product-form-layout">
                <div className="panel form-panel">
                  <div className="panel-title">
                    <div>
                      <h2>先认识你的商品</h2>
                      <p>只填写已确认的信息，故事从真实开始。</p>
                    </div>
                    <span className="panel-number">01</span>
                  </div>
                  <div className="form-fields">
                    <label>
                      商品名称 <b>*</b>
                      <input
                        placeholder="例如：玻璃收纳罐"
                        value={p.product.name}
                        onChange={(e) => editProduct("name", e.target.value)}
                      />
                    </label>
                    <label>
                      已确认卖点 <b>*</b>
                      <textarea
                        rows={4}
                        placeholder={
                          "每行一个卖点，例如：\n透明罐身，内容一眼看清\n可按使用习惯分开放置"
                        }
                        value={p.product.benefits.join("\n")}
                        onChange={(e) =>
                          editProduct("benefits", e.target.value.split("\n"))
                        }
                      />
                      <small>不填写未经验证的功效、规格或承诺。</small>
                    </label>
                    <div className="two-fields">
                      <label>
                        目标人群 <b>*</b>
                        <input
                          placeholder="例如：喜欢整理厨房的家庭用户"
                          value={p.product.audience}
                          onChange={(e) =>
                            editProduct("audience", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        使用场景
                        <input
                          placeholder="例如：厨房台面收纳"
                          value={p.product.scene}
                          onChange={(e) => editProduct("scene", e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="two-fields">
                      <label>
                        品牌 / 工作室
                        <input
                          placeholder="可选"
                          value={p.product.brand}
                          onChange={(e) => editProduct("brand", e.target.value)}
                        />
                      </label>
                      <label>
                        价格
                        <input
                          placeholder="可选，以实际信息为准"
                          value={p.product.price}
                          onChange={(e) => editProduct("price", e.target.value)}
                        />
                      </label>
                    </div>
                    <label>
                      优惠说明（可选）
                      <input
                        placeholder="仅填写真实有效的优惠信息"
                        value={p.product.offer}
                        onChange={(e) => editProduct("offer", e.target.value)}
                      />
                    </label>
                    <label>
                      购买引导
                      <input
                        value={p.product.cta}
                        onChange={(e) => editProduct("cta", e.target.value)}
                      />
                    </label>
                    <label>
                      禁止出现的表述
                      <input
                        placeholder="例如：不宣传未经验证的密封或耐热能力"
                        value={p.product.forbidden}
                        onChange={(e) =>
                          editProduct("forbidden", e.target.value)
                        }
                      />
                    </label>
                  </div>
                </div>
                <div className="asset-column">
                  <div className="panel asset-panel">
                    <div className="panel-title">
                      <div>
                        <h2>
                          真实商品素材 <b>*</b>
                        </h2>
                        <p>
                          建议准备环境、操作细节和使用结果三类视频；仅上传商品照片时输出图文展示。
                        </p>
                      </div>
                      <span className="asset-count">{assets.length}/10</span>
                    </div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,video/mp4"
                      multiple
                      hidden
                      onChange={(e) => {
                        void upload(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <button
                      className="upload-area"
                      disabled={disabled || assets.length >= 10}
                      onClick={() => fileRef.current?.click()}
                    >
                      <Upload size={25} />
                      <strong>
                        {busy === "上传素材"
                          ? "正在上传素材…"
                          : "点击上传商品图或实拍视频"}
                      </strong>
                      <span>JPG / PNG / WebP ≤15MB · MP4 ≤100MB</span>
                    </button>
                    <label>
                      制作方式
                      <select
                        value={p.productionMode ?? "presentation"}
                        onChange={(e) => {
                          setDraft({
                            ...p,
                            productionMode: e.target.value as
                              | "scene"
                              | "presentation",
                          });
                          setDirty(true);
                        }}
                      >
                        <option value="scene">
                          真实场景 · 按已核对片段剪辑
                        </option>
                        <option value="presentation">
                          商品图展示 · 明确使用图文版式
                        </option>
                      </select>
                    </label>
                    {p.productionMode === "scene" && (
                      <label>
                        使用拍摄组（只有一组时可留空）
                        <input
                          maxLength={80}
                          value={p.sceneGroup ?? ""}
                          onChange={(e) => {
                            setDraft({ ...p, sceneGroup: e.target.value });
                            setDirty(true);
                          }}
                          placeholder="与片段标注中的拍摄组一致"
                        />
                      </label>
                    )}
                    <div className="asset-grid">
                      {assets.map((a) => (
                        <div className="asset-tile" key={a.id}>
                          <Media asset={a} />
                          <span>
                            {a.kind === "video" ? (
                              <Video size={12} />
                            ) : (
                              <ImageIcon size={12} />
                            )}{" "}
                            {a.kind === "video"
                              ? `${a.duration?.toFixed(1)}s`
                              : "原图"}
                          </span>
                          {a.kind === "video" && (
                            <button
                              type="button"
                              className="asset-review-button"
                              onClick={() => setReviewingAsset(a.id)}
                            >
                              {a.sceneReview
                                ? `已标注 ${a.sceneReview.segments.length} 段 · 编辑`
                                : "标注动作与保护区域"}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    {reviewingAsset &&
                      assets.find((a) => a.id === reviewingAsset) && (
                        <AssetReviewEditor
                          key={reviewingAsset}
                          asset={assets.find((a) => a.id === reviewingAsset)!}
                          group={p.sceneGroup || p.product.name}
                          onClose={() => setReviewingAsset(null)}
                          onSave={async (review) => {
                            const saved = await save();
                            await api(
                              `projects/${saved.id}/asset-review`,
                              "POST",
                              {
                                ...review,
                                assetId: reviewingAsset,
                                expectedRevision: saved.revision,
                              },
                            );
                            await load(saved.id);
                            setReviewingAsset(null);
                            setNotice(
                              "片段标注已保存，旧方案和样片已失效；重新生成可复用相同选片与构图",
                            );
                          }}
                        />
                      )}
                    <p className="field-note">
                      真实场景需标注环境、准备、动作、细节、结果五类片段；同一视频可以标注多个不重叠片段。商品图展示须明确选择，不会自动降级。
                    </p>
                  </div>
                  <div className="soft-callout">
                    <Sparkles size={19} />
                    <div>
                      <strong>
                        {caps?.text
                          ? "剧情服务已连接"
                          : "先用规则方案，搭起故事"}
                      </strong>
                      <p>
                        {caps?.text
                          ? "生成结果仍需要核对商品事实。"
                          : "当前未配置文本模型，三个开头由规则生成，可完整编辑。"}
                      </p>
                    </div>
                  </div>
                  <button
                    className="button primary wide"
                    disabled={disabled || !assets.length}
                    onClick={() => void act("生成方案", generate)}
                  >
                    {busy === "生成方案" ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <ArrowRight size={17} />
                    )}
                    生成三个剪辑草稿
                  </button>
                </div>
              </div>
            )}
            {step === 1 && (
              <div className="concept-stage">
                <div className="stage-heading">
                  <div className="eyebrow">ONE PRODUCT. THREE OPENINGS.</div>
                  <h2>选一个开头，让故事开始。</h2>
                  <p>
                    按环境、操作、细节与结果组织镜头。草稿需要匹配真实素材，不会自动补出未拍摄的动作。
                  </p>
                </div>
                <div className="concept-grid">
                  {p.concepts.map((c, i) => (
                    <div className="concept-card" key={c.id}>
                      <div className="concept-top">
                        <span className="concept-num">0{i + 1}</span>
                        <span className="source-tag">
                          {c.source === "rule" ? "规则方案" : "模型方案"}
                        </span>
                      </div>
                      <h3>{c.title}</h3>
                      <textarea
                        aria-label={c.title + "开头"}
                        value={hooks[c.id] ?? c.hook}
                        onChange={(e) =>
                          setHooks({ ...hooks, [c.id]: e.target.value })
                        }
                        maxLength={48}
                      />
                      <p>{c.summary}</p>
                      <div className="concept-detail">
                        <span>
                          <Clock3 size={14} />
                          {c.estimatedSeconds} 秒
                        </span>
                        <span>
                          <ImageIcon size={14} />
                          使用已上传素材
                        </span>
                      </div>
                      <button
                        className="button secondary wide"
                        disabled={disabled}
                        onClick={() =>
                          void act("选择方案", () => selectConcept(c))
                        }
                      >
                        使用这个开头 <ArrowRight size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="concept-footer">
                  <span>
                    {caps?.text
                      ? "重新生成会新增一次模型调用。"
                      : "规则方案不调用模型，不产生模型费用。"}
                  </span>
                  <button
                    className="text-button"
                    disabled={disabled}
                    onClick={() => void act("生成方案", generate)}
                  >
                    <RefreshCw size={14} />
                    重新生成
                  </button>
                </div>
                {!p.concepts.length && (
                  <button
                    className="button primary"
                    onClick={() => void act("生成方案", generate)}
                  >
                    生成剧情方案
                  </button>
                )}
              </div>
            )}
            {step === 2 && currentShot && (
              <>
                <div className="editor-layout">
                  <div className="panel shot-list">
                    <div className="list-heading">
                      <h2>镜头列表</h2>
                      <span>{total}s · 9:16</span>
                    </div>
                    {p.shots.map((shot, i) => (
                      <button
                        key={shot.id}
                        className={
                          "shot-item " + (selected === i ? "selected" : "")
                        }
                        onClick={() => setSelected(i)}
                      >
                        <div className="shot-thumb">
                          <Media
                            asset={assets.find((a) => a.id === shot.assetId)}
                          />
                          <span>0{i + 1}</span>
                        </div>
                        <div>
                          <strong>
                            {shot.role
                              ? roleNames[shot.role]
                              : [
                                  "开场",
                                  "商品登场",
                                  "细节展示",
                                  "日常场景",
                                  "收尾",
                                ][i]}
                          </strong>
                          <p>{shot.headline}</p>
                          <small>{shot.seconds}s</small>
                        </div>
                      </button>
                    ))}
                    {sceneQuality(p, assets).blockers.map((issue) => (
                      <p
                        className="story-warning"
                        role="alert"
                        key={issue.code + issue.shot}
                      >
                        {issue.message}
                      </p>
                    ))}
                    {storyWarnings(p.shots, assets).map((message) => (
                      <p className="story-warning" key={message}>
                        {message}
                      </p>
                    ))}
                    <div className="shot-note">
                      <ImageIcon size={15} />
                      <span>原始商品素材始终保留</span>
                    </div>
                  </div>
                  <div className="preview-column">
                    <div className="preview-heading">
                      <span>镜头 {String(selected + 1).padStart(2, "0")}</span>
                      <span>排版预览 · 非渲染成片</span>
                    </div>
                    <div
                      className={
                        "phone-preview " +
                        (currentShot.fit === "cover"
                          ? "scene-preview text-at-" +
                            (currentShot.textPlacement ?? "bottom") +
                            " text-" +
                            (currentShot.textMode ??
                              (selected === 0 || selected === 4
                                ? "title"
                                : "subtitle"))
                          : "")
                      }
                    >
                      <Media
                        asset={shotAsset}
                        fit={currentShot.fit}
                        trim={currentShot.trimBefore}
                        focusX={currentShot.focusX ?? 50}
                        focusY={currentShot.focusY ?? 50}
                        zoom={currentShot.zoom ?? 1}
                        seconds={currentShot.seconds}
                      />
                      <div
                        className={
                          "preview-gradient " +
                          (currentShot.fit === "contain" ? "contain" : "")
                        }
                      />
                      <div className="preview-brand">
                        {p.product.brand ||
                          (currentShot.fit === "contain"
                            ? "DAILY OBJECTS"
                            : "")}
                        <span>AI 辅助创作</span>
                      </div>
                      <div className="preview-headline">
                        <small>0{selected + 1} / 05</small>
                        <strong
                          style={{
                            fontSize: `${((currentShot.fit === "cover" ? sceneTitleFontSize(currentShot.headline) : titleFontSize(currentShot.headline, selected === 0 || selected === 4)) / 1080) * 100}cqw`,
                            wordBreak: "break-all",
                          }}
                        >
                          {currentShot.headline}
                        </strong>
                      </div>
                      <div className="preview-caption">
                        {currentShot.caption ||
                          (currentShot.fit === "cover" &&
                          (currentShot.textMode ??
                            (selected === 0 || selected === 4
                              ? "title"
                              : "subtitle")) === "subtitle"
                            ? currentShot.headline
                            : "")}
                      </div>
                      <div className="preview-disclaimer">
                        商品信息以实际说明为准
                      </div>
                    </div>
                    <div className="timeline">
                      {p.shots.map((s, i) => (
                        <button
                          style={{ flex: s.seconds }}
                          key={s.id}
                          className={selected === i ? "selected" : ""}
                          onClick={() => setSelected(i)}
                        >
                          <span>0{i + 1}</span>
                          <small>{s.seconds}s</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="panel inspector">
                    <div className="panel-title">
                      <div>
                        <h2>镜头设置</h2>
                        <p>小改动，也能更贴合你的商品。</p>
                      </div>
                      <Settings2 size={17} />
                    </div>
                    <label>
                      画面主文案
                      <textarea
                        rows={3}
                        maxLength={48}
                        value={currentShot.headline}
                        onChange={(e) => editShot("headline", e.target.value)}
                      />
                      <small>{currentShot.headline.length}/48</small>
                    </label>
                    <label>
                      旁白 / 字幕
                      <textarea
                        rows={3}
                        maxLength={80}
                        value={currentShot.caption}
                        onChange={(e) => editShot("caption", e.target.value)}
                      />
                    </label>
                    <div className="two-fields">
                      <label>
                        时长（秒）
                        <input
                          type="number"
                          min="1"
                          max="10"
                          step="0.5"
                          value={currentShot.seconds}
                          onChange={(e) =>
                            editShot("seconds", Number(e.target.value))
                          }
                        />
                      </label>
                      <label>
                        素材起点（秒）
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          disabled={shotAsset?.kind !== "video"}
                          value={currentShot.trimBefore}
                          onChange={(e) =>
                            editShot("trimBefore", Number(e.target.value))
                          }
                        />
                      </label>
                    </div>
                    <label>
                      商品素材
                      <select
                        value={currentShot.assetId ?? ""}
                        onChange={(e) => {
                          const asset = assets.find(
                            (a) => a.id === e.target.value,
                          );
                          setDraft({
                            ...p,
                            shots: p.shots.map((s, i) =>
                              i === selected
                                ? {
                                    ...s,
                                    assetId: e.target.value,
                                    trimBefore: 0,
                                    fit:
                                      asset?.kind === "image"
                                        ? "contain"
                                        : "cover",
                                  }
                                : s,
                            ),
                          });
                          setDirty(true);
                        }}
                      >
                        <option value="">选择素材</option>
                        {assets.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.kind === "video" ? "视频" : "图片"} · {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      画面布局
                      <select
                        value={currentShot.fit}
                        onChange={(e) => editShot("fit", e.target.value)}
                      >
                        <option value="cover">铺满画面</option>
                        <option value="contain">完整展示商品</option>
                      </select>
                    </label>
                    <label>
                      场景文字
                      <select
                        disabled={currentShot.fit !== "cover"}
                        value={
                          currentShot.textMode ??
                          (selected === 0 || selected === 4
                            ? "title"
                            : "subtitle")
                        }
                        onChange={(e) => editShot("textMode", e.target.value)}
                      >
                        <option value="title">标题与字幕</option>
                        <option value="subtitle">仅字幕，让动作说话</option>
                        <option value="none">纯画面</option>
                      </select>
                    </label>
                    <label>
                      场景文字位置
                      <select
                        value={currentShot.textPlacement ?? "bottom"}
                        disabled={currentShot.fit !== "cover"}
                        onChange={(e) =>
                          editShot("textPlacement", e.target.value)
                        }
                      >
                        <option value="bottom">下方安全区</option>
                        <option value="top">上方安全区</option>
                      </select>
                    </label>
                    <label>
                      画面放大（{(currentShot.zoom ?? 1).toFixed(2)}×）
                      <input
                        type="range"
                        min="1"
                        max="1.6"
                        step="0.01"
                        value={currentShot.zoom ?? 1}
                        disabled={currentShot.fit !== "cover"}
                        onChange={(e) =>
                          editShot("zoom", Number(e.target.value))
                        }
                      />
                    </label>
                    <label>
                      原片声音（
                      {Math.round((currentShot.sourceVolume ?? 0) * 100)}%）
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={currentShot.sourceVolume ?? 0}
                        disabled={shotAsset?.kind !== "video"}
                        onChange={(e) =>
                          editShot("sourceVolume", Number(e.target.value))
                        }
                      />
                      <small>
                        素材需自带音轨；配音期间自动降低原声。排版预览静音，成片保留设置。
                      </small>
                    </label>
                    <label>
                      横向画面焦点（{currentShot.focusX ?? 50}%）
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={currentShot.focusX ?? 50}
                        disabled={currentShot.fit !== "cover"}
                        onChange={(e) =>
                          editShot("focusX", Number(e.target.value))
                        }
                      />
                    </label>
                    <label>
                      纵向画面焦点（{currentShot.focusY ?? 50}%）
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={currentShot.focusY ?? 50}
                        disabled={currentShot.fit !== "cover"}
                        onChange={(e) =>
                          editShot("focusY", Number(e.target.value))
                        }
                      />
                    </label>
                    <label>
                      画面说明
                      <textarea
                        rows={2}
                        value={currentShot.description}
                        onChange={(e) =>
                          editShot("description", e.target.value)
                        }
                      />
                    </label>
                    <button
                      className="button secondary wide"
                      disabled={disabled || !!activeJob || !currentShot.caption}
                      onClick={() => void act("生成配音", () => queue("voice"))}
                    >
                      <Volume2 size={15} />
                      重做 / 试听本镜配音
                    </button>
                    {currentVoice && (
                      <audio
                        className="voice-preview"
                        src={currentVoice.url}
                        controls
                      />
                    )}
                    <div className="audio-options">
                      <label>
                        <input
                          type="checkbox"
                          checked={p.ttsEnabled}
                          disabled={caps?.voice === "none"}
                          onChange={(e) => {
                            setDraft({ ...p, ttsEnabled: e.target.checked });
                            setDirty(true);
                          }}
                        />
                        启用旁白{" "}
                        <small>
                          {caps?.voice === "system"
                            ? "本机示例声音"
                            : caps?.voice === "api"
                              ? "API 配音"
                              : "未配置"}
                        </small>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={p.musicEnabled !== false}
                          onChange={(e) => {
                            setDraft({ ...p, musicEnabled: e.target.checked });
                            setDirty(true);
                          }}
                        />
                        轻背景音乐
                      </label>
                    </div>
                  </div>
                </div>
                <div className="editor-footer">
                  <span>
                    <Clock3 size={15} />共 {total} 秒 <i />5 个镜头 <i />
                    修改后旧样片将过期
                  </span>
                  <button
                    className="button primary"
                    disabled={
                      disabled || !!activeJob || quality?.ready === false
                    }
                    onClick={() => void act("生成样片", () => queue("sample"))}
                  >
                    {busy === "生成样片" ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Play size={16} />
                    )}
                    生成低清样片
                  </button>
                </div>
              </>
            )}
            {step === 3 && (
              <div className="export-layout">
                <div className="panel playback-panel">
                  <div className="panel-title">
                    <div>
                      <h2>
                        {shown?.kind === "render" ? "正式成片" : "观看样片"}
                      </h2>
                      <p>
                        {shown
                          ? `${shown.width} × ${shown.height} · ${shown.duration.toFixed(1)}s · v${shown.revision}`
                          : "生成样片后，在这里确认画面与声音。"}
                      </p>
                    </div>
                    {stale ? (
                      <span className="stale-badge">已过期</span>
                    ) : shown ? (
                      <span className="current-badge">当前版本</span>
                    ) : null}
                  </div>
                  <div className="playback-area">
                    {shown ? (
                      <video
                        key={shown.id}
                        src={shown.url}
                        controls
                        playsInline
                        poster={undefined}
                      />
                    ) : (
                      <div className="empty-preview">
                        <Film size={44} />
                        <h3>你的故事，即将成片。</h3>
                        <p>先生成低清样片，确认后再导出 1080P。</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="export-sidebar">
                  {activeJob && (
                    <div className="panel job-panel">
                      <div className="job-heading">
                        <LoaderCircle size={18} className="spin" />
                        <strong>{activeJob.stage}</strong>
                        <span>{activeJob.progress}%</span>
                      </div>
                      <div className="progress-track">
                        <span
                          style={{
                            width: `${Math.max(3, activeJob.progress)}%`,
                          }}
                        />
                      </div>
                      <p>任务在独立进程执行，离开页面仍会继续。</p>
                    </div>
                  )}
                  <div className="panel export-options">
                    <div className="panel-title">
                      <div>
                        <h2>交付之前，再看一遍。</h2>
                        <p>自动检测不能替代你的确认。</p>
                      </div>
                    </div>
                    <div className="delivery-spec">
                      <span>
                        画幅<strong>9:16 竖屏</strong>
                      </span>
                      <span>
                        正式分辨率<strong>1080 × 1920</strong>
                      </span>
                      <span>
                        格式<strong>H.264 / MP4</strong>
                      </span>
                      <span>
                        当前修订
                        <strong>
                          v{p.revision}
                          {dirty ? " · 未保存" : ""}
                        </strong>
                      </span>
                    </div>
                    {quality?.blockers.map((issue) => (
                      <p
                        className="story-warning"
                        key={issue.code + issue.shot}
                      >
                        {issue.message}
                      </p>
                    ))}
                    {stale && (
                      <div className="inline-warning">
                        <AlertCircle size={16} />
                        内容已修改，旧视频不能用于当前版本确认。
                      </div>
                    )}
                    <button
                      className="button secondary wide"
                      disabled={
                        disabled || !!activeJob || quality?.ready === false
                      }
                      onClick={() =>
                        void act("生成样片", () => queue("sample"))
                      }
                    >
                      <RefreshCw size={15} />
                      {sample ? "重新生成样片" : "生成低清样片"}
                    </button>
                    <label className="approval-check">
                      <input
                        type="checkbox"
                        checked={approvedBox || detail?.approved}
                        disabled={
                          !sample ||
                          sample.revision !== p.revision ||
                          !currentArtifact(sample) ||
                          dirty ||
                          detail?.approved
                        }
                        onChange={(e) => setApprovedBox(e.target.checked)}
                      />
                      <span>
                        我已观看样片并核对商品外观、卖点、字幕、价格和声音。
                      </span>
                    </label>
                    <button
                      className="button primary wide"
                      disabled={
                        disabled ||
                        !!activeJob ||
                        dirty ||
                        quality?.ready === false ||
                        (!detail?.approved && !approvedBox) ||
                        !sample ||
                        !currentArtifact(sample) ||
                        sample?.revision !== p.revision
                      }
                      onClick={() =>
                        void act("导出成片", async () => {
                          await api("projects/" + p.id + "/approve", "POST", {
                            expectedRevision: p.revision,
                          });
                          await queue("render");
                        })
                      }
                    >
                      <Download size={16} />
                      确认并导出 1080P
                    </button>
                    {final && (
                      <a
                        className="button secondary wide download-link"
                        href={final.url + "?download=1"}
                      >
                        <Download size={16} />
                        下载
                        {final.revision === p.revision
                          ? "成片"
                          : `旧版成片 v${final.revision}`}
                      </a>
                    )}
                  </div>
                  <div className="panel history-panel">
                    <h3>任务记录</h3>
                    {!detail?.jobs.length && (
                      <p>还没有任务，先生成第一条样片。</p>
                    )}
                    {detail?.jobs.slice(0, 5).map((job) => (
                      <div className="history-item" key={job.id}>
                        <span className={"job-dot " + job.status} />
                        <div>
                          <strong>
                            {
                              {
                                sample: "低清样片",
                                render: "正式导出",
                                voice: "镜头配音",
                              }[job.kind]
                            }{" "}
                            <small>v{job.revision}</small>
                          </strong>
                          <p>{job.error || job.stage}</p>
                        </div>
                        {job.status === "failed" &&
                          job.retryable &&
                          job.attempts < 3 && (
                            <button
                              title="重试任务"
                              onClick={() =>
                                void act("重试任务", async () => {
                                  await api(
                                    "jobs/" + job.id + "/retry",
                                    "POST",
                                    {},
                                  );
                                  await load(p.id);
                                })
                              }
                            >
                              <RefreshCw size={14} />
                            </button>
                          )}
                      </div>
                    ))}
                  </div>
                  <div className="cost-note">
                    <span>调用记录</span>
                    <strong>{detail?.usage.length ?? 0} 次</strong>
                    <p>
                      {detail?.usage.some((u) => u.cost === null)
                        ? "部分供应商费用未配置单价，以供应商账单为准。"
                        : "本地规则与系统配音无外部 API 费用；渲染使用本机算力。"}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
      {busy && (
        <div className="busy-pill">
          <LoaderCircle size={15} className="spin" />
          {busy}…
        </div>
      )}
      {(guide || settings) && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setGuide(false);
            setSettings(false);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              onClick={() => {
                setGuide(false);
                setSettings(false);
              }}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">
              {guide ? "A SIMPLE CREATIVE PROCESS" : "YOUR LOCAL STUDIO"}
            </span>
            <h2>{guide ? "从商品到成片，只走四步。" : "服务与运行状态"}</h2>
            {guide ? (
              <>
                <ol>
                  <li>
                    <strong>上传真实素材</strong>
                    <p>至少一张商品图。若有使用实拍，可与图片一起上传。</p>
                  </li>
                  <li>
                    <strong>选择与修改开头</strong>
                    <p>未配置模型时，明确使用可编辑的规则方案。</p>
                  </li>
                  <li>
                    <strong>编辑五个镜头</strong>
                    <p>替换素材、调整文案、旁白和时长，总计 15–25 秒。</p>
                  </li>
                  <li>
                    <strong>看样片，再导出</strong>
                    <p>确认当前版本后生成 1080p；编辑后旧确认自动失效。</p>
                  </li>
                </ol>
                <p className="field-note">
                  需要更自然的商品动作时，请上传该商品真实使用视频。系统不会生成图片冒充实拍。
                </p>
              </>
            ) : (
              <>
                <div className="service-row">
                  <span>访问模式</span>
                  <strong>仅本机 · 单用户</strong>
                </div>
                <div className="service-row">
                  <span>文本服务</span>
                  <strong>
                    {caps?.text ? "已配置 API" : "规则方案（未配置模型）"}
                  </strong>
                </div>
                <div className="service-row">
                  <span>旁白服务</span>
                  <strong>
                    {caps?.voice === "system"
                      ? "macOS 本机示例声音"
                      : caps?.voice === "api"
                        ? "已配置 API"
                        : "未配置"}
                  </strong>
                </div>
                <div className="service-row">
                  <span>视频渲染</span>
                  <strong>VVV + Remotion · 独立任务进程</strong>
                </div>
                <p>
                  外部服务在项目的 .env.local
                  中配置。网页不会展示密钥。此版本未开放公网多用户访问。
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
