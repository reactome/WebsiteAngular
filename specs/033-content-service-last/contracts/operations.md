# Contract: the nine operations

Each answers as the Java service does at `7b9eceb`: the status, the headers node copies for every other route (type, the download guard, cache rules), and the body, byte for byte. The exceptions are the declared differences below. Paths take a trailing slash, as Spring's do. The answers' types live in `projects/contract/interactors.ts`, and the service writes through them (`nonEmptyJson<T>`).

## The PSICQUIC queries (Story 1)

| Method and path                                               | Body                                                | Answer                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /interactors/psicquic/molecule/{resource}/{acc}/details` | none                                                | `Interactors`: one entity, its interactors scored and ordered as Java's              |
| `GET /interactors/psicquic/molecule/{resource}/{acc}/summary` | none                                                | `Interactors`: one entity, its count, and no interactors                             |
| `POST /interactors/psicquic/molecules/{resource}/details`     | `text/plain`: accessions, split as Java splits them | `Interactors`: one entity per accession                                              |
| `POST /interactors/psicquic/molecules/{resource}/summary`     | as above                                            | `Interactors`: counts only (D26: counted before de-duplication, as Java counts them) |

**Contract change:** `Interactors.resource` widens from `'static'` to the resource's name as Java writes it. The site's reader (`interactor.service.ts`, `DrawnInteractors`) already treats it as a string. The recordings settle the exact form (constitution II).

**Errors:** an unknown resource, an unreachable server and a malformed body each answer the envelope Java's `GlobalExceptionHandler` writes for that exception (research R1). An inactive resource is asked anyway, as Java asks it. **A fetch that times out** (research R3) is handled as Java handles a failed fetch: left out of a POST **details** answer (still 200), and the "PSICQUIC resource is not responding" 500 for a POST **summary** and for either GET. The timeout itself is a declared difference, since Java has none.

## Custom interactors (Story 2)

| Method and path                          | Body                                                               | Answer                                                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /interactors/upload/tuple/content` | `text/plain` content; `name` as Java takes it                      | `TupleResult`'s JSON: the summary (with the token), and the warnings or errors                                                                                                                                     |
| `POST /interactors/upload/tuple/form`    | `multipart/form-data`: the file and `name`                         | as above; a type it does not accept is a 415                                                                                                                                                                       |
| `POST /interactors/upload/tuple/url`     | the address and `name`                                             | as above; too large a 431, unreadable or a refused address a 422                                                                                                                                                   |
| `POST /interactors/upload/psicquic/url`  | the service's address and `name`                                   | `CustomPsicquicResource`'s JSON: the summary, with its `PSI-` token                                                                                                                                                |
| `POST /interactors/token/{token}`        | `text/plain`: accessions, split on `,` `;` newline or tab, trimmed | `Interactors` with `resource` `custom`: stored pairs per accession, or a custom PSICQUIC service asked live; an unknown token a 404; a custom service's failure the 500 "Error querying your PSICQUIC Resource: …" |

The exact names of the parameters, and the shape of `TupleResult` and `CustomPsicquicResource` as written, are read from the controllers and recorded from beta when the story starts, then added to the contract module as types.

**Declared differences** (each added to the register, with its reason):

| Difference                                                                                                                    | Reason                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A third-party fetch that takes longer than the timeout is handled as a failed fetch                                           | Java waits without limit (135 s measured on an unreachable server)                                |
| The MI-score's ontology terms come from a snapshot (PSICQUIC queries and PSI-MITAB uploads)                                   | Java asks EBI's ontology service on every request, and scores every term as unknown when it fails |
| The registry is node's reading of the last five minutes                                                                       | Java asks the registry on every request, and fails when it cannot                                 |
| Fetching an address a user gave (an upload by address, or a custom PSICQUIC service, old token or new) checks its certificate | Java turns certificate checking off for its whole process before fetching an `https` address      |
| Fetching an address a user gave times out, is refused past the size limit while reading, and is fetched once                  | Java has no timeout, trusts the length the server declares, and fetches an upload's address twice |
| An address on a loopback, private or link-local network is refused, at every redirect and on the address connected to         | So the service cannot be made to fetch from inside the network it runs in                         |
| A custom PSICQUIC token already naming a different service is not overwritten (409)                                           | Java overwrites it, so anyone could repoint someone else's overlay; its tokens collide easily     |
| Uploads are rate-limited per client (nginx's `X-Real-IP`)                                                                     | Java has no limit, and every upload is stored                                                     |
