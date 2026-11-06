/**
 * reaction-exporter's Place and PlacePositioner (research D22, step 3): where
 * each role goes round the reaction, and where a compartment's box goes
 * beside another's.
 *
 * Java gathers places and roles in EnumSets, which iterate in declaration
 * order, and in HashSets of enums, hashed by identity; the latter are only
 * ever asked what they contain. So both are kept here as sets of names, and
 * where order matters (`ordered`) places are put in declaration order.
 */
import type { EntityRole } from './model.ts';

/** Place, in declaration order. */
const PLACES = ['TOP', 'BOTTOM', 'LEFT', 'RIGHT', 'CENTER'] as const;
export type Place = (typeof PLACES)[number];

/** An EnumSet's iteration: declaration order. */
function ordered(set: Set<Place>): Place[] {
  return PLACES.filter((value) => set.has(value));
}

const PREFERRED: Record<Place, Place[]> = {
  LEFT: ['LEFT', 'BOTTOM', 'TOP'],
  RIGHT: ['RIGHT', 'BOTTOM', 'TOP'],
  TOP: ['TOP', 'RIGHT', 'LEFT'],
  BOTTOM: ['BOTTOM', 'RIGHT', 'LEFT'],
  CENTER: [],
};

const ALLOWED: Record<Place, Place[]> = {
  LEFT: ['RIGHT', 'TOP', 'BOTTOM'],
  RIGHT: ['LEFT', 'TOP', 'BOTTOM'],
  TOP: ['BOTTOM', 'LEFT', 'RIGHT'],
  BOTTOM: ['TOP', 'LEFT', 'RIGHT'],
  CENTER: ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'],
};

const DEFAULT_ALLOWANCES: Place[] = ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'];

/** getPlace: where a role goes. */
export function placeOf(role: EntityRole): Place {
  switch (role) {
    case 'input':
      return 'LEFT';
    case 'output':
      return 'RIGHT';
    case 'catalyst':
      return 'TOP';
    case 'negative':
    case 'positive':
      return 'BOTTOM';
  }
}

/**
 * buildOrderedIntersection: the first place's list, in its order, keeping
 * what every other place's list has. `places` iterates as an EnumSet does.
 */
function intersection(places: Set<Place>, from: Record<Place, Place[]>): Place[] {
  const [first, ...rest] = ordered(places);
  let result = [...from[first as Place]];
  for (const place of rest) result = result.filter((p) => from[place].includes(p));
  return result;
}

function preferences(places: Set<Place>): Place[] {
  return places.size ? intersection(places, PREFERRED) : [];
}

export function allowances(places: Set<Place>): Place[] {
  return places.size ? intersection(places, ALLOWED) : DEFAULT_ALLOWANCES;
}

/**
 * getRelativePosition: where a box with places `a` goes beside one with
 * places `b` -- the first of a's preferences that b allows; null when b
 * allows nothing.
 */
export function relativePosition(a: Set<Place>, b: Set<Place>): Place | null {
  const preferred = preferences(a);
  const allowed = allowances(b);
  if (!allowed.length) return null;
  if (!preferred.length) return allowed[0] as Place;
  for (const preference of preferred) if (allowed.includes(preference)) return preference;
  return (b.has('CENTER') ? preferred[0] : allowed[0]) as Place;
}

/** simplify: a positive regulator counted as a negative one. */
export function simplify(roles: Set<EntityRole>): Set<EntityRole> {
  const simple = new Set(roles);
  if (simple.has('positive')) simple.add('negative');
  simple.delete('positive');
  return simple;
}
