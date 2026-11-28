# Quickstart: checking that the nine operations moved

Each check runs against beta, through its own nginx, with the host mapped to the local machine. Requests are small and spaced: one at a time, with a pause between, never a burst at another organisation's server.

## 1. PSICQUIC: node and Java give the same answer (Story 1, SC-003)

1. Start node on a spare port beside beta's own, with `PSICQUIC_CACHE` set to an empty scratch folder.
2. For one pathway from the sample, take its diagram's identifiers as the Pathway Browser sends them (`getIdentifiersFromGraph`).
3. For every live resource on the registry's list, send the same `POST …/psicquic/molecules/{resource}/details` to Java and to node **at the same moment**. Then send a second pair to Java alone.
4. **Expected:** node's body equals Java's byte for byte, or differs exactly where Java's two answers differ from each other (the data changed between calls). No other difference.
5. Repeat for `summary`, and for the two `GET` forms with three accessions of the pathway.

## 2. PSICQUIC: the cache (Story 1, SC-001, SC-002)

1. Ask node for one resource and one pathway. Note the time (several seconds, as Java's).
2. Ask again. **Expected:** the same bytes, in under a second, and no request to the third-party server (node's log says it was served from the cache).
3. Point one resource's address at a server that never answers (a test setting). **Expected:** after `PSICQUIC_TIMEOUT_MS`, a POST for details answers 200 without that server's accessions; a POST for the summary and a GET answer the "PSICQUIC resource is not responding" 500, as Java answers a failed fetch. Nothing is kept: the next request asks again.
4. Send the same request ten times at once on an empty cache. **Expected:** one request to the third-party server, and ten identical answers.

## 3. Custom interactors: every token still opens (Story 2, SC-004)

1. On a copy of a server's token store, run the conversion program from the library service's image. **Expected:** every file converted, and an empty failure list.
2. Point a node started on a spare port at the converted folder.
3. For every token, send `POST …/token/{token}` to Java and to node, with the identifiers its pairs name plus three it does not. **Expected:** identical answers for every token.
4. Repeat 1 to 3 on each server that holds a store, before that server's route moves, by whoever runs it.

## 4. Custom interactors: uploads (Story 2, SC-005)

1. Upload each file in the parser corpus (the fixtures, plus one file for each of Java's warnings and refusals) to both services, as content, as a form and by address.
2. **Expected:** the same answers, tokens included, except the declared differences for fetching an address. Refusing a private address and a slow address is checked against node alone.

## 5. Routing and switching off (Story 3, SC-006)

1. `deploy/nginx/test-config.sh` and `routes.spec.ts`: every one of the nine goes to node on every deployment, and no `/ContentService` path reaches the old service.
2. On beta, stop the old ContentService. **Expected:** every published operation answers through the site with its documented example, and the end-to-end suite passes. Start it again afterwards, until the release that retires it.
