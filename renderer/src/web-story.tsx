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
  const media = {
    width: "100%",
    height: "100%",
    objectFit: shot.fit,
    transform:
      shot.fit === "cover" ? `scale(${1.02 + (f / total) * 0.02})` : "none",
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
          inset: shot.fit === "contain" ? "520px 65px 300px" : "0",
          background: shot.fit === "contain" ? "#fff" : "transparent",
          borderRadius: shot.fit === "contain" ? 28 : 0,
          overflow: "hidden",
        }}
      >
        {shot.kind === "video" ? (
          <OffthreadVideo
            src={staticFile(shot.source)}
            muted
            trimBefore={Math.round(shot.trimBefore * 30)}
            style={media}
          />
        ) : (
          <Img src={staticFile(shot.source)} style={media} />
        )}
      </div>
      {shot.fit === "cover" && (
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(180deg,#faf7ef99,transparent 45%,transparent 66%,#10241b99)",
          }}
        />
      )}
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
            fontSize: index === 0 || index === 4 ? 84 : 62,
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
            top: 540,
            background: "#fffef4e8",
            borderRadius: 16,
            padding: "18px 25px",
            maxWidth: 900,
          }}
        >
          {price && (
            <div style={{ fontSize: 48, fontWeight: 600 }}>{price}</div>
          )}
          {offer && <div style={{ fontSize: 28, marginTop: 8 }}>{offer}</div>}
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
