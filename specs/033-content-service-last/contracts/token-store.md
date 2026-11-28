# Contract: the token store

One file per token, `<token>.json`, UTF-8, in the folder the deployment names (`CUSTOM_INTERACTORS_DIR`). Written by the one-time conversion for existing tokens, and by node for new ones. A file is never changed once written.

```text
{
  "format": 1,
  "kind": "pairs" | "psicquic",
  "summary": { ...the Summary as Java's answer writes it: name, fileName, token, counts... },
  "warnings": [ ...as Java's answer writes them, in order ],
  // kind "pairs":
  "pairs": [
    { "idA": "...", "aliasA": "..." | null, "idB": "...", "aliasB": "..." | null,
      "confidence": 1.0 | null, "evidence": [ "..." ] }
  ],
  // kind "psicquic":
  "url": "..."
}
```

**Rules:**

- `pairs` keeps the order the Java parser produced: the conversion writes the `CustomResource`'s pairs in the order Java's own iteration yields them, and records that order in this file. Node applies Java's `HashSet` order when it answers, from the identifiers alone (research R5), so the stored order is a record, not something node relies on.
- `confidence` is written as Java's `Double` writes it.
- Every field Java's answers use is present. Anything in the Java object that no answer writes is left out, and listed in research R5 by the conversion's first run.
- The exact field list is fixed by the conversion program's first run against a copy of a real store. The shape above is the plan, and this file is corrected in the same pull request if the run finds more.

**The conversion program's report** (printed, never written into the store): the number of files read, converted, and failed, and for each failure the token and the exception's class. No content of any upload is printed.
