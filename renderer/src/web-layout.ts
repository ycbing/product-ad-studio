/** Conservative text fitting for the fixed portrait title safe area. */
export const IMAGE_TOP = 620;
export const IMAGE_WITH_PRICE_TOP = 850;
export function titleFontSize(
  text: string,
  hero: boolean,
  width = 928,
  maxHeight = 230,
) {
  const weight = (line: string) =>
    Array.from(line).reduce(
      (n, c) =>
        n + (/\s/.test(c) ? 0.35 : c.codePointAt(0)! > 255 ? 1.04 : 0.66),
      0,
    );
  for (let size = hero ? 84 : 62; size >= 28; size -= 2) {
    const lines = text
      .split(/\r?\n/)
      .reduce(
        (n, line) => n + Math.max(1, Math.ceil((weight(line) * size) / width)),
        0,
      );
    if (lines * size * 1.3 <= maxHeight) return size;
  }
  return 28;
}

export function sceneTitleFontSize(text: string) {
  return Math.min(72, titleFontSize(text, true, 904, 220));
}
