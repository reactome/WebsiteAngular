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
 * The tour video the Tour dialog plays, embedded in YouTube's privacy-enhanced
 * mode so nothing is stored until the reader plays it; the Tour button shows
 * only while there is one. None for now (#446): the former browser's video
 * (https://www.youtube-nocookie.com/embed/rDXvQcBl3Y0) shows the old website,
 * so it is not offered until a tutorial of this one is made. Set its embed
 * address here, from www.youtube-nocookie.com, to bring the button back.
 */
export const TOUR_VIDEO_URL: string | undefined = undefined;
