# Curator report

Running list for the next round with the curators. Three kinds of entry: things
we need **them** to check, things we have **decided** and they should know, and
things **waiting on someone else**. Fixed-and-confirmed items get deleted from
here rather than accumulating — git history is the record of what was fixed.

Last updated: 2026-08-20

## Please check on beta.reactome.org

> Note the URL. `beta.reactome.org` is the new site. `reactome.org/beta` is an
> older build sitting on the production machine and is **not** updated by our
> work — a fix will never appear there.

| #                                                             | What to check                                                                                                                                                                                        | Why we are asking                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#150](https://github.com/reactome/WebsiteAngular/issues/150) | Flag something, then confirm trivial molecules (H₂O, ATP…) stay visible at every zoom, and that their chemical structures never appear without the molecule underneath                               | Two real defects were fixed, but the original reports say "sometimes, but not always", and we could not make the failure happen on demand. We need someone who has seen it to confirm                                           |
| [#143](https://github.com/reactome/WebsiteAngular/issues/143) | Same as above, specifically while navigating between pathways with a flag active                                                                                                                     | As above                                                                                                                                                                                                                        |
| [#154](https://github.com/reactome/WebsiteAngular/issues/154) | Right-click a complex or set after running an analysis: components are listed and the ones in your data are marked                                                                                   | Closed on the basis that the right-click panel delivers this. **Reopen if "within a diagram" meant drawing components as nodes inside the canvas** — that is a much larger piece, and the old GWT browser does not do it either |
| [#81](https://github.com/reactome/WebsiteAngular/issues/81)   | Community → Events: confirm every attachment you expect is present                                                                                                                                   | All 5 "Poster" links on the page resolve, but if a specific event is missing an attachment we have not spotted it                                                                                                               |
| **PowerPoint**                                                | Download a diagram as **PPTX**, open it in real PowerPoint, then right-click the diagram → _Graphics Format_ → **Convert to Shape**. Does it open cleanly, and do you get editable shapes?           | **We cannot test this — there is no PowerPoint on the build machine.** The file is validated structurally, but "opens in PowerPoint" is a different claim. See the decision below about what we chose here and why              |
| **GIF**                                                       | Download a diagram as **GIF** with an expression analysis active. It should animate one frame per sample and look like the current site                                                              | New: it used to come from the old Java exporter, which is why it looked like the old diagrams. Also tell us whether ~1 MB for four samples is acceptable, and whether 1 second per sample is the right pace                     |
| [#141](https://github.com/reactome/WebsiteAngular/issues/141) | **Animated SVG**: open the downloaded file in a browser or Inkscape, then click the play/pause button, click any segment of the timeline to jump to that sample, and hover a segment to see its name | New controls. They need the file **opened as a document** — inside an `<img>`, or in a viewer that blocks scripts, the buttons are inert by design and hovering the button still pauses                                         |
| [#140](https://github.com/reactome/WebsiteAngular/issues/140) | Flag a gene in the **genome-wide view**, with and without an analysis running                                                                                                                        | Flagging is now an outline instead of a fill, so the analysis colours survive underneath. Previously a flagged pathway lost its result colour, and without an analysis everything else was washed out                           |
| **Illustration downloads**                                    | Download an illustrated pathway (Apoptosis, say) as **PNG** or **JPEG**                                                                                                                              | It was scaled twice and you got the **top-left ninth** of the illustration blown up to fill the file. Fixed, but worth one look                                                                                                 |
| [#137](https://github.com/reactome/WebsiteAngular/issues/137) | Selecting things: in the event hierarchy, the analysis results table, and the search results. The selection should come into view without the panel jumping to the top                               | One shared implementation now. Nothing should move at all when the selected thing is already visible                                                                                                                            |

## Decisions they should know about

- **PowerPoint files carry the diagram as a vector image, not as shapes.** The old
  exporter emitted a PowerPoint shape per glyph, so a file was editable the moment
  it opened. It did that through a second, independent reimplementation of the
  diagram — the reason exports drifted from the site — and a commercial Aspose
  licence. Ours embeds the SVG, which PowerPoint draws and converts to editable
  shapes in one click (_Graphics Format → Convert to Shape_). **If that click is
  unacceptable, say so** — it is the one place we traded a small amount of
  convenience for removing the second renderer.
- **GIF and PPTX now come from our own renderer**, so what you download is what the
  site draws. For **illustrated** pathways they still come from the content
  service, deliberately: it serves the same illustration file either way.
- **GIF renders at the diagram's own size** (around 6000px wide) rather than being
  fitted to 2000px. Fitting it made 8pt labels unreadable. It stays around 1 MB
  because only what changes between samples is stored.
- **Exported figures are always light.** The diagram has a full dark theme and the
  renderer can use it, but it is not offered in the download panel: the dark
  palette is designed for the screen, and as a standalone figure it reads as muddy.
  Say the word if anyone actually wants dark figures.
- **The download panel has one checkbox for sub-pathway highlighting**, which
  applies to every format including the server-rendered ones. Off leaves the tints
  and labels out of the figure.
- **If GIF or PPTX fails**, it is probably the render service rather than the
  diagram: those two are produced by a service running alongside the site. Report
  it as "GIF download failed" and we will look at the service, not the diagram.

- **DisGeNET overlay page ([#92](https://github.com/reactome/WebsiteAngular/issues/92)) is not being ported.** Team decision, 2026-08-19. Old links now land on a not-found page that offers the same path on reactome.org, so nobody hits a dead end.
- **Right-click menu, molecules download, analysis error handling, hierarchy scrolling, compare mode** — all previously reported and now fixed. Worth a spot-check but we are not blocking on it.
- **The minimap is interactive again.** It was removed deliberately to save time; two people reported it, so pressing or dragging it now pans the diagram.

## Waiting on someone else

- **The render service is not deployed properly yet.** It runs as a plain process
  on the dev box, so a reboot stops it and GIF/PPTX stop with it. The container
  that fixes that is written and needs a little disk headroom on the box. Rate
  limiting in front of it is required before this fronts reactome.org.
- **Cloudflare cache purge** — one-off, for figures cached before 2026-08-20.
  Nothing new is cached now.
- **[#139](https://github.com/reactome/WebsiteAngular/issues/139) native cytoscape
  shapes** needs the cytoscape team; it is their catalogue we would be adding to.
- **[#153](https://github.com/reactome/WebsiteAngular/issues/153) skipping the
  diagram.json conversion** touches the shared diagram library, so it needs
  beaversd and guanmingwu before anyone starts.

- **ORCID "Claim Your Work" ([#114](https://github.com/reactome/WebsiteAngular/issues/114))** — blocked on a backend deploy, not on frontend work. The person-page endpoints return real data, but `/ContentService/orcid/authenticated`, `/orcid/login` and `/orcid/claim/*` all 404: the `org.reactome.server.orcid.*` package is not in the deployed WAR. Needs that build deployed plus ORCID credentials in `service.properties`. Deferred by agreement, 2026-08-19.

## Known and deliberately not fixed

- [#136](https://github.com/reactome/WebsiteAngular/issues/136) node spacing / text size — already labelled `wontfix` upstream of us.
