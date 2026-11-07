# Today's answers (T004)

What the exports answer today, for the 30 events of [sample.md](sample.md), taken once on 23 Oct 2026 from the beta host only, spaced (20 s after each SBML, 10 s after each BioPAX):

- **SBML** from the Java ContentService: `/ContentService/exporter/event/{stId}.sbml`. It reads the graph and the relational database.
- **BioPAX** from the legacy RESTful service on the same Tomcat: `/ReactomeRESTfulAPI/RESTfulWS/biopaxExporter/Level3/{dbId}`. It reads the relational database.

The files themselves stay outside the repository: they hold people's names (SBML creators, BioPAX authors and curation comments).

**Headers.**

- **SBML:** `application/sbml+xml;charset=UTF-8` and `attachment; filename="{stId}.sbml"`, on every event.
- **BioPAX:** `text/plain;charset=UTF-8`, with no Content-Disposition.

**Times are not comparable across events.** Java keeps SBML per release on disk once made, so an event exported before (Signal Transduction, 0.05 s for 23.5 MB) answers from that cache, while a first export builds it: Disease took 126 s, against the shared graph. BioPAX has no cache; its times are the relational database's.

| Event         | SBML                   | BioPAX                 |
| ------------- | ---------------------- | ---------------------- |
| R-HSA-162582  | 200, 23.5 MB, 0.05 s   | 200, 53.0 MB, 42.17 s  |
| R-HSA-1640170 | 200, 4.7 MB, 29.69 s   | 200, 11.6 MB, 14.47 s  |
| R-HSA-1643685 | 200, 18.6 MB, 126.29 s | 200, 79.1 MB, 100.32 s |
| R-HSA-5357801 | 200, 1.9 MB, 13.38 s   | 200, 4.5 MB, 1.35 s    |
| R-HSA-1474244 | 200, 3.5 MB, 18.32 s   | 200, 12.5 MB, 14.51 s  |
| R-HSA-69620   | 200, 1.0 MB, 0.01 s    | 200, 3.1 MB, 0.08 s    |
| R-HSA-109581  | 200, 1.4 MB, 3.16 s    | 200, 3.2 MB, 0.08 s    |
| R-HSA-109606  | 200, 807 KB, 0.02 s    | 200, 1.3 MB, 0.04 s    |
| R-HSA-112409  | 200, 198 KB, 0.46 s    | 200, 426 KB, 0.01 s    |
| R-HSA-5683057 | 200, 1.2 MB, 5.92 s    | 200, 4.9 MB, 3.23 s    |
| R-HSA-1280215 | 200, 7.0 MB, 50.07 s   | 200, 17.8 MB, 18.01 s  |
| R-HSA-9006936 | 200, 1.3 MB, 6.65 s    | 200, 2.9 MB, 2.23 s    |
| R-HSA-9839373 | 200, 321 KB, 1.16 s    | 200, 674 KB, 0.03 s    |
| R-HSA-69481   | 200, 282 KB, 0.01 s    | 200, 1.6 MB, 0.04 s    |
| R-HSA-176187  | 200, 133 KB, 0.02 s    | 200, 431 KB, 0.09 s    |
| R-HSA-180024  | 200, 117 KB, 0.70 s    | 200, 379 KB, 0.21 s    |
| R-HSA-5663202 | 200, 4.2 MB, 7.95 s    | 200, 19.0 MB, 0.46 s   |
| R-HSA-2894858 | 200, 221 KB, 0.75 s    | 200, 842 KB, 0.02 s    |
| R-HSA-6802957 | 200, 454 KB, 0.84 s    | 200, 2.8 MB, 0.07 s    |
| R-MMU-69620   | 200, 719 KB, 2.43 s    | 200, 2.5 MB, 2.70 s    |
| R-BTA-109581  | 200, 729 KB, 4.18 s    | 200, 1.9 MB, 1.62 s    |
| R-HSA-69604   | 200, 23 KB, 0.01 s     | 200, 56 KB, 0.01 s     |
| R-HSA-69562   | 200, 14 KB, 0.01 s     | 200, 56 KB, 0.01 s     |
| R-HSA-109862  | 200, 13 KB, 0.11 s     | 200, 46 KB, 0.01 s     |
| R-HSA-1248655 | 200, 12 KB, 0.11 s     | 200, 68 KB, 0.01 s     |
| R-HSA-201425  | 200, 11 KB, 0.09 s     | 200, 60 KB, 0.01 s     |
| R-HSA-8963913 | 200, 8 KB, 0.11 s      | 200, 12 KB, 0.02 s     |
| R-HSA-9915356 | 200, 10 KB, 0.10 s     | 200, 49 KB, 0.01 s     |
| R-HSA-874079  | 200, 8 KB, 0.14 s      | 200, 27 KB, 0.03 s     |
| R-HSA-8952903 | 200, 11 KB, 0.14 s     | 200, 25 KB, 0.03 s     |

## BioPAX at release 98 (T049)

Taken again on 7 Nov 2026, once and one at a time, spaced (at least 1 s, or half the request's time, after each), when the legacy service's relational database had moved to release 98 (research R4): the legacy service's answer by dbId, and node's `/ContentService/exporter/event/{stId}.biopax`, the library service's, from beta's graph at release 98. The two inferred events' dbIds are release 98's (sample.md). The files stay outside the repository, as above.

- **Headers.** The legacy service's: `text/plain;charset=UTF-8`, no Content-Disposition, as at release 97. Node's: `application/rdf+xml;charset=UTF-8` and `attachment; filename="{stId}.biopax"` (R6). Both files carry `xml:base="http://www.reactome.org/biopax/98/{dbId}#"`, the same for each event.
- **Times.** The library service keeps each file per release once made, so an event asked for before answers from that cache (R-HSA-109581, R-HSA-69604); the rest are first conversions, on a host under load from other work (a load average of about 7 on 8 cores). Disease's first conversion took longer than node's 290 s, so node answered its 503 ("took too long"); the service finished and kept the file, and the next request, a minute later, was answered in 33 s.

| Event         | dbId     | Legacy                | Library, through node                    |
| ------------- | -------- | --------------------- | ---------------------------------------- |
| R-HSA-162582  | 162582   | 200, 48.9 MB, 56.44 s | 200, 47.5 MB, 262.21 s                   |
| R-HSA-1640170 | 1640170  | 200, 10.4 MB, 11.25 s | 200, 10.0 MB, 35.22 s                    |
| R-HSA-1643685 | 1643685  | 200, 74.4 MB, 77.18 s | 503 at 290 s, then 200, 73.3 MB, 32.80 s |
| R-HSA-5357801 | 5357801  | 200, 3.9 MB, 1.64 s   | 200, 3.8 MB, 14.91 s                     |
| R-HSA-1474244 | 1474244  | 200, 11.8 MB, 17.72 s | 200, 11.3 MB, 48.36 s                    |
| R-HSA-69620   | 69620    | 200, 2.7 MB, 0.07 s   | 200, 2.6 MB, 10.58 s                     |
| R-HSA-109581  | 109581   | 200, 2.7 MB, 2.04 s   | 200, 2.6 MB, 0.03 s                      |
| R-HSA-109606  | 109606   | 200, 1.1 MB, 1.54 s   | 200, 1.0 MB, 5.82 s                      |
| R-HSA-112409  | 112409   | 200, 378 KB, 0.01 s   | 200, 366 KB, 1.59 s                      |
| R-HSA-5683057 | 5683057  | 200, 4.3 MB, 4.23 s   | 200, 4.2 MB, 15.15 s                     |
| R-HSA-1280215 | 1280215  | 200, 16.3 MB, 24.25 s | 200, 15.8 MB, 61.66 s                    |
| R-HSA-9006936 | 9006936  | 200, 2.6 MB, 2.93 s   | 200, 2.5 MB, 9.25 s                      |
| R-HSA-9839373 | 9839373  | 200, 552 KB, 0.67 s   | 200, 535 KB, 1.91 s                      |
| R-HSA-69481   | 69481    | 200, 1.3 MB, 0.03 s   | 200, 1.2 MB, 4.29 s                      |
| R-HSA-176187  | 176187   | 200, 376 KB, 0.01 s   | 200, 365 KB, 1.20 s                      |
| R-HSA-180024  | 180024   | 200, 321 KB, 0.43 s   | 200, 311 KB, 1.20 s                      |
| R-HSA-5663202 | 5663202  | 200, 17.9 MB, 21.36 s | 200, 17.7 MB, 75.36 s                    |
| R-HSA-2894858 | 2894858  | 200, 707 KB, 1.35 s   | 200, 689 KB, 2.11 s                      |
| R-HSA-6802957 | 6802957  | 200, 2.6 MB, 4.39 s   | 200, 2.6 MB, 12.71 s                     |
| R-MMU-69620   | 10117344 | 200, 2.3 MB, 3.02 s   | 200, 2.2 MB, 14.26 s                     |
| R-BTA-109581  | 10481031 | 200, 1.8 MB, 2.38 s   | 200, 1.8 MB, 14.20 s                     |
| R-HSA-69604   | 69604    | 200, 49 KB, 0.01 s    | 200, 47 KB, 0.01 s                       |
| R-HSA-69562   | 69562    | 200, 51 KB, 0.03 s    | 200, 51 KB, 0.33 s                       |
| R-HSA-109862  | 109862   | 200, 40 KB, 0.07 s    | 200, 39 KB, 0.27 s                       |
| R-HSA-1248655 | 1248655  | 200, 55 KB, 0.13 s    | 200, 56 KB, 0.46 s                       |
| R-HSA-201425  | 201425   | 200, 48 KB, 0.11 s    | 200, 47 KB, 0.30 s                       |
| R-HSA-8963913 | 8963913  | 200, 12 KB, 0.04 s    | 200, 11 KB, 0.09 s                       |
| R-HSA-9915356 | 9915356  | 200, 48 KB, 0.14 s    | 200, 47 KB, 0.38 s                       |
| R-HSA-874079  | 874079   | 200, 22 KB, 0.07 s    | 200, 21 KB, 0.18 s                       |
| R-HSA-8952903 | 8952903  | 200, 23 KB, 0.09 s    | 200, 23 KB, 0.22 s                       |

## The release's published bulk files (T033)

Fetched from release 97's download directory on 24 Oct 2026, one file, kept outside the repository (the files hold people's names). Content was read only to identify the generator (research R9).

- **`biopax.zip`**: 173,989,993 bytes, sha256 `efedb0f6bd9fb788056d9f8ac1d5916b5efc25fbcd03606c618a051c46e7a4d7`. Pathway-Exchange's Level 3 output: `xml:base="http://www.reactome.org/biopax/97/{species dbId}#"`. 15 species files, uncompressed sizes in bytes:

  | File                          |        Size |
  | ----------------------------- | ----------: |
  | Bos_taurus.owl                | 185,059,283 |
  | Caenorhabditis_elegans.owl    | 116,833,342 |
  | Canis_familiaris.owl          | 170,234,598 |
  | Danio_rerio.owl               | 146,216,093 |
  | Dictyostelium_discoideum.owl  |  77,041,158 |
  | Drosophila_melanogaster.owl   | 126,768,250 |
  | Gallus_gallus.owl             | 161,076,320 |
  | Homo_sapiens.owl              | 333,253,965 |
  | Mus_musculus.owl              | 217,675,915 |
  | Plasmodium_falciparum.owl     |  30,538,668 |
  | Rattus_norvegicus.owl         | 189,439,804 |
  | Saccharomyces_cerevisiae.owl  |  46,661,058 |
  | Schizosaccharomyces_pombe.owl |  43,636,976 |
  | Sus_scrofa.owl                | 177,506,186 |
  | Xenopus_tropicalis.owl        | 128,011,857 |

- **`all_species.3.1.sbml.tgz`** (223,766,394 bytes): present, size from its header. Fetched when T041 needs it.
- **`homo_sapiens.3.1.sbml.tgz`**: 60,770,086 bytes, sha256 `a14af431e4e6a3e46a1f819e206fdb499461af019cea7d1324ee77e19033bf4f`, fetched 24 Oct 2026. 2,883 entries, one `{stId}.sbml` per human pathway and no reactions. Its files for the 19 sample pathways it holds equal this host's ContentService answers exactly (`sbml-exporter`'s `ci/compare.py`, 0 differences), so those answers are the release's own output.
