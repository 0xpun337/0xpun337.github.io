/** Shared dragon artwork. Data only — no behaviour, so the hero and the
 *  in-post mascot can each animate it their own way without coupling. */

/** Pixel key: o outline · b body · h highlight · e eye white · p pupil ·
 *  t tooth · n nostril. Dot is transparent. Facing left. */
export const HEAD = [
  '........oooooo....',
  '......oohhhhhhoo..',
  '....oohhhhhhhhhho.',
  '..oobbbbhhhhhhhho.',
  '.obbbbbbbbhhhhhho.',
  'obbeepbbbbbbhhhhho',
  'obbeepbbbbbbbbbbbo',
  'onbbbbbbbbbbbbbbo.',
  'ottotototobbbbbbo.',
  '.oooooooooooooooo.',
];

export const JAW = [
  'oooooooooooooooo',
  'obtbtbtbtbbbbbbo',
  'obbbbbbbbbbbbbbo',
  '.oobbbbbbbbbboo.',
  '...oooooooooo...',
];

export const HEAD_W = 18;
export const JAW_W = 16;
