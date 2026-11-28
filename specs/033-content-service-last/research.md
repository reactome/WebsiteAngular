# Research: The last ContentService operations move to node

Spec: [spec.md](spec.md). The Java source cited is `reactome/content-service` at `7b9eceb` (the deployed commit, spec 010 R1) and `reactome/interactors-core` at the version that commit ships. "Measured" means measured on beta on 28 Nov 2026, with small, spaced requests.

## R1. The PSICQUIC pipeline, as the Java service runs it

The step-by-step reading, with file and line citations, is in [research-psicquic.md](research-psicquic.md). A throwaway prototype built only from that reading reproduced three live answers from beta's Java service byte for byte (127 of 127 and 59 of 59 interactors, tied scores' order included). What decides the port:

- **The deployed versions** are interactor-core 1.1.5 with micluster **1.7.14**, miscore **1.3.14** and psimitab **1.8.6**, read from the deployed jars' names. They are not the versions interactors-core's `main` names (micluster 1.9.0-SNAPSHOT, psimitab 1.10.1). The port follows the deployed ones. They are old because upgrading took time the team did not have, not by decision (the project's owner, 28 Nov 2026). Matching them first is what proves the port: they are the answers readers get today, and the only ones a port can be compared with live. Once node owns the operations there is no IntAct library left to upgrade. A later change to the scoring, such as a newer IntAct version's or asking for the whole ontology, is its own decision: a diff of the behaviour, new fixtures, and the new scores agreed with curators.
- **Per request, Java asks the registry for the resource by name** (case-insensitive; an inactive service is asked anyway), then fetches each accession's MITAB (tab 2.5) from the service, with no timeout at all.
- **Clustering:** details cluster on the resource client's own list of databases; summaries cluster on `uniprotkb,chebi`.
- **Each client reads its own score column:** `intact-miscore`, then `miscore`; `NBC` for Reactome FIs; `intact-miscore` only for ZINC. Where none is given, the MI-score is computed.
- **The MI-score as coded is not the paper's formula:**
  - Terms with no known parent count under a null key: they add 0.05 to one part and nothing to the other.
  - The arithmetic is single precision, and the score goes through `Float.toString` and back to a double.
  - A term under two parents takes whichever parent comes last in hash-map order.
- **The MI-score depends on EBI's ontology service, and on an accident there.** miscore asks the old address, which redirects to OLS4, then asks for each branch's descendants with `size=1000`. OLS4 ignores `size` and returns the first 50 terms: 50 of 73 for MI:0013, reproduced on 28 Nov 2026. The first-page snapshot matched Java 59 of 59; the full ontology matched 3 of 59. **So node's snapshot is the first page as OLS4 serves it.** When OLS fails, Java silently scores every term as unknown. Node's snapshot will not, and that goes in the register.
- **Filter, rounding and order:** `>= 0.45` before rounding to three decimals; duplicates removed by a sorted set that compares the score only; then a stable sort and a reverse. Jackson writes non-empty fields only, so an answer with no interactions has no `entities` key.
- **Java's hash-map order decides four things:** entity order and id numbering, the order of tied scores, the alias and evidence chosen, and the order floats are summed in. Node has `java-hashmap.ts` and `java-double.ts` already. The port adds JDK 11's `Float.toString` and a small model of `ConcurrentHashMap`. **For a POST of 10 or more accessions** (two threads), the order of accessions whose hashes collide depends on which fetch finishes first, so Java's own answers differ there. The parity method's Java-against-Java pair (R4) is what tells that apart from a port's mistake.
- **Errors**, each a 500 in the envelope: an unknown resource (`"<resource> not found"`); a registry failure (`"Couldn't query PSICQUIC Resources"`); an unreachable server or an HTTP error from it (`"PSICQUIC resource is not responding"`); unreadable MITAB (`"Couldn't parse PSICQUIC result"`). **A POST for details drops an accession whose fetch failed and still answers 200.** Node writes the same answer, and does not cache it (R3: partial).
- **The summary counts clusters before de-duplication,** with no swap and no rounding, as D26 found.

**Unverified:** the character set Java reads MITAB in, and how each service answers an empty accession. Both are checked when the parser is ported.

## R2. Licences, and how the port is written

**Found** (details in [research-psicquic.md](research-psicquic.md)):

- **micluster, miscore and the PSICQUIC registry client** (EMBL-EBI) declare no licence: no `LICENSE` file, nothing in their POMs, and none reported by GitHub.
- **interactors-core 1.1.5 and content-service** (Reactome's own) declare none either. reactome-parent took Apache-2.0 only in July 2025, after the deployed version.
- **psimitab:** its POM says Apache-2.0, and its repository's file says CC BY 4.0.
- **The paper** (Villaveces et al., _Database_ 2015) is CC BY 4.0.

**Decision:** a **clean reimplementation**, not a translation of the code. The port is written from the published method, from the behaviour recorded in research-psicquic.md, and from recorded Java answers kept as fixtures, as `java-double.ts` was. Every quirk that decides an answer (the null key, single-precision arithmetic, hash-map order, the first-page ontology) is implemented on purpose, named in a comment that says what breaks without it, and pinned by a fixture. No code is copied from the EMBL-EBI libraries.

**For the owner:** whether Reactome's own unlicensed code (content-service, interactors-core) may be relicensed or copied under Apache-2.0 is Reactome's decision. The reimplementation does not depend on it.

## R3. The cache, the timeout and the limits

**Decision:**

- **Where:** on disk, in a folder the deployment mounts read-write into the content service (`PSICQUIC_CACHE` inside the container, from the host's `PSICQUIC_CACHE_DIR`; unset, nothing is cached rather than anything failing). One file per cached answer, gzip-compressed, named by the SHA-256 of its key. An index of keys, sizes and expiry times is kept in memory and rebuilt from the folder at start.
- **Key:** the operation (details or summary), the resource's name **exactly as the request's path gives it** (Java writes it back as typed, so a `MINT` answer is never served to a `mint` request), and the accessions **in the order Java iterates them**: split and trimmed as Java splits them, into the `HashSet` Java builds, read in that set's iteration order (which depends on the body's order within a bucket, and so on the request). Two bodies Java would answer differently never share an entry; two that give the same iteration sequence do. The answer kept is the bytes node wrote, so a hit is byte-identical to the miss that filled it.
- **Lifetime:** one day from when the answer was made (`PSICQUIC_CACHE_SECONDS`, default 86,400). An expired answer is never served stale.
- **What is kept:** only a 200 whose every accession was answered. A failure of any kind (an error status, a timeout, an unknown resource, a details answer from which a failed accession was left out) is written to the reader and not kept, so the next request asks again.
- **In flight:** requests for the same key while the first is being made wait for it and share its answer, and its failure. There is one entry per key in a map of promises, removed when the promise settles.
- **Size:** at most `PSICQUIC_CACHE_BYTES` on disk (default 2 GiB). Past it, the least recently used answers are removed first. An answer larger than a tenth of the cap is served and not kept.
- **Timeout:** each fetch from a third-party server is given `PSICQUIC_TIMEOUT_MS` (default 30,000), and one that runs out is treated as Java treats a failed fetch (R1). For POST **details**, the accession is left out and the answer is still 200. For POST **summary** (the panel's counts, which Java reads one accession at a time through `countInteraction`) and for either GET, it is the 500 "PSICQUIC resource is not responding". Either way nothing is kept. Java has no timeout at all (D26: 135 s on an unreachable server), so this is a declared difference.
- **The whole request:** it has no timeout of its own, because a large diagram is many fetches (Java took 102 s for two accessions from MINT, R1). nginx's `proxy_read_timeout` of 300 s for content-node bounds it in practice: a details POST of more than about 40 accessions to a dead server (ceil(N / 4) × 30 s) is cut off there with nginx's 504, as Java's would be. The per-server queue is bounded too (`PSICQUIC_QUEUE`, default 200 waiting fetches a server); past it, a fetch fails at once as a timed-out one does.
- **Per-server concurrency:** at most `PSICQUIC_PER_SERVER` requests at once to any one third-party server (default 4), queued in arrival order beyond that. Java's per-request thread pool is up to 20 per request, with nothing shared between requests, so a burst of visitors multiplies it.
- **The registry:** node answers from its reading of the registry, re-read every five minutes (`psicquic.ts`). Java asks the registry on every request (R1) and fails with "Couldn't query PSICQUIC Resources" when it cannot. Node gives that error only when it has never read the list. A declared difference.

**Rationale:** MINT's answer for a small pathway (1.9 KB of identifiers) was 472 KB (measured). Thirteen resources over the few hundred pathways a day's visitors open is gigabytes, which is far beyond what the service's memory should hold (spec 032 is measuring the release server's memory). Answers compress about ten to one. Disk also keeps the cache through a restart, which a release's switch makes.

**Alternatives considered:** in memory (too large, and lost on every restart); nginx's response cache keyed on the request body (it works only while the body fits nginx's buffer, it would key on the body's exact bytes rather than on the accessions, and it was set aside on 28 Nov 2026 when the endpoints were decided to move to node); the browser (it already remembers counts within one visit; this is about every other visitor).

## R4. Parity: how it is measured, and where the fallback cuts in

**Decision:**

- **Paired requests at the same moment.** The answers come from third-party servers whose data can change at any time, so a recording cannot be replayed. Each comparison sends the same request to the Java service and to node together. A difference counts only if a second, simultaneous pair from the Java service alone does not show the same difference (D26's reference-against-reference pair).
- **The sample:** 20 pathways of different sizes, from spec 015's event sample, crossed with every live resource the registry lists on the day. Both POST operations for each pair, the two GET operations for 3 accessions per pathway, and the error cases: an unknown resource, an inactive one, an empty body, an accession nothing has. Small and spaced: one pair at a time, with a pause between, run over a day if need be.
- **The comparison:** byte for byte, except for the declared differences (the timeout and the ontology snapshot, contracts/operations.md). Scores are compared as written, which is to three decimal places (R1).
- **The fallback:** if one part cannot be matched, for one resource or for all of them, node calls the Java logic for that part alone, through the library service (`deploy/java-library`). It hands over what node has already fetched and parsed, and takes back what node writes. R1 names the candidate parts. The fallback is decided per part, recorded in this file, and routed only once parity is shown through it. The library service gains only that part, at the same pinned versions (micluster 1.7.14, miscore 1.3.14, psimitab 1.8.6, recorded in `deploy/java/PINS.md`).
- **The candidates,** most likely first: the score function alone, if a single-precision edge (`Float.toString`, a one-ulp difference in `Math.log`) shows; clustering, for a resource whose MITAB is awkward (MITAB lines in, clusters out). Both are rare and untested; the parity run decides.
- **The ontology:** parity is run against a snapshot taken the same day as the comparison, so that a change at OLS is not counted against the port.

## R5. The token store

**What it is (read in the Java source):**

- One file per token, `<token>.bin`, in a folder the Java service is configured with (`TupleManager`, `utils/TupleManager.java`). Each is written with Kryo's `writeClassAndObject`, with registration not required, references on, and the standard instantiator strategy. So each file names its Java classes inside it, and only the same classes at compatible versions can read it.
- A file holds either a `TupleResult` (an upload's parsed pairs, in a `CustomResource`, with its `Summary`) or a `CustomPsicquicResource` (the name and address of a custom PSICQUIC service, with its `Summary`).
- **Two forms of token, neither random.** An upload's is the MD5 of its name followed by its content, as bytes in the service's default charset (`CustomInteractorManager.getUserDataContainer`; the deployed default charset is unverified, so T024 tests a non-ASCII upload). Uploading the same name and content again returns the stored copy (`readToken` first), with the same token. A custom PSICQUIC service's is `PSI-` followed by the product of the name's and the address's Java string hashes, after a `/` is added to an address without one (`ParserUtils.processCustomPsicquic`), so it is a signed integer (`PSI--123456`) and collisions are easy: an empty name always gives `PSI-0`. Java's `saveToken` overwrites an existing file, so a new registration can replace someone else's overlay.
- **Reading:** `POST /interactors/token/{token}` splits its body on `,`, `;`, a newline or a tab, trims each, and keeps a `HashSet`. A stored upload answers each accession from `CustomResource.get`: a radix tree of `Set<TreeInteraction>` (hash `31 × hA × hB`), copied into a `HashSet<CustomInteraction>` (hash `hA × hB`, equal whichever way round A and B are), then converted, sorted by score and reversed. Scores are not all 1.0: the extended format carries its own, and PSI-MITAB uploads are scored as R1 scores. Which duplicate survives, and the order of equal scores within a bucket, depend on the stored set's iteration order, so **the conversion must record, for each identifier, the order Java's stored set yields** (contracts/token-store.md). A custom PSICQUIC token is asked live, but not through R1's registry path: Java fetches the service's address followed by the encoded accession, with no `interactor/`, one accession after another, through the generic client, and any failure is the 500 "Error querying your PSICQUIC Resource: " followed by the exception's message (CS `GlobalExceptionHandler`).
- **An unknown token:** `TokenNotFoundException`, the envelope's 404.

**Decision:**

- **A one-time conversion, by Java.** A small Java program in the library service's image reads every `.bin` file and writes one JSON file per token (contracts/token-store.md). Kryo needs the exact classes the files name: interactor-core 1.1.5's model classes (`TupleResult`, `Summary`, `CustomResource`, `TreeInteraction`, `CustomInteraction`, `CustomPsicquicResource`), concurrent-trees (the radix tree and its `AtomicReferenceArrayListAdapter`), Objenesis (the instantiator strategy) and Kryo 5.3.0. The program compiles only those model classes from interactor-core at `7513f42`, with the rest from Maven Central, so it does not need the IntAct libraries. It is run once on each server that holds a store, by whoever runs that server, and lists every file it could not convert. The conversion stops before any route moves if one fails (spec FR-009). The program is kept, not run again, until the Java service is retired.
- **Node's format:** one `<token>.json` per token in the store's folder, with no index. A read is a file read, and the token is checked against `^[0-9a-f]{32}$` or `^PSI--?[0-9]+$` before it is used in a path; the conversion reports any file that matches neither.
- **The check:** on **each** server that holds a store, every converted token is asked of both services, over the identifiers its own pairs name plus three that it does not, and the answers are compared byte for byte, before that server's route moves (spec SC-004).
- **New tokens:** made as Java makes them, in both forms. The same upload gives the same token on both services, and a re-upload returns the stored set. Neither form is unguessable, which is no worse than today, and it is what keeps old links and new uploads identical. Making tokens random is a separate decision. **One declared difference:** registering a custom PSICQUIC service whose token already names a different service is refused (409 in the envelope), where Java overwrites the other overlay.
- **Bounding the store:** Java's checker (`LruFolderContentChecker`, from `reactome/server-java-utils`, configured in content-service's `WebConfig`) removes files not read for a week, least recently read first, once the folder passes 2 GB (a 2.5 GB cap less a 500 MB margin). Node applies the same rule with the same figures, so uploads cannot fill the disk. It is not a difference.
- **Where the store lives:** the folder is mounted into the content service from the deployment's settings (`.env`), like the diagram files. Its address is never in this repository.

**Alternatives considered:** reading Kryo from node (it would mean reproducing Kryo's wire format and Java class layouts, for a one-off need); keeping the Java store and asking the library service for every token read (it keeps Java on the request path for good, which spec FR-005's fallback allows only where parity cannot be reached).

## R6. Uploads

**What the Java service does (read in the source):**

- **`/upload/tuple/content`** reads the body as text; **`/tuple/form`** takes a multipart file, checks its type with a content sniffer and refuses what it does not accept (415); **`/tuple/url`** fetches an address. All three then go through `getUserDataContainer` (the MD5 token, then the stored copy or a parse).
- **The parsers** (interactor-core's `tuple` package, about 1,700 lines): `ParserFactory` decides the format from the content, as a two-column tuple (`TupleParser`), an extended many-column one (`ExtendedParser`) or PSI-MITAB (`PsimiTabParser`, through psimitab). Their warnings and errors are `MessageFormat` patterns (`Response.java`), for example "Line {0} does not have {1} column(s). {2} Column(s) found." and "Missing header. Using a default one.". `MessageFormat` writes numbers with grouping ("Line 1,234"), which the port must copy.
- **`/upload/psicquic/url`** only parses the address: `openConnection()` never connects, so nothing checks that it answers. Then it registers it (`ParserUtils.processCustomPsicquic`).
- **Fetching an address, in Java:** it turns certificate checking off for the whole Java process before fetching an `https` address (`doTrustToCertificates`), and it sets no timeout. It rewrites the address with its file name encoded, and fetches it twice, once to read and once for the type check. The size check uses the length the server declares, after the connection is open: too large is a **431** (`RequestEntityTooLargeException`), unreadable a **422**, an unaccepted type a **415**.

**Decision:**

- **Port the three parsers** and their messages, word for word, number grouping included. They are compared on a corpus of files: the site's own fixtures, every refusal and warning in `Response.java`, and the formats each parser accepts, uploaded to both services.
- **Fetching an address, in node** (an upload by address, and every read of a custom PSICQUIC token, old or new): certificates checked; a timeout (`UPLOAD_FETCH_TIMEOUT_MS`, default 15,000, for uploads; `PSICQUIC_TIMEOUT_MS` for a custom service); the size limit enforced while reading, not trusted from the header; only `http` and `https`; and no loopback, private or link-local address, checked at every redirect, and on the address the connection is actually made to, so that a name cannot resolve to a public address for the check and a private one for the fetch. Node fetches once, not twice. Each is a **declared difference** from Java. They are security fixes, and they are listed in the register with that reason. A refused address is the 422 Java gives an unreadable one.
- **Limits:** 50 MB for a form upload, as Java's multipart resolver allows (`setMaxUploadSize(52428800)`), and the same for content (Java sets none there; node's default body limit is 10 MB, so the upload routes set 50 MB, `UPLOAD_MAX_BYTES`). A per-client rate for uploads (default 10 a minute), where the client is nginx's `X-Real-IP`, never `X-Forwarded-For`, which a request can set. An upload is rare and a burst is a sign of misuse.

## R7. Routing, and switching the old service off

**What stands today (read in the configuration):**

- Every deployment's `/ContentService/` falls through to Tomcat (`routes-core.conf`, the `location /ContentService/` catch-all), and the locations above it send node's operations to node.
- **Release and production still send four of node's operations to Tomcat:** event SBML, SBGN and BioPAX (spec 015 T068), and the event PDF (spec 006 T100). `routes.spec.ts` lists them in `NOT_YET_ROUTED`. They wait for those servers to run the library service and pdf-export (spec 032).

**Decision:**

- **The nine operations** each get their own location, sent to node, in `routes-core.conf` (so beta, the release server and production alike) and in `proxy.conf.js`. `routes.spec.ts` then finds them in node's list like any other route.
- **The last step:** once every operation is node's on every deployment (the nine, T068, T100), the catch-all `/ContentService/` is sent to node too. Node answers what Java answers for a path it does not know (its 404 envelope). A new test fails if any location sends a `/ContentService` path to the old service.
- **Switching off:** after one release with nothing routed to it, the ContentService webapp is removed from the shared application server (spec 010 US4 for the server as a whole). `reactome/content-service` is archived, with a README naming each operation's home: node, the library service for any fallback part, or retired.
- **Spec 006 T101 and T102,** spec 010's operation homes and Story 2, and the register of declared differences are updated by the pull requests that move each family.
