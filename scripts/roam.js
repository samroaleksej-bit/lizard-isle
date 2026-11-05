/* Бродячие боссы: Пожиратель троп и Речной левиафан ходят по острову вместе с партией. */
const MOD = "lizard-isle";
export const ROAMERS = {
  eater: { name: "Пожиратель троп", icon: "🐍", start: [10, 15], terr: "jd", color: "#7a8a3a",
    near: "Тропа под ногами вздрагивает. Камешки сами катятся куда-то в сторону.",
    meet: "Тропа, по которой вы идёте, начинает дышать." },
  lev: { name: "Речной левиафан", icon: "🌊", start: [15, 15], terr: "r,", color: "#2f6f8f",
    near: "Река идёт волной против течения. Рыба выпрыгивает на берег.",
    meet: "Вода вздувается горбом прямо у берега." }
};
const odd = (r) => ((r % 2) + 2) % 2;
const cube = (r, c) => { const x = c - (r - odd(r)) / 2, z = r; return [x, -x - z, z]; };
export const hexDist = (a, b) => { const p = cube(...a), q = cube(...b); return Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2])); };
const nb = (r, c) => { const o = odd(r); return [[r, c - 1], [r, c + 1], [r - 1, c - 1 + o], [r - 1, c + o], [r + 1, c - 1 + o], [r + 1, c + o]]; };

export function initRoam(st) {
  st.roam ??= {};
  for (const [k, R] of Object.entries(ROAMERS)) st.roam[k] ??= { r: R.start[0], c: R.start[1], on: true };
  return st.roam;
}

/** Один шаг бродяг после шага партии. Возвращает подсказки для мастера и для всех. */
export function stepRoam(I, st, party, coord) {
  initRoam(st);
  const gm = [], pub = [];
  for (const [k, R] of Object.entries(ROAMERS)) {
    const m = st.roam[k]; if (!m.on) continue;
    const ok = ([r, c]) => r >= 0 && r < I.RAW.length && c >= 0 && c < I.RAW[0].length && R.terr.includes(I.RAW[r][c]);
    const opts = nb(m.r, m.c).filter(ok);
    if (opts.length) {
      const d0 = hexDist([m.r, m.c], party);
      let next;
      if (d0 <= 4 && Math.random() < 0.6) next = opts.sort((a, b) => hexDist(a, party) - hexDist(b, party))[0];   // учуял — идёт к партии
      else if (Math.random() < 0.7) next = opts[Math.floor(Math.random() * opts.length)];                          // бродит
      if (next) { m.r = next[0]; m.c = next[1]; }
    }
    const d = hexDist([m.r, m.c], party), at = coord(I, m.r, m.c);
    if (d === 0) gm.push({ k, combat: true, text: `${R.icon} <b>${R.name} настиг партию</b> в ${at}! ${R.meet}` });
    else if (d === 1) { gm.push({ k, text: `${R.icon} ${R.name} рядом, ${at}` }); pub.push({ k, text: R.near }); }
    else gm.push({ k, text: `<span class="mute">${R.icon} ${R.name}: ${at}, до партии ${d}</span>` });
  }
  return { gm, pub };
}

/** Метки бродяг на карте — скрытые рисунки, видит только мастер. */
export async function drawRoam(scene, st, hexCenter, hexRadius) {
  initRoam(st);
  for (const [k, R] of Object.entries(ROAMERS)) {
    const m = st.roam[k], p = hexCenter(m.r, m.c), w = Math.round(hexRadius() * 1.6), h = 44;
    const data = { x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), shape: { type: "r", width: w, height: h }, hidden: true,
      fillType: CONST.DRAWING_FILL_TYPES.SOLID, fillColor: R.color, fillAlpha: 0.75, strokeWidth: 2, strokeColor: "#000000",
      text: `${R.icon} ${R.name}${m.on ? "" : " (убит)"}`, fontSize: 20, textColor: "#ffffff", flags: { [MOD]: { roam: k } } };
    const d = scene.drawings.find((x) => x.getFlag(MOD, "roam") === k);
    try { if (d) await d.update({ x: data.x, y: data.y, text: data.text, hidden: true }); else await scene.createEmbeddedDocuments("Drawing", [data]); } catch (e) { console.warn(e); }
  }
}
