# Data model: The last ContentService operations move to node

See [research.md](research.md) for the reasons behind each choice.

## PSICQUIC resource

A third-party interaction service, as the PSICQUIC registry lists it. Node already reads the registry at start and every five minutes (`psicquic.ts`, `refreshPsicquicResources`), and answers `/interactors/psicquic/resources` from that reading.

| Field     | Meaning                                                            |
| --------- | ------------------------------------------------------------------ |
| `name`    | As the registry lists it, matched case-insensitively from the path |
| `restURL` | Where its MITAB is asked for                                       |
| `active`  | Whether the registry lists it as active                            |

**Rules:** a name the last reading does not list is the Java service's error for an unknown resource. If there has never been a successful reading, every query answers the service's error rather than guessing an address.

## Cached answer

One operation's answer for one resource and one set of accessions (research R3).

| Field     | Meaning                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| key       | The operation (`details` or `summary`), the resource's registry name, and the accessions as Java reads them, sorted |
| body      | The exact bytes node wrote, gzip-compressed on disk                                                                 |
| `made`    | When it was made                                                                                                    |
| `expires` | `made` + the cache's lifetime (one day by default)                                                                  |
| size      | Its compressed size, counted against the cache's cap                                                                |

**States:** _missing_ → _being made_ (one promise, shared by every request for the key) → _kept_ (served until `expires`, or until evicted as the least recently used past the cap) → _missing_. A failure goes from _being made_ straight back to _missing_, and is never kept.

## Custom interactor set

What one token names: either stored pairs or a custom PSICQUIC service.

| Kind            | Holds                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stored pairs    | The upload's summary (name, file name, token, counts, warnings), and each pair: identifier and alias of A and B, confidence (1.0 for a tuple upload), evidence |
| Custom PSICQUIC | The summary, and the service's name and address                                                                                                                |

**Rules:** the pairs are kept as the parser produced them, in its order. Node applies Java's `HashSet` order when it answers (research R5), not when it stores. A custom PSICQUIC service is asked live, under the same cache, timeout and limits as a registry resource, keyed by its address.

## Token

| Field | Meaning                                                                                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| value | 32 lower-case hexadecimal digits: the MD5 of the upload's name followed by its content (as Java). Any other form the existing store holds is listed by the conversion. |

**Rules:** checked against its pattern before it names a file. It never expires. The same name and content give the same token, and the stored set is returned without parsing again.

## Token store

One JSON file per token, `<token>.json`, in the folder the deployment mounts (`CUSTOM_INTERACTORS_DIR`). Its shape is in [contracts/token-store.md](contracts/token-store.md).

**Lifecycle:**

1. **Converted once** from the Java service's `<token>.bin` files by the Java conversion program, on each server that holds a store. Its list of files it could not convert must be empty before any route moves.
2. **Checked:** every token is compared with the Java service's answer (research R5).
3. **Written to** by node for each new upload, by writing a temporary file and renaming it, so a reader never sees half a file.
4. **Kept:** it survives restarts, redeploys and moves to another server with the folder. Nothing is ever removed.
