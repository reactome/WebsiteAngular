# Contract: the token store

One file per token, `<token>.json`, UTF-8, in the folder the deployment names. Written by the one-time conversion for existing tokens, and by node for new ones. Removed only by the store's bound (research R5), as Java's checker removes them.

A token is either an upload's (32 lower-case hexadecimal digits) or a custom PSICQUIC service's (`PSI-` and a signed integer). A file name that is neither is never read or written.

```text
{
  "format": 1,
  "kind": "pairs" | "psicquic",
  "summary": { ...the Summary as Java's answer writes it: name, fileName, token, counts... },
  "warnings": [ ...as Java's answer writes them, in order ],

  // kind "pairs":
  "pairs": [
    { "idA": "...", "aliasA": "..." | null, "idB": "...", "aliasB": "..." | null,
      "confidence": <number> | null, "evidence": [ "..." ] }
  ],
  "byIdentifier": {
    "<identifier>": [ <index into pairs>, ... ]   // the order Java's stored set yields
  },

  // kind "psicquic":
  "url": "..."                                     // with the "/" Java adds
}
```

**Rules:**

- **`byIdentifier` is what node answers from.** For each identifier, it lists that identifier's pairs in the order Java's stored set (`CustomResource`'s radix tree of `Set<TreeInteraction>`) yields them. Node then rebuilds Java's `HashSet<CustomInteraction>` from that sequence, which decides which duplicate survives and the order of equal scores (research R5). The conversion writes it from Java's own iteration. For a new upload, node writes it by building the same structures in the same insertion order, and T019's spec proves the two agree.
- **`confidence`** is written as Java's `Double` writes it: 1.0 for a two-column tuple, the file's own value for the extended format, the computed score for PSI-MITAB.
- **Every field Java's answers use is present.** Anything in the Java object that no answer writes is left out, and listed in research R5 by the conversion's first run.
- **The exact field list is fixed by the conversion program's first run** against a copy of a real store. The shape above is the plan, and this file is corrected in the same pull request if the run finds more.
- **A file is never changed once written.** A custom PSICQUIC registration whose token already names a different service is refused (research R5), where Java overwrites.

**The conversion program's report** is printed, never written into the store. It gives the number of files read, converted and failed, and for each failure the token and the exception's class. No content of any upload is printed.
