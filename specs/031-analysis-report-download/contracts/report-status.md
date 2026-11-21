# Contract (proposed for pdf-export spec 002): the report's status in its 202

An addition to pdf-export's `GET /report/{token}/{species}/report.pdf` (its
contracts/service.md). Everything not named here stays as it is.

## The 202's JSON

For a request that does not ask for HTML, the 202's body gains `status`:

```json
{
  "code": 202,
  "reason": "Accepted",
  "messages": ["The report is being made; ask again shortly"],
  "status": {
    "state": "making",
    "stage": "figures",
    "done": 12,
    "total": 40,
    "estimate": 48
  }
}
```

| Field           | When       | Meaning                                                                                |
| --------------- | ---------- | -------------------------------------------------------------------------------------- |
| `state`         | always     | `queued` (waiting its turn) or `making`                                                |
| `place`         | `queued`   | its place in the queue, 1 being the next to start                                      |
| `stage`         | `making`   | `reading` (the analysis's results and the graph), `figures` (drawing them), `printing` |
| `done`, `total` | `figures`  | figures drawn so far, and to draw                                                      |
| `estimate`      | when known | whole seconds left until the report is ready; absent with no past report to go by      |

A field that does not apply is absent, never `null` or `0`.

## `Prefer: wait=<seconds>`

A request may ask to be held less than the 30 s by `Prefer: wait=<seconds>` (RFC 7240):
honoured from 0 to 30, a larger value read as 30, a malformed one ignored. The answer
carries `Preference-Applied: wait=<seconds>` when honoured. Without it, 30 s as today.

## Unchanged

- The address, its parameters and key; one report per key; kept an hour.
- The 200 (the PDF, its type and `Content-Disposition`), 404, 410, 500, 503 and their
  bodies and `Retry-After`.
- A browser's page (`Accept: text/html`).
- The limits; a joining request still never counted.

## Tests (in pdf-export)

- A queued report's 202 has `state: queued` and its `place`; a making one its `stage`, and
  `done`/`total` while drawing.
- `estimate` absent before any report has finished, present after.
- `Prefer: wait=2` answers within about 2 s with `Preference-Applied`; `wait=99` holds 30 s
  at most; no `Prefer`, 30 s.
- A browser's page byte-identical to before for a 202.
