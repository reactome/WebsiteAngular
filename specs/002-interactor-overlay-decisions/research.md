# Decisions behind the interactor overlay

Each entry: what was decided, why, what was rejected, and the measurement that
settled it. Dates are when the figure was read off beta or the ContentService.

---

## D1. The count beside a resource is interactions, not entities

**Decision**: The number beside each resource counts **interactions** — the same
unit as the badge drawn on an entity. How many entities carry them is in the
tooltip.

**Why**: It was entities, and the two were rendered identically with nothing
saying so. Reported from beta as impossible: Reactome-FIs read **15** beside an
MCM7 badge reading **17**. Both were correct and the pair was nonsense.

**Measured** (2026-09-15, R-HSA-69306 with Reactome-FIs): 18 accessions posted,
13 entities returned, **78 interactions**, MCM7 alone **17**. The service's
`count` field equals the interactor array length throughout.

**Rejected**: keeping entities and relabelling. Coverage is the more useful
signal when choosing between resources, but a bare number that cannot be compared
to the badge beside it is worse than a less useful number that can. Coverage
survives in the tooltip.

---

## D2. A diagram tally counts each protein once

**Decision**: When tallying what is drawn, badges are deduplicated by accession.

**Why**: A protein drawn twice on a diagram carries two badges repeating the same
interactions. Summing badges therefore overstates.

**Measured** (2026-09-15, R-HSA-69306): **15 badges over 13 accessions**; summing
badges gives 84 where the resource holds 78. The panel asks the resource directly
before anything is drawn, so it would have shown 78 and then changed its mind to
84 on the click.

---

## D3. The count badge is not drawn below 0.6 zoom

**Decision**: Below 0.6 the badge is not drawn at all.

**Why**: It is 30 model units wide. At the **0.283** R-HSA-1368108 opens at, that
is **six screen pixels** holding a two-digit number. The old browser stops drawing
it too: `RendererManager.setFactor` swaps renderer tiers at 0.5 and
`ProteinRenderer000` never calls `drawSummaryItems`.

**Rejected**: holding a minimum on-screen size as a map pin does — issue #200's
suggestion 3. A badge that keeps its size while the diagram shrinks detaches from
the entity it belongs to, and at the zooms in question would cover it.

**0.6 rather than 0.5**: chosen here rather than copied, because a cytoscape zoom
and a GWT factor are not the same quantity. 0.6 puts the badge at 18 screen
pixels, which is where its digits stop being a smudge.

---

## D4. If they cannot be seen, say so

**Decision**: When a resource has badges and none can be drawn, a bar says so and
offers "Zoom to them".

**Why**: D3 is right and left a hole. Measured (2026-09-15, R-HSA-1368108 at its
opening zoom of 0.283): choosing IntAct put **nine badges** on the graph, **none
visible**, and said nothing anywhere. The overlay appeared to do nothing — which
is the complaint this whole feature began with.

**The button fits the badges' _entities_, not the badges.** `cy.fit` ignores
elements it cannot see, so fitting to hidden badges moved nothing: 0.283 before,
0.283 after. Fitting those nine entities reaches only 0.308, still below the
drawing threshold, so there is a floor just past it.

---

## D5. The download is the data, not the view

**Decision**: The file carries every interaction the opened entities hold,
whatever the threshold.

**Why**: A spreadsheet can filter further; nothing recovers rows that were never
written; and a file of twelve rows beside a badge reading 73 is a contradiction
the reader has to resolve. Reading the drawn nodes also quietly lost one of
BHLHE40's 73 — an interaction whose partner is already on the diagram gets an
edge but no node of its own. The badge counts it; so should the file.

It also means the drawing cap cannot truncate the file: draw 100 of 150 and the
file still carries 150.

---

## D6. The threshold is remembered per resource

**Decision**: Each resource opens at the threshold it was last left at; one never
seen opens at the default (0.45, the old browser's `DEFAULT_SCORE`).

**Why**: Resources do not score alike, so one number across all of them is the
wrong shape. The old browser holds the same map —
`Map<String, Double> interactorsThreshold` in `InteractorsContent.java`.

**Deliberately not in the URL**: the address carries the threshold _in force_,
which is what sharing needs. Putting every resource's threshold in it would make
the address unreadable for no one's benefit.

**A resource never seen does not inherit.** Inheriting is how a reader ends up
with an empty diagram and no idea why.

---

## D7. A reader's gesture and the address being replayed are different things

**Decision**: The replay path says it is a replay.

**Why**: Both reach the same method — `stateToDiagram` reads the address and
hands it to the same call a click goes through. Two released bugs came from not
distinguishing them:

1. A shared threshold was reset on load. Measured: `?overlay=Reactome-FIs&
interactorScore=0.8` arrived and settled at no threshold at all, while the same
   address _without_ the overlay kept 0.8.
2. The overlay was lost on Back, because the replay looked like the
   toggle-to-unselect gesture. Measured by logging history writes: the browser
   restored `?overlay=IntAct&tab=details` and the app immediately pushed
   `?tab=details` over it.

**This is the recurring fault in this area.** Any path where the URL is replayed
through a handler that also serves a reader's gesture is suspect.

---

## D8. A reader's own data is read in the browser

**Decision**: A file or pasted table is parsed in the page. No request is made.
Uploading is an explicit tick-box.

**Why**: Uploading was inherited from the GWT browser, not required. Traced
(2026-09-15): the content was posted to the ContentService, parsed there, written
to `custom/<token>.bin`, and named by a token that became part of the page's
address. A fresh upload was read back by a request carrying **no session**. The
store held **323 files, oldest 2019-05-01**, and nothing expires.

**Measured**: adding a local resource went from **two** requests to **zero**.

**Kept as a choice** because that token is the only thing that makes an overlay
survive a reload or open for a colleague. Removing it would have taken away a real
capability in the name of privacy; making it a choice gives the reader both.

**URL and PSICQUIC options still go to the server**: a page cannot fetch an
arbitrary origin.

---

## D9. Nothing is asked until the panel is open

**Decision**: Resource counts are prefetched when the reader opens the panel, not
when a pathway loads.

**Why**: The panel is hidden with `display`, never destroyed, so an ungated
prefetch fired **a request to every third-party PSICQUIC server on every pathway
anyone opened** — thirteen of them on 2026-09-15, twelve on 2026-09-16, because
the list is served by third parties and changes.

Measured on R-HSA-1368108: a reader who never opens the panel made **14**
interactor requests; now **1**.

It also starved the same-origin connection pool — browsers allow about six
connections per host — and broke an unrelated test, the Molecules tab, which
timed out waiting for data behind those requests. That failure is what made the
cost visible.

Opening the panel is the moment the counts are wanted, so nothing is lost.

---

## D10. The control is called "Interactors"

**Decision**: The header control says "Interactors", with the chosen resource
beneath it.

**Why**: It said "Overlay" — the category it belongs to, not the thing it turns
on. A reader looking for interactors had no word to look for, and two readers in
a row missed a feature that was working.

**Rejected for now**: moving it to the diagram toolbar, which is where production
puts it (#200 suggestion 2). That is a layout change, not a label change, and is
still open.

**Rejected**: matching production's red badge (#200 suggestion 4). Disease badges
are already red (`#BA1A1A`) and ordinary interactor badges purple (`#68297C`);
making ordinary badges red would make the two indistinguishable. That needs a
decision about which distinction matters more, not a colour swap.

---

## D11. The header controls stay divs

**Decision**: They keep their markup and gain `role`, `tabindex`, key handling,
labels and `aria-controls`, rather than becoming `<button>` elements.

**Why**: They were plain divs with a click handler —
`{ role: null, tabindex: null, focusable: false }`, measured — so species
filtering and the whole interactor overlay were closed to anyone not using a
mouse. A `<button>` would bring its own layout, and these divs carry layout the
surrounding flex rules depend on.

Escape closes either panel and **returns focus to the control**: without that,
focus fell to `<body>` and a reader who closed the panel had lost their place on
the page entirely.

---

## The custom upload contract

Measured against beta's ContentService, 2026-09-15, by probing rather than
reading source:

| Input                        | Result                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| `#ID_A<tab>ID_B` then pairs  | accepted, no warning                                             |
| no header, two columns       | accepted, **first pair read as the header and dropped**, warned  |
| any third column             | refused                                                          |
| not tabular                  | refused: "Could not Parse your file"                             |
| rows not matching the header | refused: "Line 2 does not have mandatory field(s): [ID_A, ID_B]" |

The in-browser reader matches this format deliberately, so the same file works
either way, with two differences in the reader's favour: a missing header warns
instead of silently eating a pair, and a malformed line is skipped and named
rather than failing the file. Uploaded tuples are assigned a score of 1.0 by the
service, so the in-browser reader does the same — otherwise the confidence filter
would hide every custom interaction.
