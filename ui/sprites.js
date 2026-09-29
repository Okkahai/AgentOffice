// Original chunky low-res character sprites (11x28), palette-indexed, earthy dark palette.
// Style reference: tall, faceless-at-a-glance figures lit warmly; the face lives in the portrait panel.
// Style only; no third-party assets.
const TOP = [
  '..hhhhhhh..', '..hhhhhhh..', '..hsssssh..', '..hsesesh..', '...sssss...', '...sssss...', '....sss....',
  '.ccccccccc.', 'aacccccccaa', 'aacCcccCcaa', 'aaccttccaaa'.slice(0, 11), 'aacccttcaaa'.slice(0, 11), 'aacccccccaa', 'aaCcccccCaa', 'aacccccccaa', 's.ccccccc.s',
  '.ccccccccc.', '.cCcccccCc.', '.ccccccccc.',
];
const LEGS = [
  ['..ppp.ppp..', '..ppp.ppp..', '..ppp.ppp..', '..ppp.ppp..', '..ppp.ppp..', '..ppp.ppp..', '..ppp.ppp..', '..bbb.bbb..', '.bbbb.bbbb.'],
  ['..ppp.ppp..', '..ppp.ppp..', '.ppp...ppp.', '.ppp...ppp.', 'ppp.....ppp', 'ppp.....ppp', 'ppp.....ppp', 'bbb.....bbb', 'bbb.....bbb'],
  ['..ppp.ppp..', '..ppp.ppp..', '..ppp.ppp..', '...pp.pp...', '...pp.pp...', '...pp.pp...', '...pp.pp...', '...bb.bb...', '..bbb.bbb..'],
];
const LOOKS = {
  MANAGER:  { c: '#5e3f52', C: '#43293a', a: '#4e3345', t: '#c9a24a', p: '#231d26', b: '#141116', h: '#2a1c22' },
  ENGINEER: { c: '#6b5a3a', C: '#4d3f28', a: '#5a4a30', t: '#8fae6a', p: '#2a2620', b: '#15120e', h: '#3a2a1c' },
  QA:       { c: '#3f5f5a', C: '#2c4541', a: '#345049', t: '#d9dee7', p: '#1f2628', b: '#101414', h: '#1d1d24' },
};
const BASE = { s: '#c99a6e', e: '#14100c' };
const HAIRS = ['#3a2a1c', '#a8743a', '#1d1d24', '#8f3f2e', '#c9c2b0'];

/** opts: { variant, leg: 0 stand | 1 | 2 walk frames, sit: upper body only, typing: 0|1 arm bob } */
export function drawChar(g, x, y, role, opts = {}) {
  const look = { ...BASE, ...(LOOKS[role] ?? LOOKS.ENGINEER) };
  if (opts.variant != null) look.h = HAIRS[opts.variant % HAIRS.length];
  const rows = opts.sit ? TOP : [...TOP, ...LEGS[opts.leg ?? 0]];
  const glasses = role === 'QA' || (opts.variant != null && opts.variant % 2 === 1);
  rows.forEach((row, j) => [...row].forEach((c, i) => {
    if (c === '.') return;
    let col = look[c];
    if (glasses && j === 3 && c === 's') col = '#0c0a08';
    if (opts.typing != null && j >= 8 && j <= 15 && (i < 2 || i > 8) && c === 'a') col = look.a;
    g.fillStyle = col;
    const dy = opts.typing != null && j >= 14 && (i < 2 || i > 8) ? opts.typing : 0;
    g.fillRect(x + i, y + j + dy, 1, 1);
  }));
}
export const CHAR_H = 28;
