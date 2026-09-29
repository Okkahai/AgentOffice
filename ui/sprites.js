// Original pixel-art sprites (10x16), palette-indexed. Style reference only; no third-party assets.
// Arms are drawn by the scene so they can animate; sprites hold head, torso and legs.
const HEAD = {
  neutral: ['..hhhhhh..', '.hhhhhhhh.', '.hssssssh.', '.hsessesh.', '.ssssssss.', '..ssmmss..'],
  focused: ['..hhhhhh..', '.hhhhhhhh.', '.hsssssth.', '.hsessesh.', '.ssssssss.', '..ssssss..'],
  happy:   ['..hhhhhh..', '.hhhhhhhh.', '.hssssssh.', '.hsessesh.', '.ssssssss.', '..smmmms..'],
  alarmed: ['..hhhhhh..', '.hhhhhhhh.', '.hssssssh.', '.hseesees.', '.ssssssss.', '..sxxxxs..'],
};
const BODY = ['..bbbbbb..', '.bbbbbbbb.', '.bbkbbkbb.', '.bbbbbbbb.', '.bbbbbbbb.', '..bbbbbb..', '..dd..dd..', '..dd..dd..', '.ddd..ddd.'];
const BASE = { s: '#e9c9a3', e: '#14171c', m: '#a4574f', x: '#3a1d1d', d: '#20242c', t: '#14171c' };
const LOOKS = {
  MANAGER:  { h: '#7a5a8c', b: '#b48ead', k: '#8f6f88' },
  ENGINEER: { h: '#4a3426', b: '#6aa9ff', k: '#4b83cc' },
  QA:       { h: '#2f2a24', b: '#5fd38d', k: '#3fa86b' },
};
// Per-engineer identity: hair colour + optional glasses, chosen by task id so eng 1 and eng 2 differ.
const HAIRS = ['#4a3426', '#c98a3c', '#1f1f28', '#a84f3a'];
const WALK = [['..dd..dd..', '.dd....dd.', 'dd......dd'], ['..dd..dd..', '..d....d..', '..dd..dd..']];
// Event-driven state -> face. Nothing here animates on its own.
const FACE = { failed: 'alarmed', rejected: 'alarmed', blocked: 'alarmed', done: 'happy', approved: 'happy', merged: 'happy', coding: 'focused', testing: 'focused', reviewing: 'focused', planning: 'focused' };

/** opts: { override: shirt colour, variant: engineer index, walk: 0|1 leg frame } */
export function drawSprite(g, x, y, role, state, override, opts = {}) {
  const look = { ...BASE, ...(LOOKS[role] ?? LOOKS.ENGINEER), g: '#0c0e12' };
  const v = opts.variant;
  if (v != null && role === 'ENGINEER') look.h = HAIRS[v % HAIRS.length];
  const head = [...HEAD[FACE[state] ?? 'neutral']];
  if (v != null && v % 2 === 1) head[3] = head[3].replace(/s(?=e)|(?<=e)s/g, 'g');
  const body = opts.walk == null ? BODY : [...BODY.slice(0, 6), ...WALK[opts.walk]];
  const rows = [...head, ...body];
  rows.forEach((row, j) => [...row].forEach((c, i) => {
    if (c === '.') return;
    g.fillStyle = c === 'b' && override ? override : look[c];
    g.fillRect(x + i, y + j, 1, 1);
  }));
}

/** Head-and-shoulders crop of the same world sprite, as a data URL. Panels show the exact character seen in the office. */
export function portraitURL(role, state, variant) {
  const c = document.createElement('canvas'); c.width = 10; c.height = 11;
  drawSprite(c.getContext('2d'), 0, 0, role, state, undefined, { variant });
  return c.toDataURL();
}
