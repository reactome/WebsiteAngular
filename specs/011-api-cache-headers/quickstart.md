# Quickstart: checking the cache labels

Commands use Node 24 (`export PATH=$(ls -d $HOME/.nvm/versions/node/v24*/bin | tail -1):$PATH`).

## Unit tests

```sh
npx vitest run tools/content-node/parameters.spec.ts tools/content-node/cache-label.spec.ts
```

Expected:

- the record covers every GET endpoint and agrees with Java's description;
- each validator accepts its standard forms and refuses each alias;
- each row of [contracts/cache-labels.md](contracts/cache-labels.md) gets its header.

Prove each test fails: for example, make one validator accept a padded id and watch the test catch it.

## Against a running node

Start node on a port of its own, then read the two headers:

```sh
curl -s -D - -o /dev/null 'http://127.0.0.1:<port>/ContentService/data/diseases' | grep -i -E 'cache-control|x-cache-rule'
# cache-control: public, max-age=3600, s-maxage=31536000
# x-cache-rule: standard
curl -s -D - -o /dev/null 'http://127.0.0.1:<port>/ContentService/data/diseases?utm_source=x' | grep -i -E 'cache-control|x-cache-rule'
# cache-control: no-store
# x-cache-rule: parameter:utm_source
```

The bodies of both are byte-identical to Java's, checked with the parity harness.

## Parity on invalid inputs

Run the invalid-input corpus against node and Java: sequentially, spaced, and a few hundred requests at most. Expected: every case is byte-identical, apart from an error body's `url`.

## The site's own requests

```sh
E2E_PORT=4330 npm run e2e
```

The classifier reports each ContentService request the site made that is not in standard form. Expected: none, or only those on the reviewed list.

## After the Cloudflare rule is on (#527)

Request a standard-form URL twice through the public site, and expect `cf-cache-status: HIT` the second time. Request a non-standard one twice, and expect it never to be a `HIT`.

## Release day

Purge `/ContentService/` in Cloudflare, then run:

```sh
node tools/content-node/warm.ts <site origin>
```

Expected: every URL on the list answers with `x-cache-rule: standard`, and a second pass gets `cf-cache-status: HIT`.
