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
// Event-driven state -> face. Nothing here animates on its own.
const FACE = { failed: 'alarmed', rejected: 'alarmed', blocked: 'alarmed', done: 'happy', approved: 'happy', merged: 'happy', coding: 'focused', testing: 'focused', reviewing: 'focused', planning: 'focused' };

export function drawSprite(g, x, y, role, state, override) {
  const look = { ...BASE, ...(LOOKS[role] ?? LOOKS.ENGINEER) };
  const rows = [...HEAD[FACE[state] ?? 'neutral'], ...BODY];
  rows.forEach((row, j) => [...row].forEach((c, i) => {
    if (c === '.') return;
    g.fillStyle = c === 'b' && override ? override : look[c];
    g.fillRect(x + i, y + j, 1, 1);
  }));
}
