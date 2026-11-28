# Data model: The last ContentService operations move to node

See [research.md](research.md) for the reasons behind each choice.

## PSICQUIC resource

A third-party interaction service, as the PSICQUIC registry lists it. Node already reads the registry at start and every five minutes (`psicquic.ts`, `refreshPsicquicResources`), and answers `/interactors/psicquic/resources` from that reading.

| Field     | Meaning                                                            |
| --------- | ------------------------------------------------------------------ |
| `name`    | As the registry lists it, matched case-insensitively from the path |
| `restURL` | Where its MITAB is asked for                                       |
| `active`  | Whether the registry lists it as active                            |

**Rules:** queries answer from node's last reading of the registry, not a live lookup as Java makes (a declared difference, research R3). A name the reading does not list is the Java service's error for an unknown resource. If there has never been a successful reading, every query answers the Java service's "Couldn't query PSICQUIC Resources" 500.

## Cached answer

One operation's answer for one resource and one set of accessions (research R3).

| Field     | Meaning                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| key       | The operation (`details` or `summary`), the resource's name exactly as the request's path gives it, and the accessions in the order Java's `HashSet` iterates them (research R3), never sorted |
| body      | The exact bytes node wrote, gzip-compressed on disk                                                                                                                                            |
| `made`    | When it was made                                                                                                                                                                               |
| `expires` | `made` + the cache's lifetime (one day by default)                                                                                                                                             |
| size      | Its compressed size, counted against the cache's cap                                                                                                                                           |

**States:** _missing_ → _being made_ (one promise, shared by every request for the key) → _kept_ (served until `expires`, or until evicted as the least recently used past the cap) → _missing_. A failure goes from _being made_ straight back to _missing_, and is never kept.

## Custom interactor set

What one token names: either stored pairs or a custom PSICQUIC service.

| Kind            | Holds                                                                                                                                                                                                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stored pairs    | The upload's summary (name, file name, token, counts, warnings), and each pair: identifier and alias of A and B, confidence (1.0 for a two-column tuple; the file's own for the extended format; the computed score for PSI-MITAB), evidence; and, for each identifier, the order Java's stored set yields its pairs in |
| Custom PSICQUIC | The summary, and the service's name and address                                                                                                                                                                                                                                                                         |

**Rules:** node answers in Java's order, which depends on the stored set's iteration order for each identifier (research R5), so that order is recorded by the conversion and kept by node for new uploads as Java would build it. A custom PSICQUIC service is asked live at its own address (Java's form: the address followed by the encoded accession), under the same cache, timeout and limits as a registry resource, keyed by its address, and through the address checks of research R6.

## Token

| Field | Meaning                                                                                                                                                                                                                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| value | Either 32 lower-case hexadecimal digits, the MD5 of an upload's name followed by its content; or `PSI-` followed by a signed integer, the product of a custom PSICQUIC service's name's and address's Java string hashes. Anything else the existing store holds is listed by the conversion. |

**Rules:** checked against one of the two patterns before it names a file. The same name and content give the same upload token, and the stored set is returned without parsing again. A custom PSICQUIC token already naming a different service is never overwritten (a declared difference: Java overwrites it).

## Token store

One JSON file per token, `<token>.json`, in the folder the deployment mounts (`CUSTOM_INTERACTORS` inside the container, from the host's `CUSTOM_INTERACTORS_DIR`). Its shape is in [contracts/token-store.md](contracts/token-store.md).

**Lifecycle:**

1. **Converted once** from the Java service's `<token>.bin` files by the Java conversion program, on each server that holds a store. Its list of files it could not convert must be empty before any route moves.
2. **Checked:** on each server, every token is compared with the Java service's answer before that server's route moves (research R5).
3. **Written to** by node for each new upload, by writing a temporary file and renaming it, so a reader never sees half a file.
4. **Kept, and bounded as Java bounds it:** it survives restarts, redeploys and moves to another server with the folder. Once the folder passes 2 GB, files not read for a week are removed, least recently read first, as Java's checker does (research R5). At today's size that never happens.
