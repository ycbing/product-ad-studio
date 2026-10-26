import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import type { WebProps } from "./web-schema";
import {
  IMAGE_TOP,
  IMAGE_WITH_PRICE_TOP,
  titleFontSize,
  sceneTitleFontSize,
} from "./web-layout";
function Shot({
  shot,
  index,
  brand,
  price,
  offer,
}: {
  shot: WebProps["shots"][number];
  index: number;
  brand: string;
  price?: string;
  offer?: string;
}) {
  const f = useCurrentFrame();
  const total = shot.seconds * 30;
  const a = interpolate(f, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const scene = shot.fit === "cover";
  const textMode =
    shot.textMode ?? (index === 0 || index === 4 ? "title" : "subtitle");
  const media = {
    width: "100%",
    height: "100%",
    objectFit: shot.fit,
    objectPosition: `${shot.focusX ?? 50}% ${shot.focusY ?? 50}%`,
    transform: shot.fit === "cover" ? `scale(${shot.zoom ?? 1})` : "none",
    transformOrigin: `${shot.focusX ?? 50}% ${shot.focusY ?? 50}%`,
  } as const;
  const captionEnd = shot.voiceSeconds
    ? Math.min(total, (shot.voiceSeconds + 0.12) * 30)
    : total;
  const subOpacity = interpolate(
    f,
    [0, 4, captionEnd - 4, captionEnd],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <AbsoluteFill
      style={{
        background: "#f1eee6",
        overflow: "hidden",
        fontFamily: '"PingFang SC","Noto Sans CJK SC",sans-serif',
        color: "#203b31",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset:
            shot.fit === "contain"
              ? `${index === 4 && (price || offer) ? IMAGE_WITH_PRICE_TOP : IMAGE_TOP}px 65px 300px`
              : "0",
          background: shot.fit === "contain" ? "#fff" : "transparent",
          borderRadius: shot.fit === "contain" ? 28 : 0,
          overflow: "hidden",
        }}
      >
        {shot.kind === "video" ? (
          <OffthreadVideo
            src={staticFile(shot.source)}
            volume={(frame) =>
              (shot.sourceVolume ?? 0) *
              (shot.audio && frame < shot.voiceSeconds * 30 ? 0.3 : 1) *
              interpolate(frame, [0, 4, total - 5, total], [0, 1, 1, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })
            }
            trimBefore={Math.round(shot.trimBefore * 30)}
            style={media}
          />
        ) : (
          <Img src={staticFile(shot.source)} style={media} />
        )}
      </div>
      {scene && (
        <>
          {textMode !== "none" && (
            <AbsoluteFill
              style={{
                background:
                  shot.textPlacement === "top"
                    ? "linear-gradient(180deg,#0009 0%,#0004 28%,transparent 48%)"
                    : "linear-gradient(180deg,#0003 0%,transparent 18%,transparent 57%,#0009 100%)",
              }}
            />
          )}
          {brand && (
            <div
              style={{
                position: "absolute",
                top: 105,
                left: 76,
                color: "#fff",
                fontSize: 26,
                letterSpacing: 3,
                textShadow: "0 2px 10px #0008",
              }}
            >
              {brand}
            </div>
          )}
          {textMode === "title" && (
            <div
              style={{
                position: "absolute",
                ...(shot.textPlacement === "top"
                  ? { top: 250 }
                  : { bottom: 430 }),
                left: 76,
                right: 100,
                opacity: a,
                transform: `translateY(${(1 - a) * 12}px)`,
                color: "#fffdf8",
                fontSize: sceneTitleFontSize(shot.headline),
                fontWeight: 500,
                lineHeight: 1.35,
                whiteSpace: "pre-line",
                wordBreak: "break-all",
                textShadow: "0 2px 18px #0006",
              }}
            >
              {shot.headline}
            </div>
          )}
          {textMode !== "none" && (shot.caption || textMode === "subtitle") && (
            <div
              style={{
                position: "absolute",
                ...(shot.textPlacement === "top"
                  ? { top: 530 }
                  : { bottom: 300 }),
                left: 85,
                right: 120,
                color: "#fffdf8",
                fontSize: 36,
                lineHeight: 1.5,
                opacity: subOpacity,
                textShadow: "0 2px 12px #0009",
              }}
            >
              {shot.caption || shot.headline}
            </div>
          )}
          {index === 4 && textMode !== "none" && (price || offer) && (
            <div
              style={{
                position: "absolute",
                left: 76,
                right: 100,
                bottom: 210,
                color: "#fff",
                fontSize: 30,
              }}
            >
              {[price, offer].filter(Boolean).join(" · ")}
            </div>
          )}
        </>
      )}
      {!scene && (
        <>
          <div
            style={{
              position: "absolute",
              top: 100,
              left: 76,
              right: 76,
              fontSize: 25,
              letterSpacing: 3,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>{brand || "DAILY OBJECTS"}</span>
            <span style={{ fontSize: 22 }}>AI 辅助创作</span>
          </div>
          <div
            style={{
              position: "absolute",
              top: 280,
              left: 76,
              right: 76,
              opacity: a,
              transform: `translateY(${(1 - a) * 15}px)`,
            }}
          >
            <div
              style={{
                fontSize: 24,
                letterSpacing: 3,
                marginBottom: 25,
                color: "#536b5d",
              }}
            >
              0{index + 1} / 05
            </div>
            <div
              style={{
                fontSize: titleFontSize(
                  shot.headline,
                  index === 0 || index === 4,
                ),
                wordBreak: "break-all",
                fontWeight: 600,
                lineHeight: 1.3,
                whiteSpace: "pre-line",
              }}
            >
              {shot.headline}
            </div>
          </div>
          {index === 4 && (price || offer) && (
            <div
              style={{
                position: "absolute",
                left: 76,
                top: 600,
                background: "#fffef4e8",
                borderRadius: 16,
                padding: "18px 25px",
                maxWidth: 900,
              }}
            >
              {price && (
                <div style={{ fontSize: 48, fontWeight: 600 }}>{price}</div>
              )}
              {offer && (
                <div style={{ fontSize: 28, marginTop: 8 }}>{offer}</div>
              )}
            </div>
          )}
          {shot.caption && (
            <div
              style={{
                position: "absolute",
                bottom: 205,
                left: 85,
                right: 85,
                textAlign: "center",
                fontSize: 35,
                lineHeight: 1.6,
                opacity: subOpacity,
                color: shot.fit === "cover" ? "#fffdf6" : "#203b31",
                textShadow: shot.fit === "cover" ? "0 2px 12px #0009" : "none",
              }}
            >
              {shot.caption}
            </div>
          )}
          <div
            style={{
              position: "absolute",
              bottom: 105,
              left: 76,
              fontSize: 21,
              color: shot.fit === "cover" ? "#ffffffbb" : "#567364",
            }}
          >
            商品信息以实际说明为准
          </div>
        </>
      )}
      {shot.audio && <Audio src={staticFile(shot.audio)} />}
    </AbsoluteFill>
  );
}
export const WebStory: React.FC<WebProps> = (p) => {
  let offset = 0;
  const total = p.shots.reduce((n, s) => n + s.seconds * 30, 0);
  return (
    <AbsoluteFill>
      {p.shots.map((s, i) => {
        const from = offset;
        offset += Math.round(s.seconds * 30);
        return (
          <Sequence
            key={s.id}
            from={from}
            durationInFrames={Math.round(s.seconds * 30)}
          >
            <Shot
              shot={s}
              index={i}
              brand={p.brand}
              price={p.price}
              offer={p.offer}
            />
          </Sequence>
        );
      })}
      {p.music && (
        <Audio
          loop
          src={staticFile(p.music)}
          volume={(frame) => {
            let start = 0;
            let talking = false;
            for (const s of p.shots) {
              if (frame >= start && frame < start + s.voiceSeconds * 30)
                talking = true;
              start += s.seconds * 30;
            }
            return (
              interpolate(frame, [0, 20, total - 30, total], [0, 1, 1, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }) * (talking ? 0.18 : 0.38)
            );
          }}
        />
      )}
    </AbsoluteFill>
  );
};
