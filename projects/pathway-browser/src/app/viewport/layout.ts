/**
 * The top bar's Layout and Tour controls, as reactome.org's browser has them.
 *
 * The rules are the former browser's (pwp-browser `DesktopAppDisplay`), so a
 * reader moving between the two finds the same behaviour: each panel toggles on
 * its own, and the centre control expands the view by hiding both panels, or
 * brings both back once neither is showing. Not kept across a reload, which is
 * also as before -- the former browser remembered sizes dragged with the
 * dividers, not these toggles.
 */
export interface PanelLayout {
  hierarchy: boolean;
  details: boolean;
}

export type LayoutControl = keyof PanelLayout | 'centre';

export const ALL_PANELS: Readonly<PanelLayout> = { hierarchy: true, details: true };

export function togglePanels(layout: PanelLayout, control: LayoutControl): PanelLayout {
  if (control === 'centre') {
    const anyShowing = layout.hierarchy || layout.details;
    return { hierarchy: !anyShowing, details: !anyShowing };
  }
  return { ...layout, [control]: !layout[control] };
}

/**
 * The tour video the former browser's Tour dialog plays, embedded in YouTube's
 * privacy-enhanced mode so nothing is stored until the reader plays it.
 */
export const TOUR_VIDEO_URL = 'https://www.youtube-nocookie.com/embed/rDXvQcBl3Y0';
