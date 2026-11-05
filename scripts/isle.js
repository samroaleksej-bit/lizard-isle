// Скрытые земли · Остров — интерактивный гекс-краул для Foundry VTT v13/v14.
import { openBook, toggleBook, refreshBook, logEntry, toast } from "./book.js";
import { buildLabyrinth } from "./labyrinth.js";
import { buildEcho } from "./echo.js";
import { buildTables, hasTables, rollHex } from "./tables.js";
import { registerCalendar, parts, fmtDate, setDate } from "./calendar.js";
import { ROAMERS, initRoam, stepRoam, drawRoam } from "./roam.js";
import { Board, registerBoard, applyOp } from "./board.js";
import { startFX, stopFX, refreshPools, hoverAt, pingHex, weatherFor } from "./fx.js";

export const MOD = "lizard-isle";
export const ROOT = `modules/${MOD}`;
const DIARY_NAME = "Дневник экспедиции";
const MARKS = [["⛺", "Лагерь"], ["👣", "Следы"], ["⚠️", "Опасно"], ["💧", "Вода"], ["❓", "Загадка"], ["⭐", "Важное"], ["💀", "Смерть"]];

let ISLAND = null;
let CONTENT = null;

/* ---------------- данные ---------------- */
export async function island() {
  if (!ISLAND) ISLAND = await (await fetch(`${ROOT}/data/island.json`)).json();
  return ISLAND;
}
async function content() {
  if (!CONTENT) CONTENT = await (await fetch(`${ROOT}/data/content.json`)).json();
  return CONTENT;
}
export const isIsle = (scene = canvas?.scene) => !!scene?.getFlag(MOD, "isle");
export const activeGM = () => game.users.activeGM?.isSelf ?? game.user.isGM;
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

export function getState(scene = canvas.scene) {
  const s = scene?.getFlag(MOD, "state") ?? {};
  return { day: 1, hours: 0, explored: [], revealed: [], party: null, lastHex: null, diaryId: null, quests: {}, rep: {}, log: [], ...foundry.utils.deepClone(s) };
}
export async function saveState(state, scene = canvas.scene) {
  // все ключи состояния всегда на месте, массивы при слиянии заменяются целиком
  await scene.setFlag(MOD, "state", state);
}

/* волна на гексе у всех игроков */
export function pulseHex(r, c, color = "#ffd27a", broadcast = true) {
  pingHex(r, c, color);
  if (broadcast) game.socket.emit(`module.${MOD}`, { action: "pulse", sceneId: canvas.scene?.id, r, c, color });
}

/* ---------------- гексы: своя геометрия по картинке ----------------
   Карта нарисована под гексы с острой вершиной: ширина гекса W = 140 px картинки, нечётные ряды сдвинуты на W/2.
   Сетку Foundry не используем (сцена без сетки) — так карта и логика всегда совпадают. */
const GW = 140, GR = GW / Math.sqrt(3), IMG_W = 3990, IMG_H = 2587;
function frame() {
  const d = canvas.dimensions;
  const R = d?.sceneRect ?? { x: d?.sceneX ?? 0, y: d?.sceneY ?? 0, width: d?.sceneWidth ?? IMG_W, height: d?.sceneHeight ?? IMG_H };
  return { x: R.x, y: R.y, k: R.width / IMG_W, ky: R.height / IMG_H };
}
export function hexCenter(r, c) {
  const f = frame();
  return { x: f.x + (c * GW + GW / 2 + (r % 2 ? GW / 2 : 0)) * f.k, y: f.y + (GR + r * 1.5 * GR) * f.ky };
}
export function hexRadius() { return GR * frame().k; }
export function hexVerts(r, c) {
  const p = hexCenter(r, c), f = frame();
  return [...Array(6)].map((_, i) => ({ x: p.x + GR * f.k * Math.cos((60 * i - 30) * Math.PI / 180), y: p.y + GR * f.ky * Math.sin((60 * i - 30) * Math.PI / 180) }));
}
export function hexAt(point) {
  const f = frame();
  const x = (point.x - f.x) / f.k, y = (point.y - f.y) / f.ky;
  const r0 = Math.round((y - GR) / (1.5 * GR));
  let best = { r: r0, c: 0 }, bd = Infinity;
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    const c0 = Math.round((x - GW / 2 - (r % 2 ? GW / 2 : 0)) / GW);
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      const cx = c * GW + GW / 2 + (Math.abs(r) % 2 ? GW / 2 : 0), cy = GR + r * 1.5 * GR;
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) { bd = d; best = { r, c }; }
    }
  }
  return best;
}
function hexLine(fr, fc, tr, tc) {
  const a = hexCenter(fr, fc), b = hexCenter(tr, tc);
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (hexRadius() * 0.5)));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const h = hexAt({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n });
    if (!out.length || out.at(-1)[0] !== h.r || out.at(-1)[1] !== h.c) out.push([h.r, h.c]);
  }
  return out;
}
function inMap(I, r, c) {
  return r >= 0 && r < I.RAW.length && c >= 0 && c < I.RAW[0].length;
}
export const hkey = (r, c) => `${r},${c}`;
export const coord = (I, r, c) => `${I.ROWS[r]}-${c + 1}`;
function neighbors(r, c) {
  const odd = r % 2 ? 1 : 0;
  return [[r, c - 1], [r, c + 1], [r - 1, c - 1 + odd], [r - 1, c + odd], [r + 1, c - 1 + odd], [r + 1, c + odd]];
}
function chanceText(t) {
  return t.d === 0 ? "встреч нет" : t.d === 1 ? "встреча на 1 из к6" : "встреча на 1–2 из к6";
}

/* ---------------- импорт сцены и журналов ---------------- */
/* Подгонка карты под сетку. Картинка нарисована так: центр гекса (ряд 0, столбец 0) в (W/2, R),
   шаг по столбцам W, по рядам 1.5R, нечётные ряды сдвинуты на W/2. Меряем, как Foundry реально
   ставит центры гексов, и кладём карту тайлом с нужным масштабом и сдвигом. */
async function liveFit() { /* больше не нужно: сцена без сетки, карта — фон */ }

async function importIsland() {
  if (!game.user.isGM) return;
  const C = await content();
  ui.notifications.info("Остров: импортирую сцену и журналы…");
  const folderFor = async (type) => game.folders.find((f) => f.type === type && f.name === C.folder)
    ?? await Folder.create({ name: C.folder, type, color: "#2f7a5b" });
  const jFolder = await folderFor("JournalEntry");
  const sFolder = await folderFor("Scene");

  const ids = {};
  for (const j of C.journals) {
    const pages = j.pages.map((p, i) => ({ name: p.name, type: "text", sort: (i + 1) * 1000,
      title: { show: true, level: 1 }, text: { format: 1, content: p.html } }));
    let entry = game.journal.find((e) => e.name === j.name && e.folder?.id === jFolder.id);
    if (entry) {
      await entry.deleteEmbeddedDocuments("JournalEntryPage", entry.pages.map((p) => p.id));
      await entry.createEmbeddedDocuments("JournalEntryPage", pages);
    } else {
      entry = await JournalEntry.create({ name: j.name, folder: jFolder.id, pages });
    }
    const byName = new Map(entry.pages.contents.map((p) => [p.name, p.id]));
    for (const p of j.pages) ids[`${j.key}/${p.key}`] = { entryId: entry.id, pageId: byName.get(p.name) };
  }

  // дневник для игроков
  let diary = game.journal.find((e) => e.name === DIARY_NAME && e.folder?.id === jFolder.id);
  if (!diary) diary = await JournalEntry.create({ name: DIARY_NAME, folder: jFolder.id,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER } });

  const S = C.scene;
  const notes = C.notes.map((n) => {
    const ref = ids[`${n.journal}/${n.page}`] ?? {};
    return { entryId: ref.entryId, pageId: ref.pageId, _x: n.x, _y: n.y, text: n.label,
      texture: { src: n.icon, tint: n.tint }, iconSize: 40, fontSize: 22,
      textAnchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM, global: false, flags: { [MOD]: { gm: true } } };
  });
  const sceneData = {
    name: S.name, folder: sFolder.id, navigation: true,
    background: { src: `${ROOT}/assets/island-map-hd.webp` }, width: S.width, height: S.height, padding: 0,
    backgroundColor: "#173a49",
    grid: { type: CONST.GRID_TYPES.GRIDLESS, size: S.gridSize, distance: 1, units: "гекс", alpha: 0 },
    tokenVision: true, fog: { exploration: true },
    environment: { globalLight: { enabled: true }, darknessLevel: 0 },
    initial: { x: Math.round(S.start[0]), y: Math.round(S.start[1]), scale: 0.6 },
    flags: { [MOD]: { isle: true } }
  };
  let scene = game.scenes.find((s) => s.getFlag(MOD, "isle")) ?? game.scenes.find((s) => s.name === S.name);
  if (scene) await scene.update(sceneData);
  else scene = await Scene.create(sceneData);
  // старый тайл карты из прошлых версий больше не нужен
  const oldTiles = scene.tiles.filter((t) => t.getFlag(MOD, "map")).map((t) => t.id);
  if (oldTiles.length) await scene.deleteEmbeddedDocuments("Tile", oldTiles);
  const d = scene.dimensions ?? {};
  const ox = d.sceneX ?? d.sceneRect?.x ?? 0, oy = d.sceneY ?? d.sceneRect?.y ?? 0;
  const tf = { ox, oy, sx: 1, sy: 1 };
  const placed = notes.map(({ _x, _y, ...n }) => ({ ...n, x: Math.round(tf.ox + _x), y: Math.round(tf.oy + _y) }));
  const old = scene.notes.filter((n) => n.getFlag(MOD, "gm")).map((n) => n.id);
  if (old.length) await scene.deleteEmbeddedDocuments("Note", old);
  await scene.createEmbeddedDocuments("Note", placed);
  await scene.update({ initial: { x: Math.round(tf.ox + S.start[0] * tf.sx), y: Math.round(tf.oy + S.start[1] * tf.sy), scale: 0.6 } });
  const st = getState(scene);
  st.diaryId = diary.id;
  if (!st.explored.length) st.explored = ["18,14", "18,15", "17,14", "17,15", "19,14", "19,15", "18,13", "18,16"];
  await saveState(st, scene);
  await scene.view();
  ui.notifications.info(`Остров готов: ${C.journals.length} журналов, ${notes.length} пинов мастера.`);
}

/* ---------------- карточка гекса ---------------- */
let cardEl = null;
function closeCard() { cardEl?.remove(); cardEl = null; }

async function showCard(clientX, clientY, r, c) {
  const I = await island();
  closeCard();
  const st = getState();
  const k = hkey(r, c);
  const ch = I.RAW[r][c];
  const t = I.T[ch];
  const known = game.user.isGM || st.explored.includes(k);
  let body;
  if (ch === "~") {
    body = `<h3>${coord(I, r, c)} · Море</h3><p>${esc(t.note)}</p>`;
  } else if (!known) {
    body = `<h3>${coord(I, r, c)} · Неизведанные земли</h3><p class="mute">Партия сюда ещё не добиралась.</p>`;
  } else {
    const found = st.revealed.filter((x) => x.at[0] === r && x.at[1] === c);
    const marks = canvas.scene.drawings.filter((d) => d.getFlag(MOD, "mark") && sameHex(d, r, c));
    body = `<h3>${coord(I, r, c)} · ${esc(t.n)}</h3>
      <div class="isle-chips"><span>⏱ ${t.h} ч на гекс</span><span>⚔ ${chanceText(t)}</span>${st.explored.includes(k) ? "" : "<span class='gm'>не исследован</span>"}</div>
      <p>${esc(t.note)}</p>
      ${found.length ? `<h4>Найдено здесь</h4><ul>${found.map((x) => `<li><a data-page="${x.pageId}">${esc(x.name)}</a></li>`).join("")}</ul>` : ""}
      ${marks.length ? `<h4>Отметки</h4><ul>${marks.map((m) => `<li>${esc(m.text)} <span class="mute">— ${esc(game.users.get(m.getFlag(MOD, "by"))?.name ?? "")}</span>${(game.user.isGM || m.getFlag(MOD, "by") === game.user.id) ? ` <a class="del" data-del="${m.id}" title="Убрать">✕</a>` : ""}</li>`).join("")}</ul>` : ""}`;
    if (game.user.isGM) {
      const here = I.gmHere[k] ?? [];
      body += `<div class="isle-gm"><h4>Только мастеру</h4>${here.length ? `<ul>${here.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "<p class='mute'>Ничего особого.</p>"}
        <button data-act="explore">${st.explored.includes(k) ? "Скрыть гекс от игроков" : "Отметить исследованным"}</button></div>`;
    }
  }
  body += `<p class="isle-hint">Shift + двойной клик — поставить отметку</p>`;
  cardEl = document.createElement("div");
  cardEl.className = "isle-card";
  cardEl.innerHTML = `<a class="isle-x" title="Закрыть">✕</a>${body}`;
  document.body.appendChild(cardEl);
  const w = 320;
  cardEl.style.left = `${Math.min(clientX + 14, window.innerWidth - w - 10)}px`;
  cardEl.style.top = `${Math.min(clientY + 14, window.innerHeight - cardEl.offsetHeight - 10)}px`;
  cardEl.querySelector(".isle-x").onclick = closeCard;
  cardEl.querySelectorAll("[data-page]").forEach((a) => a.onclick = () => openDiaryPage(a.dataset.page));
  cardEl.querySelectorAll("[data-del]").forEach((a) => a.onclick = () => { removeMark(a.dataset.del); closeCard(); });
  cardEl.querySelector("[data-act=explore]")?.addEventListener("click", async () => {
    const s = getState();
    s.explored = s.explored.includes(k) ? s.explored.filter((x) => x !== k) : [...s.explored, k];
    await saveState(s); closeCard();
  });
}

function sameHex(drawing, r, c) {
  const p = { x: drawing.x + (drawing.shape?.width ?? 0) / 2, y: drawing.y + (drawing.shape?.height ?? 0) / 2 };
  const h = hexAt(p);
  return h.r === r && h.c === c;
}

export function openDiaryPage(pageId) {
  const diary = game.journal.get(getState().diaryId);
  if (!diary) return;
  diary.sheet.render(true);
  setTimeout(() => { try { diary.sheet.goToPage?.(pageId); } catch (e) {} }, 350);
}

/* ---------------- отметки игроков ---------------- */
async function markDialog(point) {
  const D2 = foundry.applications.api.DialogV2;
  const opts = MARKS.map(([e, n], i) => `<label class="isle-mk"><input type="radio" name="ic" value="${i}" ${i === 0 ? "checked" : ""}> ${e} ${n}</label>`).join("");
  const res = await D2.prompt({
    window: { title: "Отметка на карте" },
    content: `<div class="isle-mks">${opts}</div><p><input type="text" name="txt" placeholder="Подпись (необязательно)" maxlength="40" style="width:100%"></p>`,
    ok: { label: "Поставить", callback: (ev, btn) => ({ ic: Number(btn.form.elements.ic.value), txt: btn.form.elements.txt.value.trim() }) },
    rejectClose: false
  });
  if (!res) return;
  const [emoji, name] = MARKS[res.ic];
  const text = `${emoji} ${res.txt || name}`;
  const data = markData(point, text, game.user);
  if (game.user.isGM || game.user.can("DRAWING_CREATE")) await canvas.scene.createEmbeddedDocuments("Drawing", [data]);
  else game.socket.emit(`module.${MOD}`, { action: "mark", sceneId: canvas.scene.id, data });
}

function markData(point, text, user) {
  const w = Math.max(90, 16 * [...text].length + 20), h = 40;
  return {
    author: user.id, x: Math.round(point.x - w / 2), y: Math.round(point.y - h / 2),
    shape: { type: "r", width: w, height: h },
    fillType: CONST.DRAWING_FILL_TYPES.SOLID, fillColor: user.color?.css ?? String(user.color ?? "#2f7a5b"), fillAlpha: 0.6,
    strokeWidth: 2, strokeColor: "#000000", strokeAlpha: 0.8,
    text, fontSize: 22, textColor: "#ffffff",
    flags: { [MOD]: { mark: true, by: user.id } }
  };
}

function removeMark(id) {
  const d = canvas.scene.drawings.get(id);
  if (!d) return;
  if (d.canUserModify(game.user, "delete")) d.delete();
  else game.socket.emit(`module.${MOD}`, { action: "unmark", sceneId: canvas.scene.id, id, userId: game.user.id });
}

/* ---------------- путешествие ---------------- */
async function onTokenMoved(doc, changes) {
  if (!activeGM() || !isIsle(doc.parent)) return;
  if (!("x" in changes || "y" in changes)) return;
  const st = getState(doc.parent);
  if (st.party !== doc.id) return;
  const I = await island();
  const gs = canvas.dimensions?.size ?? canvas.grid.size;
  const center = { x: (changes.x ?? doc.x) + (doc.width * gs) / 2, y: (changes.y ?? doc.y) + (doc.height * gs) / 2 };
  const to = hexAt(center);
  if (!inMap(I, to.r, to.c)) return;
  const toKey = hkey(to.r, to.c);
  if (st.lastHex === toKey) return;

  // путь через промежуточные гексы
  let path = [[to.r, to.c]];
  if (st.lastHex) {
    const [fr, fc] = st.lastHex.split(",").map(Number);
    path = hexLine(fr, fc, to.r, to.c).slice(1);
  }

  const lines = [], combats = [], publics = [], roamHits = [], roamSigns = [];
  let addHours = 0;
  const explored = new Set(st.explored);
  for (const [r, c] of path) {
    if (!inMap(I, r, c)) continue;
    const ch = I.RAW[r][c], t = I.T[ch];
    explored.add(hkey(r, c));
    for (const [nr, nc] of neighbors(r, c)) if (inMap(I, nr, nc)) explored.add(hkey(nr, nc));
    if (ch === "~") { lines.push(`<li><b>${coord(I, r, c)} · Море.</b> Без лодки не пройти.</li>`); continue; }
    const before = st.hours;
    st.hours += t.h; addHours += t.h;
    let enc = "";
    if (t.d > 0 && hasTables() && game.settings.get(MOD, "autoRoll")) {
      const rh = await rollHex(ch, `${coord(I, r, c)} · ${t.n}`);
      if (rh) {
        enc = `<br>${rh.gm}`;
        if (rh.combat) combats.push(rh);
        if (rh.pub) publics.push(rh);
      }
    } else if (t.d > 0) {
      const d6 = await new Roll("1d6").evaluate();
      if (d6.total <= t.d && I.ENC[ch]) {
        const d8 = await new Roll("1d8").evaluate();
        enc = `<br>⚔ <b>Встреча!</b> к6 = ${d6.total}, к8 = ${d8.total}: ${esc(I.ENC[ch][d8.total - 1])}`;
      } else enc = `<br><span class="mute">к6 = ${d6.total}, встречи нет</span>`;
    }
    let roamTxt = "";
    if (game.settings.get(MOD, "roam")) {
      const rr = stepRoam(I, st, [r, c], coord);
      roamTxt = rr.gm.map((g) => `<br>${g.text}`).join("");
      for (const g of rr.gm) if (g.combat) roamHits.push(g);
      for (const p of rr.pub) roamSigns.push(p);
    }
    const here = I.gmHere[hkey(r, c)];
    const tired = before <= 8 && st.hours > 8 ? `<br>😓 <b>Больше 8 часов в пути:</b> Тел СЛ 12 от истощения или разбить лагерь.` : "";
    lines.push(`<li><b>${coord(I, r, c)} · ${esc(t.n)}</b> (+${t.h} ч)${ch === "r" ? `<br>🌊 ${esc(t.note)}` : ""}${enc}${here ? `<br>📌 ${here.map(esc).join("; ")}` : ""}${roamTxt}${tired}</li>`);
  }
  const land = path.filter(([r, c]) => inMap(I, r, c) && I.RAW[r][c] !== "~");
  if (land.length) {
    const from = st.lastHex ? st.lastHex.split(",").map(Number) : null;
    const kinds = [...new Set(land.map(([r, c]) => I.T[I.RAW[r][c]].n))].join(", ");
    logEntry(st, `Переход${from ? ` ${coord(I, from[0], from[1])} →` : ""} ${coord(I, to.r, to.c)}: ${kinds}. В пути ${st.hours} ч.`, "move");
  }
  st.explored = [...explored];
  st.lastHex = toKey;
  await saveState(st, doc.parent);
  if (!lines.length) return;
  ChatMessage.create({
    speaker: { alias: "Остров" },
    whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
    content: `<div class="isle-chat"><h3>День ${st.day} · ${st.hours} ч в пути</h3><ul>${lines.join("")}</ul></div>`
  });
  // игровое время (Simple Timekeeping и любой календарь читают game.time.worldTime)
  if (addHours && game.settings.get(MOD, "timeSync")) { try { await game.time.advance(addHours * 3600); } catch (e) { console.warn(e); } }
  if (game.settings.get(MOD, "roam")) await drawRoam(doc.parent, st, hexCenter, hexRadius);
  for (const g of roamHits) ui.notifications.error(g.text.replace(/<[^>]+>/g, ""), { permanent: true });
  for (const p of [...new Map(roamSigns.map((x) => [x.k, x])).values()]) {
    ChatMessage.create({ speaker: { alias: "Остров" }, content: `<div class="isle-chat"><h3>Что-то не так</h3><p>${esc(p.text)}</p></div>` });
    toast({ title: "Что-то рядом", sub: p.text, color: "#5a4a1c", icon: "👁" }, true);
  }
  // бой — только мастеру; остальное — всем
  for (const r of combats) {
    ui.notifications.warn(`⚔ Бой! ${r.where}: ${r.text}`, { permanent: true });
  }
  for (const r of publics) {
    const TITLE = { talk: "Встреча в пути", loot: "Находка", hazard: "Опасность", omen: "Знак", faction: "Встреча" };
    ChatMessage.create({ speaker: { alias: "Остров" }, content: `<div class="isle-chat"><h3>${TITLE[r.kind] ?? "В пути"} · ${esc(r.where)}</h3><p>${r.pub}</p></div>` });
    toast({ title: TITLE[r.kind] ?? "В пути", sub: r.text.length > 90 ? r.text.slice(0, 88) + "…" : r.text, color: r.kind === "hazard" ? "#a3242c" : "#2f7a5b", icon: { talk: "👣", loot: "🎁", hazard: "⚠", omen: "👁", faction: "⚑" }[r.kind] ?? "📜" }, true);
  }
}

async function dateDialog() {
  const st = getState(), p = parts(), cal = game.time.calendar;
  const months = (cal?.months?.values ?? []).map((m, i) => `<option value="${i}" ${p && p.month === i ? "selected" : ""}>${esc(m.name)}</option>`).join("");
  const res = await foundry.applications.api.DialogV2.prompt({
    window: { title: "День экспедиции и дата" },
    content: `<p><label>День экспедиции <input type="number" name="day" min="1" value="${st.day}" style="width:80px"></label></p>
      <p><label>Часов в пути сегодня <input type="number" name="hours" min="0" value="${st.hours}" style="width:80px"></label></p>
      <hr><p><b>Дата мира</b> (её видит Simple Timekeeping)</p>
      <p><label>Число <input type="number" name="d" min="1" max="31" value="${p?.date ?? 1}" style="width:60px"></label>
         <select name="m">${months}</select>
         <label>год <input type="number" name="y" value="${p?.year ?? 1279}" style="width:80px"></label>
         <label>час <input type="number" name="h" min="0" max="23" value="${p?.hour ?? 6}" style="width:60px"></label></p>`,
    ok: { label: "Сохранить", callback: (ev, btn) => { const f = btn.form.elements; return { day: +f.day.value, hours: +f.hours.value, d: +f.d.value, m: +f.m.value, y: +f.y.value, h: +f.h.value }; } },
    rejectClose: false
  });
  if (!res) return;
  st.day = Math.max(1, res.day || 1); st.hours = Math.max(0, res.hours || 0);
  await saveState(st);
  if (cal && (!p || p.year !== res.y || p.month !== res.m || p.date !== res.d || p.hour !== res.h)) {
    try { await setDate({ year: res.y, month: res.m, day: res.d, hour: res.h }); } catch (e) { ui.notifications.warn("Дату мира поменять не вышло: " + e.message); }
  }
  updateClock();
}

async function newDay() {
  const I = await island();
  const st = getState();
  st.day += 1; st.hours = 0;
  if (game.settings.get(MOD, "timeSync")) {
    try {
      const comp = game.time.calendar?.timeToComponents?.(game.time.worldTime) ?? game.time.components;
      const h = comp?.hour ?? 0, m = comp?.minute ?? 0, sec = comp?.second ?? 0;
      let toDawn = ((24 + 6 - h) % 24) * 3600 - m * 60 - sec;
      if (toDawn <= 0) toDawn += 24 * 3600;
      await game.time.advance(toDawn);
    } catch (e) { try { await game.time.advance(24 * 3600); } catch (e2) {} }
  }
  const roll = await new Roll("1d6").evaluate();
  const w = I.WEATHER[roll.total - 1];
  logEntry(st, `Рассвет. Погода: ${w.split(":")[0]}.`, "day");
  await saveState(st);
  try { await canvas.scene.update({ weather: weatherFor(w) }); } catch (e) {}
  toast({ title: `День ${st.day}`, sub: w.split(":")[0], color: "#c98a1e", icon: "☀", tab: "chronicle" }, true);
  await ChatMessage.create({ speaker: { alias: "Остров" },
    content: `<div class="isle-chat"><h3>☀ День ${st.day}</h3><p>Погода (к6 = ${roll.total}): <b>${esc(w)}</b></p></div>` });
  await ChatMessage.create({ speaker: { alias: "Остров" }, whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
    content: `<div class="isle-chat"><p>Напоминание: вода — Выживание СЛ 10 (джунгли) / СЛ 14 (болото, топи). Ночёвка без укрытия — ещё одна проверка встречи. 3 дня без укрытия — портится одна вещь.</p></div>` });
}

/* ---------------- раздатки (арт находок) ---------------- */
export const handoutSrc = (item) => item?.img ? `${ROOT}/assets/${item.img}` : null;
/* показать раздатку: оверлей у всех (broadcast) или только у себя */
export function showHandout(item, broadcast = false) {
  const src = handoutSrc(item); if (!src) return;
  const data = { src, name: item.name, sub: item.group ?? "" };
  presentHandout(data);
  if (broadcast && game.user.isGM) {
    game.socket.emit(`module.${MOD}`, { action: "handout", data });
    ChatMessage.create({ speaker: { alias: "Находка" },
      content: `<div class="isle-chat isle-hchat"><h3>✦ ${esc(item.name)}</h3><img src="${src}" data-hsrc="${src}" data-hname="${esc(item.name)}"></div>` });
  }
}
export function presentHandout({ src, name, sub }) {
  document.getElementById("isle-handout")?.remove();
  const el = document.createElement("div");
  el.id = "isle-handout";
  el.innerHTML = `<div class="ih-card"><small>${esc(sub || "Находка")}</small><img src="${src}" draggable="false"><b>${esc(name)}</b><i>клик — закрыть</i></div>`;
  const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 350); removeEventListener("keydown", key); };
  const key = (e) => { if (e.key === "Escape") close(); };
  el.onclick = close; addEventListener("keydown", key);
  document.body.append(el);
}

/* ---------------- открыть игрокам ---------------- */
async function revealItem(item) {
  const st = getState();
  const diary = game.journal.get(st.diaryId);
  if (!diary) return ui.notifications.error("Нет «Дневника экспедиции». Запусти импорт острова в панели.");
  const D2 = foundry.applications.api.DialogV2;
  const res = await D2.prompt({
    window: { title: `Открыть игрокам: ${item.name}` },
    content: `${handoutSrc(item) ? `<p><img src="${handoutSrc(item)}" style="width:100%;max-height:220px;object-fit:contain;border:0"></p>
      <p><label><input type="checkbox" name="sh" checked> Сразу показать картинку игрокам</label></p>` : ""}<p><label>Название для игроков<br><input type="text" name="nm" value="${esc(item.name)}" style="width:100%"></label></p>
      <p><label>Что узнают игроки<br><textarea name="tx" rows="5" style="width:100%">${esc(item.text)}</textarea></label></p>
      <p class="hint">Здесь нет твоих спойлеров — только то, что ты впишешь.</p>`,
    ok: { label: "Открыть", callback: (ev, btn) => ({ nm: btn.form.elements.nm.value.trim() || item.name, tx: btn.form.elements.tx.value.trim(), sh: !!btn.form.elements.sh?.checked }) },
    rejectClose: false
  });
  if (!res) return;
  const I = await island();
  const [page] = await diary.createEmbeddedDocuments("JournalEntryPage", [{ name: res.nm, type: "text", title: { show: true, level: 1 },
    text: { format: 1, content: `<p><em>${coord(I, item.at[0], item.at[1])} · День ${st.day}</em></p>${handoutSrc(item) ? `<p><img src="${handoutSrc(item)}" style="max-width:100%"></p>` : ""}${res.tx ? `<p>${esc(res.tx).replace(/\n/g, "<br>")}</p>` : ""}` } }]);
  const center = hexCenter(item.at[0], item.at[1]);
  const [note] = await canvas.scene.createEmbeddedDocuments("Note", [{ entryId: diary.id, pageId: page.id, x: Math.round(center.x), y: Math.round(center.y + 18),
    text: res.nm, texture: { src: item.icon, tint: item.tint }, iconSize: 44, fontSize: 22, textAnchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
    global: true, flags: { [MOD]: { player: true, key: item.key } } }]);
  st.revealed = st.revealed.filter((x) => x.key !== item.key).concat([{ key: item.key, name: res.nm, at: item.at, pageId: page.id, noteId: note.id }]);
  const k = hkey(item.at[0], item.at[1]);
  if (!st.explored.includes(k)) st.explored.push(k);
  logEntry(st, `Найдено: ${res.nm} (${coord(I, item.at[0], item.at[1])}).`, "find");
  await saveState(st);
  toast({ title: `Находка: ${res.nm}`, sub: coord(I, item.at[0], item.at[1]), color: item.tint || "#7a4a1c", icon: "✦", tab: "finds", sel: item.key }, true);
  pulseHex(item.at[0], item.at[1], item.tint || "#ffd27a");
  if (res.sh) showHandout({ ...item, name: res.nm }, true);
}

async function hideItem(key) {
  const st = getState();
  const x = st.revealed.find((y) => y.key === key);
  if (!x) return;
  const diary = game.journal.get(st.diaryId);
  try { await canvas.scene.notes.get(x.noteId)?.delete(); } catch (e) {}
  try { await diary?.pages.get(x.pageId)?.delete(); } catch (e) {}
  st.revealed = st.revealed.filter((y) => y.key !== key);
  await saveState(st);
}

/* ---------------- панель мастера ---------------- */
const { ApplicationV2 } = foundry.applications.api;
class IslePanel extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "lizard-isle-panel", classes: ["isle-panel"],
    window: { title: "🌴 Остров людоящеров", resizable: true },
    position: { width: 460, height: 640 }
  };
  tab = "travel";

  async _renderHTML() {
    const I = await island();
    const el = document.createElement("div");
    const ready = isIsle();
    const st = ready ? getState() : null;
    const tabs = `<nav class="isle-tabs">${[["travel", "Путь"], ["reveal", "Открыть игрокам"], ["setup", "Импорт"]]
      .map(([k, n]) => `<a data-tab="${k}" class="${this.tab === k ? "on" : ""}">${n}</a>`).join("")}</nav>`;
    let body = "";
    if (!ready && this.tab !== "setup") {
      body = `<p>Открой сцену острова. Если её ещё нет — вкладка «Импорт».</p>`;
    } else if (this.tab === "travel") {
      const party = st.party ? canvas.scene.tokens.get(st.party) : null;
      const pos = st.lastHex ? st.lastHex.split(",").map(Number) : null;
      body = `<div class="isle-big"><div><b>День ${st.day}</b><span>${st.hours} ч в пути сегодня${st.hours > 8 ? " · перегруз" : ""}</span><span class="mute">${esc(fmtDate(parts()))}</span></div>
          <button data-act="newday">☀ Новый день</button></div>
        <p><button data-act="date">🗓 Изменить день и дату</button></p>
        <p><b>Погода на сцене:</b> <select data-weather>${[["", "ясно"], ["rain", "ливень"], ["rainStorm", "шторм"], ["fog", "туман"]]
          .map(([k, n]) => `<option value="${k}" ${(canvas.scene.weather ?? "") === k ? "selected" : ""}>${n}</option>`).join("")}</select></p>
        <p><b>Токен партии:</b> ${party ? esc(party.name) : "<span class='mute'>не выбран</span>"}${pos ? ` · сейчас ${coord(I, pos[0], pos[1])}` : ""}</p>
        <p><button data-act="party">Выделенный токен — это партия</button></p>
        <p class="mute">Двигай токен партии — в чат (только тебе) придут часы пути, броски встреч и что спрятано в гексе. Соседние гексы откроются для карточек игроков.</p>
        <p><b>Исследовано гексов:</b> ${st.explored.length} · <b>открыто игрокам:</b> ${st.revealed.length}</p>
        <p><button data-act="hours">Сбросить часы дня</button> <button data-act="reset">Сбросить исследование</button></p>
        <p><button data-act="marks">🧹 Убрать отметки игроков</button></p>
        <h3>Бродячие боссы</h3>${Object.entries(ROAMERS).map(([k, R]) => { const m = initRoam(st)[k];
          return `<p>${R.icon} <b>${esc(R.name)}</b>: ${m.on ? coord(I, m.r, m.c) : "убит"} <button data-roam="${k}" data-op="toggle">${m.on ? "Убит" : "Вернуть"}</button> <button data-roam="${k}" data-op="home">В логово</button></p>`; }).join("")}`;
    } else if (this.tab === "reveal") {
      const groups = {};
      for (const it of I.reveal) (groups[it.group] ??= []).push(it);
      const open = new Set(st.revealed.map((x) => x.key));
      body = Object.entries(groups).map(([g, items]) => `<h3>${esc(g)}</h3><ul class="isle-rev">${items.map((it) =>
        `<li class="${open.has(it.key) ? "open" : ""}">${it.img ? `<img class="isle-th" src="${handoutSrc(it)}" data-look="${it.key}" title="Посмотреть самому">` : ""}<span>${esc(it.name)} <em>${coord(I, it.at[0], it.at[1])}</em></span>${it.img ? `<button data-showp="${it.key}" title="Показать картинку игрокам">👁</button>` : ""}${open.has(it.key)
          ? `<button data-hide="${it.key}">Скрыть</button>` : `<button data-reveal="${it.key}">Открыть</button>`}</li>`).join("")}</ul>`).join("");
    } else {
      body = `<p>Создаёт или обновляет сцену «Скрытые земли · Остров», журналы мастера (места, боссы, квесты, данжи, фракции, герои) и «Дневник экспедиции» для игроков.</p>
        <p>Повторный запуск обновляет тексты и пины мастера. Открытое игрокам, исследованные гексы и отметки игроков сохраняются.</p>
        <p><button data-act="import">🌴 Импортировать / обновить остров</button></p>
        <p><button data-act="labyrinth">🕯 Собрать Лабиринт Ордена (20 сцен)</button></p>
        <p class="hint">Видео сначала залей в Data/labirint_ordena/.</p>
        <p><button data-act="echo">🌀 Собрать Пещеру Эха (Явь и Сон)</button></p>
        <p class="hint">Карты в Data/peshera_eha/.</p>
        <p><button data-act="tables">🎲 Создать случайные таблицы острова (16)</button></p>
        <p class="hint">Повторное нажатие создаёт только недостающие — твои правки в таблицах сохраняются.</p>`;
    }
    el.innerHTML = tabs + `<div class="isle-body">${body}</div>`;
    return el;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
    content.querySelectorAll("[data-tab]").forEach((a) => a.onclick = () => { this.tab = a.dataset.tab; this.render(); });
    const act = async (name) => {
      if (name === "import") await importIsland();
      if (name === "labyrinth") await buildLabyrinth();
      if (name === "echo") await buildEcho();
      if (name === "tables") await buildTables();
      if (name === "newday") await newDay();
      if (name === "date") await dateDialog();
      if (name === "party") {
        const t = canvas.tokens.controlled[0];
        if (!t) return ui.notifications.warn("Выдели токен партии на сцене.");
        const st = getState(); st.party = t.id; const h = hexAt(t.center); st.lastHex = hkey(h.r, h.c);
        await saveState(st);
      }
      if (name === "hours") { const st = getState(); st.hours = 0; await saveState(st); }
      if (name === "marks") {
        const all = canvas.scene.drawings.filter((d) => d.getFlag(MOD, "mark"));
        if (!all.length) ui.notifications.info("Отметок игроков нет.");
        else {
          const by = {}; all.forEach((d) => { const n = game.users.get(d.getFlag(MOD, "by"))?.name ?? "?"; by[n] = (by[n] ?? 0) + 1; });
          const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Убрать отметки игроков?" },
            content: `<p>Удалить ${all.length} отметок: ${Object.entries(by).map(([n, k]) => `${esc(n)} — ${k}`).join(", ")}.</p>` });
          if (ok) await canvas.scene.deleteEmbeddedDocuments("Drawing", all.map((d) => d.id));
        }
      }
      if (name === "reset") {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Сбросить исследование?" }, content: "<p>Карточки игроков снова станут «Неизведанные земли» везде, кроме места крушения.</p>" });
        if (ok) { const st = getState(); st.explored = ["18,14", "18,15"]; await saveState(st); }
      }
      this.render();
    };
    content.querySelectorAll("[data-act]").forEach((b) => b.onclick = () => act(b.dataset.act));
    content.querySelectorAll("[data-roam]").forEach((b) => b.onclick = async () => {
      const st = getState(), m = initRoam(st)[b.dataset.roam], R = ROAMERS[b.dataset.roam];
      if (b.dataset.op === "toggle") m.on = !m.on; else { m.r = R.start[0]; m.c = R.start[1]; }
      await saveState(st); await drawRoam(canvas.scene, st, hexCenter, hexRadius); this.render();
    });
    content.querySelector("[data-weather]")?.addEventListener("change", (e) => canvas.scene.update({ weather: e.target.value }));
    content.querySelectorAll("[data-reveal]").forEach((b) => b.onclick = async () => {
      const I = await island(); await revealItem(I.reveal.find((x) => x.key === b.dataset.reveal)); this.render();
    });
    content.querySelectorAll("[data-look]").forEach((b) => b.onclick = async (ev) => {
      const I = await island(); showHandout(I.reveal.find((x) => x.key === b.dataset.look), false);
    });
    content.querySelectorAll("[data-showp]").forEach((b) => b.onclick = async () => {
      const I = await island(); showHandout(I.reveal.find((x) => x.key === b.dataset.showp), true);
    });
    content.querySelectorAll("[data-hide]").forEach((b) => b.onclick = async () => { await hideItem(b.dataset.hide); this.render(); });
  }
}
let panel = null;
function openPanel() { panel ??= new IslePanel(); panel.render(true); }

/* ---------------- верхняя панелька ---------------- */
function renderBar() {
  document.getElementById("isle-bar")?.remove();
  if (!canvas?.ready) return;
  if (!isIsle() && !game.user.isGM) return;
  const bar = document.createElement("div");
  bar.id = "isle-bar";
  const btns = [];
  if (game.user.isGM) btns.push(`<button data-b="panel" title="Панель острова">🌴 Остров</button>`);
  if (isIsle()) {
    btns.push(`<button data-b="book" title="Журнал экспедиции: задания, находки, хроника">📜 Журнал</button>`);
    btns.push(`<button data-b="diary" title="Дневник экспедиции">📖 Дневник</button>`);
    btns.push(`<button data-b="board" title="Доска экспедиции: места, улики, NPC и нити">🧵 Доска</button>`);
    btns.push(`<button data-b="pins" title="Показать или спрятать пины на карте">📍 Пины</button>`);
    btns.push(`<button data-b="help" title="Как пользоваться">?</button>`);
  }
  bar.innerHTML = `<span class="isle-grip" title="Зажми и тащи. Двойной клик — вернуть на место">⠿</span>` + btns.join("") + `<span class="isle-clock" title="Время мира"></span>`;
  document.body.appendChild(bar);
  placeBar(bar); dragBar(bar); updateClock();
  bar.querySelector("[data-b=panel]")?.addEventListener("click", openPanel);
  bar.querySelector("[data-b=book]")?.addEventListener("click", () => toggleBook());
  bar.querySelector("[data-b=diary]")?.addEventListener("click", () => game.journal.get(getState().diaryId)?.sheet.render(true));
  bar.querySelector("[data-b=board]")?.addEventListener("click", () => Board.toggle());
  bar.querySelector("[data-b=pins]")?.addEventListener("click", async () => {
    const v = game.settings.get("core", "notesDisplayToggle");
    await game.settings.set("core", "notesDisplayToggle", !v);
    ui.notifications.info(!v ? "Пины на карте показаны." : "Пины на карте скрыты.");
  });
  bar.querySelector("[data-b=help]")?.addEventListener("click", () => ui.notifications.info("Двойной клик по гексу — что там. Shift + двойной клик — поставить отметку. «Дневник» — всё, что нашла партия.", { permanent: false }));
}

/* плашку можно таскать; позиция своя у каждого игрока */
const BAR_KEY = `${MOD}.barPos`;
function placeBar(bar) {
  let p = null; try { p = JSON.parse(localStorage.getItem(BAR_KEY)); } catch (e) {}
  if (!p) return;
  bar.style.transform = "none";
  bar.style.left = Math.min(Math.max(0, p.x), innerWidth - 80) + "px";
  bar.style.top = Math.min(Math.max(0, p.y), innerHeight - 40) + "px";
}
function dragBar(bar) {
  const grip = bar.querySelector(".isle-grip");
  grip.addEventListener("dblclick", () => { try { localStorage.removeItem(BAR_KEY); } catch (e) {} bar.style.transform = ""; bar.style.left = ""; bar.style.top = ""; });
  grip.addEventListener("pointerdown", (ev) => {
    ev.preventDefault(); grip.setPointerCapture(ev.pointerId);
    const r = bar.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top;
    bar.style.transform = "none"; bar.style.left = r.left + "px"; bar.style.top = r.top + "px";
    const move = (e) => { bar.style.left = Math.min(Math.max(0, e.clientX - dx), innerWidth - 80) + "px"; bar.style.top = Math.min(Math.max(0, e.clientY - dy), innerHeight - 40) + "px"; };
    const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up);
      try { localStorage.setItem(BAR_KEY, JSON.stringify({ x: parseInt(bar.style.left), y: parseInt(bar.style.top) })); } catch (e) {} };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up);
  });
}
function updateClock() {
  const el = document.querySelector("#isle-bar .isle-clock"); if (!el) return;
  const txt = fmtDate(parts());
  const st = isIsle() ? getState() : null;
  el.textContent = (st ? `День ${st.day}` : "") + (txt ? ` · ${txt}` : "");
  el.hidden = !el.textContent;
}
Hooks.on("updateWorldTime", () => updateClock());

/* ---------------- события ---------------- */
function onDblClick(ev) {
  if (!canvas?.ready || !isIsle()) return;
  if (canvas.tokens?.hover || canvas.notes?.hover) return;
  const p = canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
  const h = hexAt(p);
  if (!ISLAND) { island().then(() => onDblClick(ev)); return; }
  if (!inMap(ISLAND, h.r, h.c)) return;
  if (ev.shiftKey) return markDialog(p);
  showCard(ev.clientX, ev.clientY, h.r, h.c);
}

Hooks.once("init", () => {
  game.modules.get(MOD).api = { board: () => Board.toggle(), importIsland, openPanel, newDay, liveFit, openBook, buildLabyrinth, buildEcho, buildTables };
  registerCalendar();
  registerBoard();
  game.settings.register(MOD, "autoRoll", { name: "Автоброски в пути", hint: "Когда партия входит в опасный гекс — бросок «Когда бросать» и нужной таблицы. Бой видит только мастер, остальное — все.",
    scope: "world", config: true, type: Boolean, default: true });
  game.settings.register(MOD, "roam", { name: "Бродячие боссы", hint: "Пожиратель троп и Речной левиафан ходят по острову, пока ходит партия. Их метки видит только мастер. Рядом — знаки игрокам, в одном гексе — бой.",
    scope: "world", config: true, type: Boolean, default: true });
  game.settings.register(MOD, "timeSync", { name: "Синхронизировать игровое время", hint: "Часы пути двигают время мира (его показывают Simple Timekeeping и другие календари). «Новый день» мотает до 6:00.",
    scope: "world", config: true, type: Boolean, default: true });
  game.settings.register(MOD, "fx", { name: "Анимации острова", hint: "Облака, блики на воде, светлячки, подсветка гекса. Выключи, если тормозит.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => startFX() });
});

Hooks.once("ready", () => {
  island();
  document.addEventListener("click", (ev) => {
    const im = ev.target.closest?.("img[data-hsrc]"); if (im) presentHandout({ src: im.dataset.hsrc, name: im.dataset.hname, sub: "Находка" });
  });
  game.socket.on(`module.${MOD}`, async (msg) => {
    if (msg.action === "toast") return toast(msg.data);
    if (msg.action === "handout") return presentHandout(msg.data);
    if (msg.action === "pulse") { if (msg.sceneId === canvas.scene?.id) pingHex(msg.r, msg.c, msg.color); return; }
    if (!activeGM()) return;
    if (msg.action === "board") return applyOp(msg.op, msg.userId);
    const scene = game.scenes.get(msg.sceneId);
    if (!scene) return;
    if (msg.action === "mark") await scene.createEmbeddedDocuments("Drawing", [msg.data]);
    if (msg.action === "unmark") {
      const d = scene.drawings.get(msg.id);
      if (d && d.getFlag(MOD, "by") === msg.userId) await d.delete();
    }
  });
  document.getElementById("board")?.addEventListener("dblclick", onDblClick);
  let raf = 0;
  document.getElementById("board")?.addEventListener("pointermove", (e) => {
    if (raf || !isIsle()) return;
    raf = requestAnimationFrame(() => { raf = 0; hoverAt(e.clientX, e.clientY); });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCard(); });
});

Hooks.on("canvasReady", () => { closeCard(); renderBar(); if (panel?.rendered) panel.render(); startFX(); });
Hooks.on("canvasTearDown", () => stopFX());
Hooks.on("updateToken", (doc, changes) => { onTokenMoved(doc, changes); });
Hooks.on("updateScene", (scene, changes) => {
  if (scene.id !== canvas.scene?.id) return;
  if (foundry.utils.hasProperty(changes, `flags.${MOD}`)) { renderBar(); if (panel?.rendered) panel.render(); refreshBook(); refreshPools(); if (Board.el) Board.render(); }
});
