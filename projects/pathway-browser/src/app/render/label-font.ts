/** What of a font face this needs: which face it is, and loading it. */
export type Face = Pick<FontFace, 'family' | 'style' | 'weight' | 'load'>;

/**
 * Every face of `family` at `weight`, upright, loaded: every unicode subset
 * the page declares for it, not only the one the first text drawn needed.
 *
 * The genome-wide view's labels are fitted by FoamTree, which measures each
 * word once per page and keeps the width for the page's life. A word with a
 * letter outside the subset already loaded ("IKKε-mediated", "β-amyloid") was
 * measured before its subset arrived, in a fallback font, so on a fresh page
 * its label wrapped as if in another font; on a held page, after a figure that
 * had brought the subset in, it was measured in Roboto and wrapped otherwise.
 * One label of 7,604 came out on five lines fresh and three held (spec 018
 * T012). With every subset in before the first word is measured, each word is
 * measured in the font it is drawn in, whatever was drawn before it.
 *
 * A face that fails to load is left as it is: the figure is then measured as
 * it was before this, which is no worse.
 */
export async function loadFamily(
  faces: Iterable<Face>,
  family: string,
  weight: string
): Promise<void> {
  const wanted = [...faces].filter(
    (face) =>
      face.family.replace(/^["']|["']$/g, '') === family &&
      face.style === 'normal' &&
      face.weight === weight
  );
  await Promise.allSettled(wanted.map((face) => face.load()));
}
