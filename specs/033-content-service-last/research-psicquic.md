# Spec 033 research R1–R2: PSICQUIC queries, as deployed

Read-only research for FR-005, 28 Nov 2026. "Verified" means checked against a live
answer from beta's Java service. Anything I could not check is marked **UNVERIFIED**.

## 0. Headline findings

1. **The deployed versions are not the ones on interactors-core's `main`.** The
   deployed ContentService ships `interactor-core-1.1.5`,
   **`micluster-1.7.14`**, **`miscore-1.3.14`**, **`psimitab-1.8.6`**,
   `psicquic-registry-client-1.4.0`, `psicquic-simple-client-1.4.0` and
   `jackson-databind-2.13.3` (read from the deployed jars' names). The 1.9.0-SNAPSHOT and
   1.10.1 versions are pinned by interactors-core `main` (1.1.6-SNAPSHOT), which
   is not deployed. Interactors-core 1.1.5 takes its versions from reactome-parent
   1.0.5. At `d93ad5a` (PINS.md), `parents/reactome-parent/pom.xml` sets
   `micluster.version` 1.7.14 and `psimitab.version` 1.8.6. The sources match
   exactly:
   - interactors-core `7513f42` ("Release 1.1.5", PINS.md)
   - MICommunity/micluster tag `micluster-1.7.14` (`556205f`, 11 Feb 2021)
   - MICommunity/miscore tag `miscore-1.3.14` (`ae99268`, 16 Oct 2017)
   - MICommunity/psimi tag `psimi-master-1.8.6` (`9baca51c`, 22 Aug 2018;
     `psimitab-parser/` is version 1.8.6)
   - PSICQUIC/psicquic-registry-client tag `psicquic-registry-client-1.4.0`

   Every version has a tag, so I am sure of the sources (high confidence). I did
   not rebuild the jars to compare their bytes.

2. **I reproduced three live Java answers byte for byte** with a throwaway Python
   prototype of the reading below (`proto/`):
   - MINT POST, 2 accessions (127 interactors, including the order of tied scores)
   - BioGrid GET for Q14204 (59 interactors, all with _computed_ MI-scores)
   - Reactome GET for Q14204 (empty answer)
3. **The MI-score depends on OLS today, and on an accident.** miscore asks
   `https://www.ebi.ac.uk/ols/api/ontologies/mi/terms?obo_id=<term>`. That answers
   with a 301 to `/ols4/api/…`, which `HttpURLConnection` follows (https→https).
   It then asks for `<descendants href>?size=1000`. **OLS4 ignores `size` and
   returns only the first page of 50 terms, sorted by id.** So Java sees:

   | Branch                                      | Terms Java sees | Terms in the branch |
   | ------------------------------------------- | --------------- | ------------------- |
   | MI:0013                                     | 50              | 73                  |
   | MI:0401                                     | 50              | 183                 |
   | MI:0407                                     | 50              | 70                  |
   | MI:0090, MI:0254, MI:0255, MI:0428, MI:0208 | all             | all                 |

   For example, `MI:1313` (bioid) is scored as "unknown" instead of biochemical.
   **Verified:** BioGrid/Q14204 matches Java 59/59 with the first-page snapshot,
   and only 3/59 with the full ontology. The snapshot FR-005 asks for must
   therefore hold **the first page as OLS4 serves it**, not the true descendants.
   This is a declared fidelity-to-a-bug.

   When OLS fails, Java silently uses empty maps (`MIOntology.java:98-103,
127-131`), so every term becomes "unknown" or an exact parent. Java's scores
   therefore change whenever OLS is down, and node's snapshot will not.

4. **The order of tied scores needs a Java HashMap simulation.** The order is
   neither arrival nor alphabetical; it is the reverse of Java's `HashMap<String>`
   iteration over the partner accessions. A naive insertion order breaks MINT/P53
   at row 4. Node already has `tools/content-node/java-hashmap.ts` (JDK 11
   HashMap with tree bins) and `java-double.ts` (JDK 11 `Double.toString`).
   **`Float.toString` (JDK 11) is missing and is needed** (§R1.8).
5. **Speed, measured:**
   - MINT POST for 2 accessions took **102 s** on beta, yet MINT itself answered
     each accession in under 1 s when asked directly.
   - BioGrid GET took 9.4 s; Reactome GET took 21 s.
   - The time goes somewhere in Java: probably the 16 OLS calls and the registry
     lookups, done again per request (and per accession in the summary path).
     **UNVERIFIED** where exactly.

## R1. The pipeline, step by step

Citations are `file:line`. CS = content-service at `7b9eceb`, under
`src/main/java/org/reactome/server/service/`. IC = interactors-core at `7513f42`,
under `src/main/java/org/reactome/server/interactors/`. MC = micluster-1.7.14,
`micluster/src/main/java/uk/ac/ebi/enfin/mi/cluster/`. MS = miscore-1.3.14,
`miscore/src/main/`. PT = psimi-master-1.8.6,
`psimitab-parser/src/main/java/psidev/psi/mi/tab/`.

### 1. The four operations (CS `controller/interactors/PsicquicInteractionsController.java`)

| Operation        | Route                                                               | Calls                                                                                       | Accessions, threads, cache                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| details, one acc | `GET /interactors/psicquic/molecule/{resource}/{acc}/details` (:71) | `getPsicquicProteinsDetails(singletonList(acc), resource)`, the **no-cache overload** (:76) | —                                                                                                                                                                                                          |
| details, many    | `POST /molecules/{resource}/details`, `consumes text/plain` (:84)   | `getPsicquicProteinsDetails(accs, resource, threads, true)` (:95)                           | body split on `",\|;\|\n\|\t"` (Java `String.split`: trailing empties dropped, inner empties kept as `""`), each trimmed into a **`HashSet<String>`** (:91-94); `threads = accs.size() < 10 ? 1 : 2` (:95) |
| summary, one acc | `GET /molecule/{resource}/{acc}/summary` (:103)                     | `getPsicquicProteinsSummary` (:108)                                                         | —                                                                                                                                                                                                          |
| summary, many    | `POST /molecules/{resource}/summary` (:116)                         | `getPsicquicProteinsSummary(accs, resource)` (:127)                                         | same split and HashSet (:123-126); **sequential**, no threads                                                                                                                                              |

`/resources` is already ported. It reads the cached registry list, refreshed every
5 minutes by `utils/PsicquicResourceCachingScheduler.java:40-58`. The four
operations above do **not** use that list; each one asks the registry itself (§2).

### 2. Registry lookup, by name

- IC `psicquic/impl/InteractionClusterImpl.java:185-190` (GET and POST summary,
  **once per accession**) and `:304-313` (POST details, once per request).
- Both call `DefaultPsicquicRegistryClient.getService(resource)`. In
  psicquic-registry-client, `DefaultPsicquicRegistryClient.java`, that is
  `http://www.ebi.ac.uk/Tools/webservices/psicquic/registry/registry?action=STATUS&format=xml&name=<resource>`.
  The name is appended raw, not URL-encoded. The client reads it with JAXB
  `unmarshal(new URL(url))`, which sets no timeout.
- The registry matches the name **case-insensitively** (`name=mint` returns
  MINT). An unknown name gives `<registry/>`, so Java throws
  `PsicquicResourceNotFoundException(resource + " not found")`.
- `STATUS` lists **inactive services too**, and Java does not check `active`: it
  queries an inactive service's `restUrl` anyway.
- Any failure throws `PsicquicRegistryClientException("Problem reading
registry")`.

### 3. The per-accession MITAB request

- URL: `service.getRestUrl() + "interactor/" + URLEncoder.encode(acc, "UTF-8")`
  (`InteractionClusterImpl.java:193`, `:265`). This is form encoding: a space
  becomes `+` and `*~'()!` are encoded differently from `encodeURIComponent`.
- No `format` parameter, so the server's default applies: **tab25**. Verified:
  MINT and BioGrid return 15 columns, and MINT's `X-PSICQUIC-Supports-Formats`
  lists tab25 first.
- No `firstResult` or `maxResults`. MINT returned all 626 lines for P04637
  (`X-PSICQUIC-Count: 626`). Whether some servers cap their default page size is
  **UNVERIFIED**; node sends the same URL, so it gets the same answer.
- Read by PT `PsimiTabReader.java:193-194`: `url.openStream()` and
  `InputStreamReader(is)` in the **platform default charset**.
  - The deployed service's default charset is **UNVERIFIED**: no `file.encoding`
    is set for it. If its locale is POSIX, non-ASCII bytes become U+FFFD. Every
    answer measured was ASCII. T024 tests a non-ASCII case.
- **Timeouts: none.** `openStream` has none, and the deployed service sets no
  `sun.net.client.default{Connect,Read}Timeout`. The POST path also waits `awaitTermination(Long.MAX_VALUE)` (:276).

### 4. Parsing (psimitab 1.8.6)

- `PsimiTabReader.read(BufferedReader)` (PT `PsimiTabReader.java:20-52`):
  - Each line is split on tab by `MitabParserUtils.quoteAwareSplit` (PT
    `model/builder/MitabParserUtils.java:71-180`).
  - **Empty fields are dropped**, not kept (:143, :174), so `\t\t` collapses.
    MITAB writes `-` for an empty field.
  - A line whose first field starts with `#` is skipped.
  - **A blank line throws `IllegalArgumentException("Empty String passed to create
Field")`** (:77). That throw happens outside the try. Other line errors
    become `PsimiTabException` (`handleError`, :264).
  - A line shorter than the full MITAB length is padded with nulls (`extendFormat`).
- Column indices (0-based, tab25):

  | Index | Column            | Index | Column            |
  | ----- | ----------------- | ----- | ----------------- |
  | 0, 1  | id A, id B        | 8     | publications      |
  | 2, 3  | alt ids A, B      | 9, 10 | taxids            |
  | 4, 5  | aliases A, B      | 11    | interaction types |
  | 6     | detection methods | 12    | source db         |
  | 7     | authors           | 13    | interaction ids   |
  |       |                   | 14    | confidences       |

- Cross references, aliases and confidences (:372-500): split on `|`, then
  `quoteAwareSplit(field, ':()', removeQuotes=true)`, with bracket depth tracking
  for `(`. That gives 2 or 3 parts: `db:id(text)`. Database and identifier are
  trimmed; empty text becomes null.
  - One part that is `-` is skipped. In confidences, one other part gives type
    `"not-defined"`. Cross references also map `spoke`/`matrix`/`bipartite`.
  - Quirk: `object` is not reset inside the loop, so a `-` after a real entry adds
    that entry again.
  - Confidence `-:-` (Reactome's) parses as type `-`, value `-`.
- `ConfidenceImpl.equals` compares type and value (used for de-duplication in
  merges).

### 5. Clustering (micluster 1.7.14)

The cluster object differs by path:

| Path                   | Construction                                                                                                                                                            | Clustering key ("mapping id db names")    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| details (GET and POST) | `new InteractionClusterScore()` (POST with the cache object), then `setMappingIdDbNames(client.getDatabaseNames())` (`InteractionClusterImpl.java:234-240`, `:283-289`) | the **client's** list                     |
| summary                | `getInteractionClusterScore(resource, acc, null)` (`:126`); `setMappingIdDbNames(null)` only logs a warning (MC `AbstractInteractionCluster.java:538`)                  | the default **`"uniprotkb,chebi"`** (:28) |

**Different keys, so summary counts can differ from details counts.**

**Binary2Encore** (MC `Binary2Encore.java`, `getEncoreInteractionForScoring` :195):

- **Publication.** The last pubmed in col 8, else doi, else imex, else other.
  Added to `distinctPublications` (a HashSet) if non-empty.
- **Experiment.** The _first_ interaction id in col 13 (:93) maps to its db, or to
  the source db's _text_ when the id has no db. Stored in `experimentToDatabase`:
  `HashMap<String, List<String>>`, whose keys become the evidences.
- **Interactor accessions** (`getInteractorAccs`, :370). It walks the ids, then
  alt ids, then aliases, calling `updateAccMap` (:323) for each.
  - An entry whose db is in the db list (case-insensitive) is kept as
    `accs[db]=id`, first one per db. uniprotkb has extra rules: a uniprot
    accession drops its `.version`.
  - Everything else, aliases included, goes to `otherAccs[db]`, a list without
    duplicates.
  - If `accs` is empty, the **first key of `otherAccs` in HashMap order** moves
    into `accs`.
- **Confidences.** Copied, de-duplicated.
- **Method/type pairs.** Paired by these rules:

  | Types        | Methods   | Pairs                     |
  | ------------ | --------- | ------------------------- |
  | 1            | >1        | each method with the type |
  | >1           | 1         | the method with each type |
  | n            | n (equal) | zipped                    |
  | ≥1           | none      | `(null, type)`            |
  | none         | ≥1        | `(method, null)`          |
  | other counts |           | both kinds                |

  The pairs live in `HashMap<MethodTypePair, List<pubmed>>`.
  `MethodTypePair.hashCode = 31*h(method)+h(type)` (null hashes to 0);
  `equals` is case-insensitive. The list can hold `""` pubmeds.

**setMappings** (MC `AbstractInteractionCluster.java:271-...`):

- The key for each side is `getInteractorFromAccs` (:491): the first db of the
  list present in `accs`, else `accs.values().iterator().next()` (HashMap order).
  A side with no accessions becomes `"-"`.
- Each key resolves through `interactorMapping`, else `synonymMapping`, to a list
  of cluster ids.
  - **Same A and B, case-insensitive:** use the first of A's clusters whose A and B
    accessions overlap.
  - **Otherwise:** use the first id in A's list that is also in B's.
- Synonyms: every other accession of A and B points to its key, first one wins.
- **Merge** (MC `InteractionCluster.java:210`):
  - If no accession of the existing cluster's A side appears in the new line's
    A side, swap A and B.
  - Add accessions, keeping the first value per db.
  - Merge other accessions, publications and `experimentToDatabase` (lists
    without duplicates).
  - `processMethodAndType` (:166): union of pubmeds per pair.
  - Confidences without duplicates; `distinctPublications` unioned.
- **New cluster:** `interactionMappingId++` (:387), so ids run 1..n in order of
  first appearance. `interactionMapping` is a `HashMap<Integer>`; with small
  ints and capacity > n it **iterates in ascending id order**.

### 6. The MI-score (miscore 1.3.14), exactly as coded

Run once per cluster, after clustering (MC `score/InteractionClusterScore.java:179-272`).

**The ontology.**

- Method parents: `MI:0013, MI:0090, MI:0254, MI:0255, MI:0401, MI:0428`.
- Type parents: `MI:0208, MI:0407`.
- Each parent is fetched with `MIOntology.getMapOfTerms` (MS `ols/MIOntology.java:74, 86`):
  1. `GET https://www.ebi.ac.uk/ols/api/ontologies/mi/terms?obo_id=<t>`
  2. `GET <_links.descendants.href>?size=1000`. The href is
     `http://www.ebi.ac.uk/ols4/...` and answers 200 over http.
  3. Keep `obo_id → label` from `_embedded.terms`, which is **the first page of 50**.
- The type map also gets `MI:0403`, `MI:0914` and `MI:0915` with no children (:202-205).
- **What is cached:** nothing across requests.
  - GET details: one fetch per request.
  - POST details: one fetch per request, through `InteractionClusterScoreCache`
    (MC `score/InteractionClusterScoreCache.java:19-65`; `fasterAccess`, :53).
  - Summary: one fetch **per accession**.
  - Each fetch is 16 HTTP calls.
- A parent→child map is built in **HashMap iteration order over the parents**
  (MS `CategoryScore.java:143-150`). For each parent, every child maps to that
  parent, then the parent maps to itself. A child under two parents therefore
  takes the **last parent in HashMap order**. Both key sets are fixed, so the
  order is a constant.

**The scores** (`scoreCategories.properties`, read as `new Float(...)`):

| Method  | Score | Category | Type    | Score | Category |
| ------- | ----- | -------- | ------- | ----- | -------- |
| MI:0013 | 1.00  | 1        | MI:0208 | 0.10  | 1        |
| MI:0090 | 0.66  | 2        | MI:0403 | 0.33  | 2        |
| MI:0254 | 0.10  | 3        | MI:0914 | 0.33  | 3        |
| MI:0255 | 0.10  | 4        | MI:0915 | 0.66  | 3        |
| MI:0401 | 1.00  | 5        | MI:0407 | 1.00  | 3        |
| MI:0428 | 0.33  | 6        | unknown | 0.05  | 1        |
| unknown | 0.05  | 3        |         |       |          |

**The inputs.** For each pair, in **HashMap<MethodTypePair> order**, the method
and the type are appended once per entry in its pubmed list (`InteractionClusterScore.java:217-230`).
`n_pub = distinctPublications.size()` (:233).

**Category score** (MS `CategoryScore.java:36-113`). All arithmetic is `float`,
boxed `Float`:

- **a** = 1 + Σ over the term list of `score(parent(term) ?? "unknown")`, summed
  in list order.
- **count[p]** = how many terms map to parent p. A term with no parent counts
  under the key **`null`**, _not_ `"unknown"`, so `count["unknown"]` is always 0.
- **b** = 1 + Σ over categories (ascending; `HashMap<Integer>`):
  - a category with one term t: `(count[t]+1) · score[t]`
  - a category with several terms: `max score` + Σ over its terms, in
    mainCategories HashMap order, of `count[t] · score[t]` where `count[t] != 0`.
    The `Integer == Integer` comparison (:103) works only because small Integers
    are cached.
- **S** = `(float)(Math.log(a) / Math.log(b))`, where Java's `Math.log` works in
  double.
- **Effect:** unknown terms add 0.05 each to a but nothing to b.

**Publication score** (MS `scores/PublicationScore.java:27`): `n > 7 ? 1f :
(float)(log(n+1f) / log(8f))`.

**MI-score** (MS `scores/MIScore.java:46-64`). All weights are 1f; a and b start
at 0f:

```
a += type·1; b += 1
a += method·1; b += 1
a += pub·1;  b += 1
score = a / b   (float)
```

**Writing the score back.** `scoreResult.toString()` (`Float.toString`) is written
into the first confidence whose type equals `miscore` (case-insensitive), or added
as a new `miscore` confidence (`InteractionClusterScore.java:249-270`). It is
later read back with `Double.parseDouble`.

**Against the paper** (Villaveces et al., _Database_ 2015, bau131, CC BY 4.0):
the paper gives `S = log_(b+1)(a+1)`, `a = Σ s·n`, `b = a + Σ max(G)`,
`S_p = log_(b+1)(n+1)` with b=7, and the same score tables. The code diverges in
four ways:

- the unknown-term count bug above;
- the unknown method is grouped in category 3 and the unknown type in category 1;
- the descendant map is flat, truncated at 50, and resolved by override order,
  where the paper says "inherits from the nearest parent";
- everything is float32.

**A port written from the paper alone will not match.**

### 7. The per-resource clients (IC `psicquic/clients/`)

`ClientFactory.getClient` (`ClientFactory.java:11-40`) switches on the upper-cased
resource name: CHEMBL, BIND, BIOGRID, MINT, MENTHA, MATRIXDB,
INNATEDB / INNATEDB-ALL, REACTOME-FIS, GENEMANIA, HPIDB, ZINC, and Generic for
everything else (IntAct, IMEx, UniProt, Reactome, bhf-ucl, MPIDB, MBInfo, …).

`AbstractClient.getInteraction` (`AbstractClient.java:42-57`):

- **acc** = `getAcc(accs)` (:146): the first of the client's db list present
  (case-sensitive key), else the first value in HashMap order, else `""`.
- **alias** = `getAlias(otherAccs)` (:107):
  - takes the first `psi-mi` alias matching `^([a-zA-Z0-9\s:-_]{2,15})$`
    (note `:-_` is a character range), else the first `uniprotkb` alias, else the
    first value of any other db, iterating keys in HashMap order;
  - returns **null if longer than 15 characters**, else upper case.
- **score** = `getScore(confidences)` (:82): the first `intact-miscore`, else the
  first `miscore`, then `Double.parseDouble`. If neither is present,
  `parseDouble("")` throws `NumberFormatException`; that cannot happen because the
  MI-score is always added.
- **evidences** = the non-empty keys of `experimentToDatabase` in HashMap order (:191).
- Either acc empty: the client returns null and the cluster is skipped.

Overrides:

| Client                      | Db list (getDatabaseNames)                                                                | Overrides                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Mint                        | `uniprotkb,chebi,intact,mint`                                                             | —                                                                                                                                              |
| Generic, HPIDb, ReactomeFIs | `uniprotkb,chebi,intact,irefindex,ddbj/embl/genbank,refseq,unknown`                       | HPIDb: alias with no regex and no length cut; ReactomeFIs: score `NBC`, else `miscore`, else 0                                                 |
| GeneMania                   | `uniprotkb,chebi,ensembl,irefindex,ddbj/embl/genbank,refseq,unknown`                      | —                                                                                                                                              |
| Biogrid                     | `uniprotkb,chebi,intact,irefindex,ddbj/embl/genbank,refseq,entrez gene/locuslink,unknown` | alias = entrez gene/locuslink, else biogrid, else other; null if empty. The acc comes out as the **refseq** id (NP_…) where present, verified. |
| Bind                        | `uniprotkb,chebi,irefindex,ddbj/embl/genbank,refseq,unknown`                              | alias psi-mi → uniprot → ecocyc/unknown                                                                                                        |
| Chembl                      | `uniprotkb,chembl,chebi,unknown`                                                          | alias from `unknown`, skipping InChI= / chembl / longer than 15                                                                                |
| Matrixdb                    | `uniprotkb,chebi,ebi,matrixdb`                                                            | —                                                                                                                                              |
| Mentha                      | `uniprotkb,chebi,intact,mint,dip,matrixdb`                                                | evidences `id#db`, in db-list order, else all                                                                                                  |
| Innatedb                    | `innatedb`                                                                                | acc = innatedb, else uniprotkb; evidences `id#db`                                                                                              |
| Zinc                        | `uniprotkb,zinc,chebi,unknown`                                                            | score: intact-miscore only (bug: `zinc-score` branch still returns intact), else 0                                                             |

### 8. Filter, rounding, de-duplication, sorting

`getClusteredInteraction` (`InteractionClusterImpl.java:92-119`), per cluster in
ascending id order:

- If the query acc is not equal (**case-sensitive**) to A's acc, swap A and B (:103).
  For BioGrid A is a refseq id, so _every_ cluster is swapped.
- Keep the cluster if **`score >= 0.45`** (`>=`, :112; `MINIMUM_VALID_SCORE`,
  `util/InteractorConstant.java:12`).
- Round with `Toolbox.roundScore`: `Math.round(score*1000d)/1000d` (`Toolbox.java:59-61`).

`Toolbox.removeDuplicatedInteractor` (:70-98):

- Groups by partner acc in a `MapSet`: a `HashMap<String, TreeSet<Interaction>>`
  (`util/MapSet.java:14, 48`).
- The **TreeSet orders by score only** (`Interaction.compareTo`, `model/Interaction.java:114-128`),
  so two interactions with the same partner and the same rounded score collapse
  to the first. The last (highest) is kept.
- The result list is in **HashMap<String> order of partner accs**.

Then `Collections.sort` (stable, ascending score) and `Collections.reverse`
(:65-66, :295-296). Ties end up in **reverse HashMap order**. Verified on MINT/P53
(the 0.97 trio and others). A naive order fails at row 4.

### 9. JSON (CS `manager/InteractionManager.java:132-197`)

- Jackson with `default-property-inclusion=non_empty`
  (`src/main/resources/application.properties:24`) omits null and `""` fields and
  empty lists. An answer with no interactions is `{"resource":"Reactome"}`
  (verified: no `entities` key).
- Field order follows field declaration (verified):
  - top level: `resource`, `entities`
  - entity: `acc`, `count`, `interactors`
  - interactor: `acc`, `alias`, `id`, `evidences`, `score`, `accURL`, `evidencesURL`
- `resource` is the path variable as typed (`mint`, `BioGrid`).
- Entity `acc` is the map key, trimmed. `count` is the list size, **after**
  de-duplication.
- `alias` = `Interactor.getAliasWithoutSpecies(true)` (`model/Interactor.java:91-107`):
  - null if alias equals acc;
  - else `.replace("_HUMAN","").replace("HUMAN","").trim().replaceAll("_"," ")`,
    giving `LT SV40` and `IFI5B MOUSE` (verified);
  - can become `""`, which is then omitted.
- `id`: a `long` counter starting at 1, running across entities in output order.
  An entity with no interactions is skipped and uses no id.
- `evidences`: the evidence list size, or omitted when 0.
- `score`: a `Double`, written with JDK `Double.toString` (`1.0`, `0.5`, `0.969`).
- `accURL` (`Toolbox.getAccessionURL`, :100-125; `util/ResourceURL.java`):
  - `EBI-…` → null;
  - CHEBI:/CHEMBL… → the resource's chemical URL;
  - Uniprot regex `find` → `http://www.uniprot.org/uniprot/##ID##`;
  - otherwise the resource's protein URL.
  - **MINT, IntAct, IMEx and UniProt are not in the `ResourceURL` enum, so they
    fall to `STATIC`** (`getByName`, :96-103; verified for MINT).
- `evidencesURL` (`Toolbox.getEvidencesURL`, :137-199):
  1. If the resource enum has evidence URLs, group the evidences by dbSource
     (resource upper case without `-`, or the `#db` part) in a MapSet (HashMap of
     TreeSets).
  2. Take the **first key in HashMap order**.
  3. If that db's enum entry is multivalued, join its **sorted** ids with
     `%20OR%20`; else take the smallest id.
  4. The URL is the enum's map for that key, else the IntAct default.
  - Verified for MINT (STATIC, multivalued) and BioGrid (single, `http://thebiogrid.org/<min id>`).
  - Reactome's enum entry has no evidence URL, so the field is omitted.
- **Summary** (`InteractionManager.java:207-225`): `{resource, entities:[{acc,count}]}`;
  entities with count 0 are dropped.

### 10. The summary's count (D26)

`countInteraction` (`InteractionClusterImpl.java:121-142`):

- one sequential pass per accession;
- registry lookup and MITAB fetch each time;
- clustering with `"uniprotkb,chebi"` (§5);
- the count includes every cluster the client turns into a non-null interaction
  with score ≥ 0.45;
- **no swap, no rounding, no `removeDuplicatedInteractor`**.

D26 is right: it counts clusters before de-duplication, with different cluster keys
from details.

### 11. Error cases (CS `controller/GlobalExceptionHandler.java`, envelope `toJsonResponse` :450-463)

| Case                                       | GET details / GET summary / POST summary                                                                                                                    | POST details                                                                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Unknown resource                           | 500, message `"<resource> not found"` (:136-141)                                                                                                            | same                                                                                                                                     |
| Registry down                              | 500, `"Couldn't query PSICQUIC Resources"` (:152-157)                                                                                                       | same                                                                                                                                     |
| PSICQUIC server unreachable, or HTTP ≥ 400 | IOException → `PsicquicQueryException` → 500 `"PSICQUIC resource is not responding"` (:128-133). An unanswering server holds the request about 135 s (D26). | the worker swallows every exception (`util/PsimiTabReaderRunnable.java:35`), so **that accession just disappears** and the answer is 200 |
| Unparseable MITAB line                     | `PsimiTabException` → 500 `"Couldn't parse PSICQUIC result"` (:144-149)                                                                                     | dropped                                                                                                                                  |
| Blank MITAB line                           | `IllegalArgumentException` → 500 with message `"Empty String passed to create Field"` (:316-321)                                                            | dropped                                                                                                                                  |
| Bad, unknown or interaction-less accession | the server returns nothing → 200 `{"resource":"X"}`                                                                                                         | same                                                                                                                                     |
| Inactive resource                          | queried anyway; resolves as "unreachable" or "no data"                                                                                                      | same                                                                                                                                     |
| Non-numeric `intact-miscore`               | `NumberFormatException` (an IllegalArgumentException) → 500 with Java's message                                                                             | same                                                                                                                                     |
| NPE anywhere                               | 500 `"Something unexpected happened and the error has been reported."`                                                                                      | same                                                                                                                                     |

- `POST` with an empty body: Spring refuses it with a missing-body error. The
  existing node handling of that envelope applies (**UNVERIFIED** for these routes).
- `POST` with an inner empty token (`a,,b`): the acc `""` is requested as
  `…/interactor/`. That server's answer is **UNVERIFIED**.

### 12. Where Java's order depends on hashing, and what TS must do

| #   | Map                                                           | What it decides                                                                         | TS approach                                              |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | `HashSet` of POST accessions (controller)                     | submission order                                                                        | JavaHashMap insertion order = body order                 |
| 2   | `ConcurrentHashMap` of fetched MITAB, then `HashMap ret`      | **entity order and id numbering** (verified: Q14204, bucket 1, before P04637, bucket 6) | JavaHashMap with insertion = CHM iteration order (below) |
| 3   | MapSet `HashMap<String>` in removeDuplicatedInteractor        | order of tied scores (verified)                                                         | JavaHashMap                                              |
| 4   | `otherAccs`, `accs`, `experimentToDatabase`, evidences MapSet | alias, acc fallback, evidence choice; Innatedb/Mentha `#db` choice                      | JavaHashMap per map, with insertion order as Java's      |
| 5   | `HashMap<MethodTypePair>`                                     | float summation order                                                                   | hash `31*h(m)+h(t)` with int overflow                    |
| 6   | mapOfTerms, mainCategories (fixed keys)                       | parent override, sum order                                                              | compute once, hard-code with a test                      |
| 7   | `HashMap<Integer>` (interactionMapping, categories)           | —                                                                                       | ascending                                                |

Row 2 in detail: ret's iteration is bucket order, then insertion order within a
bucket. Insertion order matters only for two accessions in the same bucket of
ret's final table, and that order comes from the ConcurrentHashMap:

- **Under 10 accessions (1 thread):** the CHM fills in submission order, and
  there is no CHM resize under 12 entries. Deterministic: node simulates it.
- **10 or more (2 threads):** colliding accessions sit in the same CHM bin in
  _completion order_, partly reversed by CHM resizes (CHM resizes at ≥ 0.75n,
  HashMap at > 0.75n). **Java itself is nondeterministic here.**
  - Node should simulate with submission order.
  - Parity tests should either avoid colliding pairs or accept either order.
  - Declare it as a known Java nondeterminism, not a difference.

`java-hashmap.ts` already covers HashMap with tree bins. A small CHM model is new.

### 13. The live measurements (beta's Java service, 28 Nov 2026)

| Request                                              | Status, time         | Answer                                                         | Prototype                                                                         |
| ---------------------------------------------------- | -------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `POST /molecules/mint/details`, body `P04637,Q14204` | 200, 102 s, 33,885 B | Q14204: 5, ids 1–5; P04637: 122, ids 6–127                     | **127/127 identical**                                                             |
| `GET /molecule/Reactome/Q14204/details`              | 200, 21 s            | `{"resource":"Reactome"}`                                      | 60 clusters, all MI-score 0.272                                                   |
| `GET /molecule/BioGrid/Q14204/details`               | 200, 9.4 s           | 59 interactors with computed scores, refseq accs, ncbi accURLs | **59/59 identical with the first-page OLS snapshot**; 3/59 with the full ontology |

- Content type `application/json;charset=UTF-8`.
- MINT scores are its own `intact-miscore` (2 decimals) in this answer.
- The inputs were fetched directly from EBI's public services: the registry, the MINT, BioGrid, Reactome, UniProt and HPIDb MITAB for these accessions, and OLS.
- The OLS truncation was reproduced independently: MI:0013's descendants with `?size=1000` return 50 terms, `page.totalElements` 73.

## R2. Licences

| Component (deployed version)                                                  | LICENSE file                                                    | pom `<licenses>`                                                                                                                                        | GitHub    |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| content-service `7b9eceb`                                                     | none                                                            | none                                                                                                                                                    | none      |
| interactors-core 1.1.5 (`7513f42`)                                            | none                                                            | none; parent reactome-parent 1.0.5. The repo's 1.0.5-SNAPSHOT `d93ad5a` declares none; Apache-2.0 was added in `24dfbff` (Jul 2025), present in v1.0.7+ | none      |
| micluster 1.7.14                                                              | none                                                            | none                                                                                                                                                    | none      |
| miscore 1.3.14 (including `scoreCategories.properties`, `psimiOntology.json`) | none                                                            | none                                                                                                                                                    | none      |
| psimitab 1.8.6 (MICommunity/psimi)                                            | **CC-BY-4.0** (repo LICENSE, added 20 Jul 2018, before the tag) | **Apache-2.0** (root pom)                                                                                                                               | CC-BY-4.0 |
| psicquic-registry-client 1.4.0                                                | none                                                            | none                                                                                                                                                    | none      |
| The paper (Villaveces et al. 2015)                                            | —                                                               | —                                                                                                                                                       | CC BY 4.0 |

**Reading.** micluster, miscore and the registry client have no licence: by default
all rights reserved, held by their authors (EMBL-EBI). interactors-core and
content-service are Reactome's own code, but at the deployed versions they
declare no licence either. Who may relicense them is for the owner to say
(**UNVERIFIED**). psimitab is Apache-2.0 by its pom and CC-BY-4.0 by its file;
either is compatible with the target, given attribution.

**Recommendation: a clean reimplementation, not a translation.**

- Write the TypeScript from:
  1. the published method, the paper (CC BY);
  2. a written description of the observed behaviour, which is this note: facts
     about behaviour, in our own words;
  3. recorded Java answers as fixtures.
- Do not copy code text or structure from micluster or miscore. This is the
  repository's existing practice (`java-double.ts`: "an independent
  implementation … no OpenJDK source text is copied").
- The score tables are data published in the paper.

**In practice for byte-for-byte parity:** the paper is not enough (§6). Each
deviation must be specified as behaviour, implemented on purpose, and pinned by a
fixture recorded from Java:

- float32 arithmetic and JDK 11 `Float.toString`;
- the null-key unknown count;
- unknown-term categories;
- the first-50-term ontology snapshot and parent override order;
- clustering keyed by the client's db list (and by `uniprotkb,chebi` for summaries);
- dropped empty MITAB fields and the reused `object` quirk;
- all the HashMap orders in §12.

That is "interoperability from observed behaviour". It is not legal advice; flag
it to the owner.

## Size estimate (TypeScript, excluding tests)

| Part                                                                                                                         | Lines                 |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| MITAB 2.5 reader: quote-aware split, xref, alias and confidence parsing, Java's error kinds                                  | 220                   |
| Encore building and clustering (accs and other accs, synonyms, merge, method/type pairs, publications)                       | 350                   |
| MI-score (category, publication, combined; float32 via `Math.fround`)                                                        | 160                   |
| Ontology snapshot: the 8 branches' first pages as JSON, plus a snapshot script that refuses a change in shape                | 100 + data            |
| JDK 11 `Float.toString` (adapting `java-double.ts`)                                                                          | 150                   |
| Clients (abstract + 11) and `ResourceURL` / constants table                                                                  | 280                   |
| Toolbox: rounding, de-duplication, sorting, accURL, evidencesURL                                                             | 150                   |
| Endpoints: 4 routes, body split, registry lookup, fetch with timeout, cache, single flight, per-server limit, error envelope | 300                   |
| Order models: CHM plus HashSet use (HashMap exists)                                                                          | 100                   |
| **Total code**                                                                                                               | **about 1,800–2,000** |
| Tests and fixtures (recorded MITAB in, Java JSON out)                                                                        | about 1,000–1,500     |

The prototype that reached parity on three answers is about 650 Python lines
without the generic clients.

## Parts most at risk (fallback candidates via `deploy/java-library`)

1. **The MI-score's coupling to live OLS.** Java recomputes from OLS on every
   request. The first-page truncation, OLS's data and order, and OLS failures all
   change Java's scores.
   - A snapshot gives a stable answer that will _drift_ from Java whenever OLS
     changes, and differs from Java whenever OLS fails for Java.
   - Parity tests must run with OLS healthy, against a snapshot taken the same day.
   - Not a fallback candidate (the fallback would inherit the same live
     dependency), but the declared-differences register needs a row.
2. **Float edge cases.** JDK 11 `Float.toString` that is not shortest, and
   `Math.log` (HotSpot intrinsic) against V8's `Math.log` differing by 1 ulp.
   Either matters only at a float-rounding or 0.0005 boundary: rare, untested.
   - Mitigation: port `Float.toString` faithfully, and check the log against a
     small table of Java values.
   - **Fallback candidate if a mismatch shows:** the score function alone
     (counts in, Float text out).
3. **Clustering of awkward resources** (synonym chains, intramolecular `-`,
   swaps, Innatedb/Mentha `#db` evidences).
   - Fallback candidate: the cluster step as a pure function, MITAB lines in and
     clusters out, through the library service. **This is the best single
     fallback boundary.**
4. **Entity order for 10 or more accessions with bucket collisions.** Java is
   nondeterministic; node cannot do better than one consistent choice.
5. **Character encoding** of the MITAB stream (**UNVERIFIED** locale). Test with a
   resource whose aliases contain non-ASCII text before routing.
