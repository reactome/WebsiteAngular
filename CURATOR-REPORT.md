# Curator report

Running list for the next round with the curators. Three kinds of entry: things
we need **them** to check, things we have **decided** and they should know, and
things **waiting on someone else**. Fixed-and-confirmed items get deleted from
here rather than accumulating — git history is the record of what was fixed.

Last updated: 2026-08-19

## Please check on beta.reactome.org

> Note the URL. `beta.reactome.org` is the new site. `reactome.org/beta` is an
> older build sitting on the production machine and is **not** updated by our
> work — a fix will never appear there.

| #                                                             | What to check                                                                                                                                                          | Why we are asking                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#150](https://github.com/reactome/WebsiteAngular/issues/150) | Flag something, then confirm trivial molecules (H₂O, ATP…) stay visible at every zoom, and that their chemical structures never appear without the molecule underneath | Two real defects were fixed, but the original reports say "sometimes, but not always", and we could not make the failure happen on demand. We need someone who has seen it to confirm                                           |
| [#143](https://github.com/reactome/WebsiteAngular/issues/143) | Same as above, specifically while navigating between pathways with a flag active                                                                                       | As above                                                                                                                                                                                                                        |
| [#154](https://github.com/reactome/WebsiteAngular/issues/154) | Right-click a complex or set after running an analysis: components are listed and the ones in your data are marked                                                     | Closed on the basis that the right-click panel delivers this. **Reopen if "within a diagram" meant drawing components as nodes inside the canvas** — that is a much larger piece, and the old GWT browser does not do it either |
| [#81](https://github.com/reactome/WebsiteAngular/issues/81)   | Community → Events: confirm every attachment you expect is present                                                                                                     | All 5 "Poster" links on the page resolve, but if a specific event is missing an attachment we have not spotted it                                                                                                               |

## Decisions they should know about

- **DisGeNET overlay page ([#92](https://github.com/reactome/WebsiteAngular/issues/92)) is not being ported.** Team decision, 2026-08-19. Old links now land on a not-found page that offers the same path on reactome.org, so nobody hits a dead end.
- **Right-click menu, molecules download, analysis error handling, hierarchy scrolling, compare mode** — all previously reported and now fixed. Worth a spot-check but we are not blocking on it.
- **The minimap is interactive again.** It was removed deliberately to save time; two people reported it, so pressing or dragging it now pans the diagram.

## Waiting on someone else

- **ORCID "Claim Your Work" ([#114](https://github.com/reactome/WebsiteAngular/issues/114))** — blocked on a backend deploy, not on frontend work. The person-page endpoints return real data, but `/ContentService/orcid/authenticated`, `/orcid/login` and `/orcid/claim/*` all 404: the `org.reactome.server.orcid.*` package is not in the deployed WAR. Needs that build deployed plus ORCID credentials in `service.properties`. Deferred by agreement, 2026-08-19.

## Known and deliberately not fixed

- [#136](https://github.com/reactome/WebsiteAngular/issues/136) node spacing / text size — already labelled `wontfix` upstream of us.
