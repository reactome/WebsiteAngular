# The Java ContentService's interactor answers, and their inputs

Recorded by `tools/content-node/record-interactors-java.ts` (spec 033 T002) on 28 Nov 2026, between 19:50 and 19:55 UTC, from the deployed Java ContentService at `7b9eceb`. Each request was sent one at a time, with a pause between. The MITAB and the ontology pages were fetched in the same run, just before Java's answers, so they are the inputs Java had.

## What is here

- **`*.json`:** one per request: the request (method, path, type, body), the status, the two headers node must write the same (`content-type`, `content-disposition`), the body exactly as Java wrote it, when, and how long it took.
  - `post-<resource>-details` and `-summary`: the PSICQUIC queries for `P04637,Q14204,Q13409`, from MINT (which sends its own score) and BioGRID (whose score Java computes).
  - `get-<resource>-Q14204-details` and `-summary`: the same for one accession.
  - `error-unknown-resource` (500), `error-empty-body` (422), `error-unknown-accession` (200, `{"resource":"MINT"}`: no `entities` key), `error-unknown-token` (404).
  - `upload-content-tuple`, `-extended`, `-psimitab`, `upload-form-tuple`, `upload-url-tuple`: one upload of each format and form. The files are placeholders (`record-interactors-java.ts` holds them), and the extended one has a pair below 0.45 to show Java's warning.
  - `upload-psicquic-url`: a custom PSICQUIC service, served on loopback by the recording script with placeholder MITAB.
  - `token-<token>`: each of those tokens read for the same three accessions. The custom service's token (`PSI-…`) depends on its address, which included the script's port, so it differs from run to run.
- **`mitab/<resource>-<accession>.tsv.gz`:** what each resource served for each accession (MITAB 2.5, `interactor/<accession>`), gzip-compressed.
- **`ontology/MI_xxxx.term.json` and `.descendants.json`:** for each of the eight branches the MI-score reads, the term, and the first page of descendants EBI's ontology service gives when asked for `size=1000`. That is the page Java gets: OLS4 ignores `size` and serves 50 (spec 033 research R1).

## The names policy

MITAB's first-author column (the eighth) is replaced by `Placeholder et al. (2000)` before it is written. Neither the clustering nor the MI-score reads it; the detection method before it, which the score does read, is kept. No other column holds a person's name.

## What varies between runs

- **The third-party data:** MINT, BioGRID and the ontology change on their own schedule, so a run on another day will differ. Re-record everything together, never one part.
- **The `PSI-` token** (above).
- **The error envelopes' `url`:** Java writes back the address the request reached it at: the address the recording used.
- **`recordedAt` and `milliseconds`.**
