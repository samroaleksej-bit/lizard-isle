// Живая карта: тени облаков, блики на море, светлячки и споры над джунглями, подсветка гекса под курсором,
// свечение вокруг партии, волны-пинги при открытиях.
import { MOD, island, getState, isIsle, hexCenter, hexRadius, hexVerts, hexAt } from "./isle.js";

const FX = { root: null, tick: null, clouds: [], glints: [], motes: [], pings: [], hover: null, aura: null, hoverKey: null, t: 0 };
const LAND_MOTES = { j: 0xc8ff6a, c: 0xc8ff6a, d: 0xa6e05a, g: 0xd9ffa0, T: 0xe8b6ff, s: 0x9cff9c, f: 0xff9ad0, u: 0xffe08a };

export const fxEnabled = () => { try { return game.settings.get(MOD, "fx"); } catch (e) { return true; } };

function canvasTex(size, draw) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  draw(cv.getContext("2d"), size);
  return PIXI.Texture.from(cv);
}
let TEX = null;
function textures() {
  if (TEX) return TEX;
  TEX = {
    dot: canvasTex(64, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.2, "rgba(255,255,255,.75)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }),
    star: canvasTex(64, (g, s) => {
      const c = s / 2;
      for (const [w, h] of [[s, 3], [3, s]]) {
        const gr = g.createRadialGradient(c, c, 0, c, c, c);
        gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr; g.fillRect(c - w / 2, c - h / 2, w, h);
      }
      const gr = g.createRadialGradient(c, c, 0, c, c, 10);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }),
    cloud: canvasTex(512, (g, s) => {
      const rnd = mulberry(7);
      for (let k = 0; k < 14; k++) {
        const x = s * (0.25 + rnd() * 0.5), y = s * (0.3 + rnd() * 0.4), r = s * (0.12 + rnd() * 0.16);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, "rgba(0,0,0,.55)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    })
  };
  return TEX;
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const hexR = () => hexRadius();
function randIn(r, c) {
  const p = hexCenter(r, c);
  const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * hexR() * 0.8;
  return { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
}

/* какие гексы годятся для эффекта; игроки видят эффекты только в исследованных гексах */
let pools = { sea: [], land: [] };
async function buildPools() {
  const I = await island();
  const st = getState();
  const known = game.user.isGM ? null : new Set(st.explored);
  pools = { sea: [], land: [] };
  I.RAW.forEach((row, r) => [...row].forEach((ch, c) => {
    if (known && !known.has(`${r},${c}`)) return;
    if (ch === "~" || ch === ",") pools.sea.push([r, c]);
    else if (LAND_MOTES[ch]) pools.land.push([r, c, LAND_MOTES[ch]]);
  }));
}

export async function startFX() {
  try { await _startFX(); } catch (e) { console.warn(`${MOD} | анимации выключены:`, e); stopFX(); }
}
async function _startFX() {
  stopFX();
  if (!fxEnabled() || !canvas?.ready || !isIsle()) return;
  _isl = await island();
  await buildPools();
  const T = textures();
  const root = new PIXI.Container();
  root.zIndex = -1000; root.eventMode = "none";
  FX.root = root;
  (canvas.interface ?? canvas.stage).addChildAt(root, 0);
  if (canvas.interface?.sortableChildren) canvas.interface.sortChildren();

  const R = canvas.dimensions.sceneRect;
  // тени облаков
  for (let k = 0; k < 7; k++) {
    const s = new PIXI.Sprite(T.cloud);
    s.anchor.set(0.5);
    s.width = R.width * (0.28 + Math.random() * 0.22); s.height = s.width * (0.55 + Math.random() * 0.25);
    s.x = R.x + Math.random() * R.width; s.y = R.y + Math.random() * R.height;
    s.alpha = 0.38 + Math.random() * 0.17;
    s._v = 8 + Math.random() * 10;
    root.addChild(s); FX.clouds.push(s);
  }
  // блики на воде
  const sz = hexR() * Math.sqrt(3);
  for (let k = 0; k < Math.min(170, pools.sea.length * 2); k++) {
    const s = new PIXI.Sprite(T.star);
    s.anchor.set(0.5); s.blendMode = PIXI.BLEND_MODES.ADD; s.alpha = 0;
    s._p = Math.random() * 6; s._sp = 0.6 + Math.random() * 0.8; s._sz = sz * (0.2 + Math.random() * 0.18);
    placeGlint(s); root.addChild(s); FX.glints.push(s);
  }
  // светлячки и споры
  for (let k = 0; k < Math.min(220, pools.land.length * 1.2); k++) {
    const s = new PIXI.Sprite(T.dot);
    s.anchor.set(0.5); s.blendMode = PIXI.BLEND_MODES.ADD;
    s._p = Math.random() * 10; s._sz = sz * (0.11 + Math.random() * 0.08);
    s.width = s.height = s._sz;
    placeMote(s); root.addChild(s); FX.motes.push(s);
  }
  // подсветка гекса и аура партии
  FX.hover = new PIXI.Graphics(); root.addChild(FX.hover);
  FX.aura = new PIXI.Graphics(); root.addChild(FX.aura);

  FX.tick = () => { try { step(canvas.app.ticker.deltaMS / 1000); } catch (e) { console.warn(`${MOD} | fx`, e); stopFX(); } };
  canvas.app.ticker.add(FX.tick);
}

function placeGlint(s) {
  const h = pools.sea[(Math.random() * pools.sea.length) | 0];
  if (!h) { s.visible = false; return; }
  const p = randIn(h[0], h[1]); s.x = p.x; s.y = p.y; s.visible = true;
  s.width = s.height = s._sz;
}
function placeMote(s) {
  const h = pools.land[(Math.random() * pools.land.length) | 0];
  if (!h) { s.visible = false; return; }
  const p = randIn(h[0], h[1]); s._x = p.x; s._y = p.y; s.tint = h[2]; s.visible = true;
  s._life = 6 + Math.random() * 8; s._age = 0;
}

function step(dt) {
  if (!FX.root || FX.root.destroyed) return;
  FX.t += dt;
  const t = FX.t, R = canvas.dimensions.sceneRect;
  for (const s of FX.clouds) {
    s.x += s._v * dt; s.y += s._v * 0.25 * dt;
    if (s.x - s.width / 2 > R.right) { s.x = R.x - s.width / 2; s.y = R.y + Math.random() * R.height; }
    if (s.y - s.height / 2 > R.bottom) s.y = R.y - s.height / 2;
  }
  for (const s of FX.glints) {
    const v = Math.sin(t * s._sp + s._p);
    s.alpha = v > 0.86 ? (v - 0.86) / 0.14 * 0.9 : 0;
    s.rotation = t * 0.3 + s._p;
    if (v < -0.99 && Math.random() < 0.05) placeGlint(s);
  }
  for (const s of FX.motes) {
    s._age += dt;
    if (s._age > s._life) placeMote(s);
    const k = s._age / s._life;
    s.x = s._x + Math.sin(t * 0.7 + s._p) * 18 + Math.sin(t * 0.23 + s._p * 2) * 26;
    s.y = s._y + Math.cos(t * 0.5 + s._p) * 14 - k * 30;
    s.alpha = Math.min(1, Math.sin(k * Math.PI) * 1.4) * (0.6 + 0.4 * Math.sin(t * 3 + s._p * 5));
  }
  // аура партии
  const g = FX.aura; g.clear();
  const tok = canvas.tokens?.get(canvas.scene?.getFlag(MOD, "state")?.party);
  if (tok) {
    const r0 = hexR() * 0.95, pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    g.lineStyle(4, 0xffd27a, 0.35 + 0.35 * pulse).drawCircle(tok.center.x, tok.center.y, r0 * (1 + 0.06 * pulse));
    g.lineStyle(10, 0xffd27a, 0.08 + 0.08 * pulse).drawCircle(tok.center.x, tok.center.y, r0 * 1.12);
  }
  // подсветка гекса
  if (FX.hover && FX.hoverPoly) {
    const a = 0.75 + 0.25 * Math.sin(t * 4);
    FX.hover.clear().beginFill(0xffe2a0, 0.13).lineStyle(6, 0xffd27a, a).drawPolygon(FX.hoverPoly).endFill();
  }
  // пинги
  for (let i = FX.pings.length - 1; i >= 0; i--) {
    const p = FX.pings[i];
    p.age += dt;
    p.g.clear();
    let alive = false;
    for (let k = 0; k < 3; k++) {
      const a = (p.age - k * 0.35) / 1.6;
      if (a < 0 || a > 1) { if (a < 0) alive = true; continue; }
      alive = true;
      p.g.lineStyle(6 * (1 - a) + 1, p.color, 1 - a).drawCircle(p.x, p.y, hexR() * (0.3 + a * 1.6));
    }
    if (!alive) { p.g.destroy(); FX.pings.splice(i, 1); }
  }
}

export function stopFX() {
  if (FX.tick) canvas?.app?.ticker?.remove(FX.tick);
  FX.tick = null;
  if (FX.root && !FX.root.destroyed) FX.root.destroy({ children: true });
  Object.assign(FX, { root: null, clouds: [], glints: [], motes: [], pings: [], hover: null, aura: null, hoverPoly: null, hoverKey: null });
}

export async function refreshPools() { if (FX.root) await buildPools(); }

/* подсветка гекса под курсором */
export function hoverAt(clientX, clientY) {
  if (!FX.root || !ISL()) return;
  const p = canvas.canvasCoordinatesFromClient({ x: clientX, y: clientY });
  const h = hexAt(p);
  const o = { i: h.r, j: h.c };
  const key = `${o.i},${o.j}`;
  if (key === FX.hoverKey) return;
  FX.hoverKey = key;
  const I = ISL();
  if (o.i < 0 || o.j < 0 || o.i >= I.RAW.length || o.j >= I.RAW[0].length) { FX.hoverPoly = null; FX.hover?.clear(); return; }
  const verts = hexVerts(o.i, o.j);
  FX.hoverPoly = verts.flatMap((v) => [v.x, v.y]);
}
let _isl = null;
const ISL = () => _isl;

/* волна-пинг на гексе */
export function pingHex(r, c, color = "#ffd27a") {
  if (!FX.root) return;
  const p = hexCenter(r, c);
  const g = new PIXI.Graphics(); FX.root.addChild(g);
  FX.pings.push({ g, x: p.x, y: p.y, age: 0, color: Number(String(color).replace("#", "0x")) || 0xffd27a });
}

/* погода Foundry по броску дня */
export function weatherFor(text) {
  const t = String(text).toLowerCase();
  const want = t.includes("шторм") ? "rainStorm" : t.includes("ливень") ? "rain" : t.includes("туман") ? "fog" : "";
  if (want && !CONFIG.weatherEffects?.[want]) return "";
  return want;
}
