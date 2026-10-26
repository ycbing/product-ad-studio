export type Box = { left: number; top: number; right: number; bottom: number };
/** object-fit:cover, object-position and transform-origin use the same focal point. */
export function visibleSource(
  width: number,
  height: number,
  focusX = 50,
  focusY = 50,
  zoom = 1,
): Box {
  const aspect = 9 / 16;
  const w = Math.min(1, (height * aspect) / width) / zoom;
  const h = Math.min(1, width / aspect / height) / zoom;
  const left = ((1 - w) * focusX) / 100,
    top = ((1 - h) * focusY) / 100;
  return {
    left: left * 100,
    top: top * 100,
    right: (left + w) * 100,
    bottom: (top + h) * 100,
  };
}
export function contains(outer: Box, inner: Box, tolerance = 0.25) {
  return (
    inner.left >= outer.left - tolerance &&
    inner.top >= outer.top - tolerance &&
    inner.right <= outer.right + tolerance &&
    inner.bottom <= outer.bottom + tolerance
  );
}
export function screenSubject(visible: Box, subject: Box): Box {
  const x = (p: number) =>
    ((p - visible.left) / (visible.right - visible.left)) * 100;
  const y = (p: number) =>
    ((p - visible.top) / (visible.bottom - visible.top)) * 100;
  return {
    left: x(subject.left),
    right: x(subject.right),
    top: y(subject.top),
    bottom: y(subject.bottom),
  };
}
export function textIntersects(
  subject: Box,
  placement: "top" | "bottom",
  mode: "title" | "subtitle" | "none",
) {
  if (mode === "none") return false;
  const zone =
    placement === "top"
      ? mode === "title"
        ? { top: 12, bottom: 36 }
        : { top: 27, bottom: 36 }
      : mode === "title"
        ? { top: 64, bottom: 87 }
        : { top: 79, bottom: 87 };
  return (
    subject.right > 7 &&
    subject.left < 91 &&
    subject.bottom > zone.top &&
    subject.top < zone.bottom
  );
}
export function safeText(subject: Box, mode: "title" | "subtitle") {
  if (!textIntersects(subject, "bottom", mode))
    return { textMode: mode, textPlacement: "bottom" as const };
  if (!textIntersects(subject, "top", mode))
    return { textMode: mode, textPlacement: "top" as const };
  return { textMode: "none" as const, textPlacement: "bottom" as const };
}
export function focusForBox(
  width: number,
  height: number,
  subject: Box,
  zoom = 1,
) {
  const base = visibleSource(width, height, 50, 50, zoom);
  const w = base.right - base.left,
    h = base.bottom - base.top;
  const axis = (center: number, extent: number) =>
    extent >= 99.999
      ? 50
      : Math.max(
          0,
          Math.min(100, ((center - extent / 2) / (100 - extent)) * 100),
        );
  return {
    focusX: axis((subject.left + subject.right) / 2, w),
    focusY: axis((subject.top + subject.bottom) / 2, h),
  };
}
