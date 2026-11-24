import { type Locator } from '@playwright/test';

/**
 * The WCAG contrast ratio of an element's text against the first solid
 * background behind it (its own or an ancestor's), with the element's own
 * opacity and its ancestors' applied to the text, as a reader sees it.
 */
export function contrast(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const rgba = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = ([r, g, b]: number[]) => {
      const channel = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0);
    };
    let back: number[] = [255, 255, 255];
    for (let e: Element | null = element; e; e = e.parentElement) {
      const parts = rgba(getComputedStyle(e).backgroundColor);
      if (parts.length >= 3 && (parts[3] ?? 1) >= 0.99) {
        back = parts;
        break;
      }
    }
    let alpha = 1;
    for (let e: Element | null = element; e; e = e.parentElement) {
      alpha *= Number(getComputedStyle(e).opacity);
    }
    const ink = rgba(getComputedStyle(element).color);
    alpha *= ink[3] ?? 1;
    const seen = [0, 1, 2].map((i) => (ink[i] ?? 0) * alpha + (back[i] ?? 0) * (1 - alpha));
    const [a, b] = [luminance(seen), luminance(back)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}
