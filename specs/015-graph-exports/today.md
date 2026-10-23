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
