import { describe, expect, it } from 'vitest';
import { ALL_PANELS, togglePanels, TOUR_VIDEO_URL } from './layout';

// The rules are reactome.org's (pwp-browser DesktopAppDisplay): each panel
// toggles on its own, and the centre control is "expand/minimise centre
// display" -- if either panel is showing it hides both, otherwise it brings
// both back.
describe('the layout controls', () => {
  it('show everything to begin with', () => {
    expect(ALL_PANELS).toEqual({ hierarchy: true, details: true });
  });

  it('hide and show the hierarchy panel on its own', () => {
    const hidden = togglePanels(ALL_PANELS, 'hierarchy');
    expect(hidden).toEqual({ hierarchy: false, details: true });
    expect(togglePanels(hidden, 'hierarchy')).toEqual(ALL_PANELS);
  });

  it('hide and show the details panel on its own', () => {
    const hidden = togglePanels(ALL_PANELS, 'details');
    expect(hidden).toEqual({ hierarchy: true, details: false });
    expect(togglePanels(hidden, 'details')).toEqual(ALL_PANELS);
  });

  it('expand the centre by hiding both panels when either is showing', () => {
    expect(togglePanels(ALL_PANELS, 'centre')).toEqual({ hierarchy: false, details: false });
    expect(togglePanels({ hierarchy: false, details: true }, 'centre')).toEqual({
      hierarchy: false,
      details: false,
    });
    expect(togglePanels({ hierarchy: true, details: false }, 'centre')).toEqual({
      hierarchy: false,
      details: false,
    });
  });

  it('restore both panels from the expanded centre', () => {
    expect(togglePanels({ hierarchy: false, details: false }, 'centre')).toEqual(ALL_PANELS);
  });

  it('never change the state they were given', () => {
    const before = { hierarchy: true, details: true };
    togglePanels(before, 'centre');
    expect(before).toEqual({ hierarchy: true, details: true });
  });
});

describe('the tour', () => {
  it("plays reactome.org's tour video", () => {
    // The one the former browser's Tour dialog embeds (pwp-browser TourContainer).
    expect(new URL(TOUR_VIDEO_URL).pathname).toBe('/embed/rDXvQcBl3Y0');
  });

  it('embeds it without YouTube cookies', () => {
    // Privacy-enhanced mode: nothing is stored about a reader who opens the tour
    // and never plays it.
    expect(new URL(TOUR_VIDEO_URL).host).toBe('www.youtube-nocookie.com');
  });
});
