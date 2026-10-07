# Data Model: Curator email review

This feature changes behaviour rather than stored data; the one record it introduces is
how each reported item is tracked to a final state. The tracker lives outside the public
repository.

## Curator item

| Field      | Meaning                                              |
| ---------- | ---------------------------------------------------- |
| `id`       | The curator's identifier, 1a–3c                      |
| `report`   | The curator's own words                              |
| `cause`    | Root cause, with file and line                       |
| `rank`     | 1–5 ease/certainty (research.md)                     |
| `status`   | See states below                                     |
| `change`   | What was done, in the reader's terms                 |
| `evidence` | How it was shown fixed on beta — the visible outcome |
| `owner`    | Set only when the item is not this site's            |

## Related finding

An instance of the same problem found elsewhere, linked to the item that led to it (for
example, the three broken news images found while checking 1d).

## States

```text
OPEN → INVESTIGATING → FIXED-PENDING-DEPLOY → FIXED
                    ↘ NEEDS-DECISION → (decided) → FIXED-PENDING-DEPLOY → FIXED
                    ↘ NOT-OURS            (terminal, owner named)
                    ↘ NEEDS-INFO          (terminal until the curator replies)
```

**Rule.** `FIXED` is reached only from observation on beta. A merged pull request is
`FIXED-PENDING-DEPLOY`: this week, three merged changes sat undeployed while their
issues were considered closed.
