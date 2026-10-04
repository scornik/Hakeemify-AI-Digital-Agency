/**
 * Which repositories the harvester may read.
 *
 * This is **not** the shipped-closure licence gate in `scripts/check-licences.mjs`. That one
 * decides what code may reach a client's site. Nothing here ever reaches a client: the harvester
 * stores class-token frequencies and effect names, never source. So the question is different —
 * not "may we redistribute this" but "can we say, later, where this count came from".
 *
 * The answer is still a closed list, for one reason: a corpus you cannot audit is a corpus whose
 * ban list you cannot defend. When a human is asked *why* `rounded-2xl shadow-2xl backdrop-blur`
 * is banned, the answer has to be "it appeared in 182 of 400 named repositories", and every one of
 * those names has to be checkable. `NOASSERTION` is not checkable, so it is not counted.
 *
 * There is no shortage: GitHub holds thousands of MIT shadcn repositories.
 */

/** SPDX ids the harvester will read. Deliberately narrower than it needs to be. */
export const READABLE_LICENCES: readonly string[] = [
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  'Unlicense',
  'CC0-1.0',
];

/**
 * Values GitHub returns when it could not determine a licence. Counted as unknown rather than
 * guessed at: a repository with a LICENSE file GitHub cannot classify is exactly the case where
 * guessing is most likely to be wrong.
 */
export const UNKNOWN_LICENCE_MARKERS: readonly string[] = ['NOASSERTION', 'other', 'unknown'];

export type LicenceVerdict =
  | { readonly readable: true; readonly spdx: string }
  | { readonly readable: false; readonly reason: string };

export function classifyLicence(spdx: string | null | undefined): LicenceVerdict {
  if (spdx === null || spdx === undefined || spdx.trim() === '') {
    return { readable: false, reason: 'no licence declared' };
  }
  const id = spdx.trim();

  if (UNKNOWN_LICENCE_MARKERS.some((marker) => marker.toLowerCase() === id.toLowerCase())) {
    return { readable: false, reason: `licence is ${id}, which GitHub could not classify` };
  }
  // Exact match, case-insensitive. No prefix matching: `MIT` must not admit `MIT-advertising`,
  // and `Apache-2.0` must not admit a dual licence string nobody has read.
  const match = READABLE_LICENCES.find((allowed) => allowed.toLowerCase() === id.toLowerCase());
  if (match === undefined) {
    return { readable: false, reason: `${id} is not in the readable list` };
  }
  return { readable: true, spdx: match };
}
