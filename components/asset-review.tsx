"use client";
import { useState } from "react";
import type { Asset } from "../lib/models";
import { sceneRoles, roleNames, type SceneSegment } from "../lib/scene-model";
import {
  visibleSource,
  contains,
  focusForBox,
} from "../renderer/src/scene-framing";
export function AssetReviewEditor({
  asset,
  group,
  onSave,
  onClose,
}: {
  asset: Asset;
  group: string;
  onSave: (review: {
    continuityKey: string;
    confirmed: true;
    segments: SceneSegment[];
  }) => Promise<void>;
  onClose: () => void;
}) {
  const make = (role: SceneSegment["role"]): SceneSegment => ({
    id: crypto.randomUUID(),
    role,
    start: 0,
    end: Math.min(4, asset.duration ?? 4),
    label: roleNames[role],
    focusX: 50,
    focusY: 50,
    zoom: 1,
    subject: { left: 45, top: 30, right: 55, bottom: 65 },
  });
  const [segments, setSegments] = useState<SceneSegment[]>(
    asset.sceneReview?.segments ?? [make("context")],
  );
  const [selected, setSelected] = useState(0),
    [key, setKey] = useState(asset.sceneReview?.continuityKey || group),
    [confirmed, setConfirmed] = useState(false),
    [marking, setMarking] = useState(false),
    [origin, setOrigin] = useState<{ x: number; y: number } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const current = segments[selected],
    visible = visibleSource(
      asset.width,
      asset.height,
      current.focusX,
      current.focusY,
      current.zoom,
    ),
    fits = contains(visible, current.subject);
  const edit = (patch: Partial<SceneSegment>) => {
    setSegments((list) =>
      list.map((s, i) => (i === selected ? { ...s, ...patch } : s)),
    );
    setConfirmed(false);
  };
  return (
    <section className="review-editor" aria-label="实拍片段标注">
      <div className="panel-title">
        <h3>标注可复用的实拍片段</h3>
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      <p>
        {asset.name} ·
        观看整段后标注动作起止。保护区域须覆盖整段内商品与关键动作的活动范围。
      </p>
      <label>
        同款商品 / 连续拍摄组
        <input
          maxLength={80}
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setConfirmed(false);
          }}
          placeholder="例如：黑柄法压壶 · 木屋早晨"
        />
      </label>
      <div className="segment-tabs">
        {segments.map((s, i) => (
          <button
            type="button"
            key={s.id}
            className={i === selected ? "selected" : ""}
            onClick={() => {
              setSelected(i);
              setMarking(false);
            }}
          >
            {i + 1} · {roleNames[s.role]}
          </button>
        ))}
        <button
          type="button"
          disabled={segments.length >= 15}
          onClick={() => {
            setSegments([
              ...segments,
              make(sceneRoles[Math.min(segments.length, 4)]),
            ]);
            setSelected(segments.length);
            setConfirmed(false);
          }}
        >
          ＋ 添加片段
        </button>
      </div>
      <div
        className="source-mark-frame"
        style={{ aspectRatio: `${asset.width}/${asset.height}` }}
        onPointerDown={(e) => {
          if (!marking) return;
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * 100,
            y = ((e.clientY - r.top) / r.height) * 100;
          setOrigin({ x, y });
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!marking || !origin) return;
          const r = e.currentTarget.getBoundingClientRect();
          const x = Math.max(
              0,
              Math.min(100, ((e.clientX - r.left) / r.width) * 100),
            ),
            y = Math.max(
              0,
              Math.min(100, ((e.clientY - r.top) / r.height) * 100),
            );
          const subject = {
            left: Math.min(origin.x, x),
            top: Math.min(origin.y, y),
            right: Math.max(origin.x, x),
            bottom: Math.max(origin.y, y),
          };
          edit({
            subject,
            ...focusForBox(asset.width, asset.height, subject, current.zoom),
          });
        }}
        onPointerUp={() => {
          setOrigin(null);
          setMarking(false);
        }}
        onPointerCancel={() => {
          setOrigin(null);
          setMarking(false);
        }}
      >
        <video
          key={asset.id}
          src={asset.url}
          controls={!marking}
          playsInline
          preload="metadata"
        />
        <div
          className="crop-guide"
          style={{
            left: `${visible.left}%`,
            top: `${visible.top}%`,
            width: `${visible.right - visible.left}%`,
            height: `${visible.bottom - visible.top}%`,
          }}
        />
        <div
          className="subject-guide"
          style={{
            left: `${current.subject.left}%`,
            top: `${current.subject.top}%`,
            width: `${current.subject.right - current.subject.left}%`,
            height: `${current.subject.bottom - current.subject.top}%`,
          }}
        />
      </div>
      <button
        type="button"
        className="button secondary"
        onClick={() => setMarking(!marking)}
      >
        {marking ? "请在原片上拖框" : "拖框标记商品 / 动作保护区域"}
      </button>
      <small>
        橙框为保护区域，绿框为竖屏可见范围。先暂停在关键时刻再拖框；播放器可观看完整原片。
      </small>
      <div className="two-fields">
        <label>
          镜头用途
          <select
            value={current.role}
            onChange={(e) =>
              edit({ role: e.target.value as SceneSegment["role"] })
            }
          >
            {sceneRoles.map((role) => (
              <option key={role} value={role}>
                {roleNames[role]}
              </option>
            ))}
          </select>
        </label>
        <label>
          确认画面里的动作
          <input
            maxLength={100}
            value={current.label}
            onChange={(e) => edit({ label: e.target.value })}
          />
        </label>
      </div>
      <div className="two-fields">
        <label>
          可用起点（秒）
          <input
            type="number"
            min={0}
            max={asset.duration ?? 0}
            step="0.1"
            value={current.start}
            onChange={(e) => edit({ start: Number(e.target.value) })}
          />
        </label>
        <label>
          可用终点（秒）
          <input
            type="number"
            min={0}
            max={asset.duration ?? 0}
            step="0.1"
            value={current.end}
            onChange={(e) => edit({ end: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="two-fields">
        {(["left", "top", "right", "bottom"] as const).map((k, i) => (
          <label key={k}>
            {["保护区域左边（%）", "上边（%）", "右边（%）", "下边（%）"][i]}
            <input
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={Math.round(current.subject[k] * 10) / 10}
              onChange={(e) => {
                const subject = {
                  ...current.subject,
                  [k]: Number(e.target.value),
                };
                edit({
                  subject,
                  ...focusForBox(
                    asset.width,
                    asset.height,
                    subject,
                    current.zoom,
                  ),
                });
              }}
            />
          </label>
        ))}
      </div>
      <div className="two-fields">
        <label>
          横向焦点
          <input
            type="range"
            min={0}
            max={100}
            step="0.1"
            value={current.focusX}
            onChange={(e) => edit({ focusX: Number(e.target.value) })}
          />
        </label>
        <label>
          纵向焦点
          <input
            type="range"
            min={0}
            max={100}
            step="0.1"
            value={current.focusY}
            onChange={(e) => edit({ focusY: Number(e.target.value) })}
          />
        </label>
      </div>
      {!fits && (
        <p role="alert">
          当前竖屏范围无法容纳保护区域。调整焦点，或换用更合适的竖屏素材；不要缩小保护框掩盖被裁掉的商品。
        </p>
      )}
      {segments.length > 1 && (
        <button
          type="button"
          onClick={() => {
            setSegments(segments.filter((_, i) => i !== selected));
            setSelected(0);
            setConfirmed(false);
          }}
        >
          移除此片段标注
        </button>
      )}
      <label className="review-confirm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        我已观看以上所有片段，确认同款商品、拍摄组、动作时间及整段保护区域正确
      </label>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        className="button primary"
        disabled={busy || !confirmed || !fits || !key.trim()}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await onSave({ continuityKey: key, confirmed: true, segments });
          } catch (e) {
            setError(e instanceof Error ? e.message : "保存失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "保存中…" : "保存片段标注"}
      </button>
    </section>
  );
}
