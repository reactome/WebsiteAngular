// Values whose kind JSON does not say (spec 016, data-model.md).

/**
 * A Java long, written exactly (`JSON.rawJSON`): it may exceed 2^53, beyond
 * which a JavaScript number reads it rounded.
 * @asType integer
 * @format int64
 */
export type Long = number;

/** A date written as milliseconds since the epoch. */
export type EpochMillis = number;

/**
 * Text Solr may have highlighted: a match is wrapped in
 * `<span class="highlighting" >…</span>`, so a reader showing it as plain
 * text escapes it.
 */
export type Highlighted = string;
