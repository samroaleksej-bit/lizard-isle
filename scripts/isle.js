// Скрытые земли · Остров — интерактивный гекс-краул для Foundry VTT v13/v14.
const MOD = "lizard-isle";
const ROOT = `modules/${MOD}`;
const DIARY_NAME = "Дневник экспедиции";
const MARKS = [["⛺", "Лагерь"], ["👣", "Следы"], ["⚠️", "Опасно"], ["💧", "Вода"], ["❓", "Загадка"], ["⭐", "Важное"], ["💀", "Смерть"]];

let ISLAND = null;
let CONTENT = null;

/* ---------------- данные ---------------- */
async function island() {
  if (!ISLAND) ISLAND = await (await fetch(`${ROOT}/data/island.json`)).json();
  return ISLAND;
}
async function content() {
  if (!CONTENT) CONTENT = await (await fetch(`${ROOT}/data/content.json`)).json();
  return CONTENT;
}
const isIsle = (scene = canvas?.scene) => !!scene?.getFlag(MOD, "isle");
const activeGM = () => game.users.activeGM?.isSelf ?? game.user.isGM;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

function getState(scene = canvas.scene) {
  const s = scene?.getFlag(MOD, "state") ?? {};
  return { day: 1, hours: 0, explored: [], revealed: [], party: null, lastHex: null, diaryId: null, ...foundry.utils.deepClone(s) };
}
async function saveState(state, scene = canvas.scene) {
  // все ключи состояния всегда на месте, массивы при слиянии заменяются целиком
  await scene.setFlag(MOD, "state", state);
}

/* ---------------- гексы ---------------- */
function hexAt(point) {
  const o = canvas.grid.getOffset(point);
  return { r: o.i, c: o.j };
}
function inMap(I, r, c) {
  return r >= 0 && r < I.RAW.length && c >= 0 && c < I.RAW[0].length;
}
const hkey = (r, c) => `${r},${c}`;
const coord = (I, r, c) => `${I.ROWS[r]}-${c + 1}`;
function neighbors(r, c) {
  try { return canvas.grid.getAdjacentOffsets({ i: r, j: c }).map((o) => [o.i, o.j]); }
  catch (e) { return []; }
}
function chanceText(t) {
  return t.d === 0 ? "встреч нет" : t.d === 1 ? "встреча на 1 из к6" : "встреча на 1–2 из к6";
}

/* ---------------- импорт сцены и журналов ---------------- */
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
    return { entryId: ref.entryId, pageId: ref.pageId, x: n.x, y: n.y, text: n.label,
      texture: { src: n.icon, tint: n.tint }, iconSize: 40, fontSize: 22,
      textAnchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM, global: false, flags: { [MOD]: { gm: true } } };
  });
  const sceneData = {
    name: S.name, folder: sFolder.id, navigation: true,
    background: { src: `${ROOT}/assets/island-map-hd.webp` }, width: S.width, height: S.height, padding: 0,
    backgroundColor: "#173a49",
    grid: { type: CONST.GRID_TYPES.HEXODDR, size: S.gridSize, distance: 1, units: "гекс", color: "#000000", alpha: 0.22, thickness: 1 },
    tokenVision: true, fog: { exploration: true },
    environment: { globalLight: { enabled: true }, darknessLevel: 0 },
    initial: { x: Math.round(S.start[0]), y: Math.round(S.start[1]), scale: 0.6 },
    flags: { [MOD]: { isle: true } }
  };
  let scene = game.scenes.find((s) => s.getFlag(MOD, "isle")) ?? game.scenes.find((s) => s.name === S.name);
  if (scene) {
    await scene.update(sceneData);
    const old = scene.notes.filter((n) => n.getFlag(MOD, "gm")).map((n) => n.id);
    if (old.length) await scene.deleteEmbeddedDocuments("Note", old);
    await scene.createEmbeddedDocuments("Note", notes);
  } else {
    scene = await Scene.create({ ...sceneData, notes });
  }
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

function openDiaryPage(pageId) {
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
  const gx = canvas.grid.sizeX ?? canvas.grid.size, gy = canvas.grid.sizeY ?? canvas.grid.size;
  const center = { x: (changes.x ?? doc.x) + (doc.width * gx) / 2, y: (changes.y ?? doc.y) + (doc.height * gy) / 2 };
  const to = hexAt(center);
  if (!inMap(I, to.r, to.c)) return;
  const toKey = hkey(to.r, to.c);
  if (st.lastHex === toKey) return;

  // путь через промежуточные гексы
  let path = [[to.r, to.c]];
  if (st.lastHex) {
    const [fr, fc] = st.lastHex.split(",").map(Number);
    try {
      const pts = canvas.grid.getDirectPath([{ i: fr, j: fc }, { i: to.r, j: to.c }]);
      path = pts.map((o) => [o.i, o.j]).slice(1);
    } catch (e) { /* только конечный гекс */ }
  }

  const lines = [];
  const explored = new Set(st.explored);
  for (const [r, c] of path) {
    if (!inMap(I, r, c)) continue;
    const ch = I.RAW[r][c], t = I.T[ch];
    explored.add(hkey(r, c));
    for (const [nr, nc] of neighbors(r, c)) if (inMap(I, nr, nc)) explored.add(hkey(nr, nc));
    if (ch === "~") { lines.push(`<li><b>${coord(I, r, c)} · Море.</b> Без лодки не пройти.</li>`); continue; }
    const before = st.hours;
    st.hours += t.h;
    let enc = "";
    if (t.d > 0) {
      const d6 = await new Roll("1d6").evaluate();
      if (d6.total <= t.d && I.ENC[ch]) {
        const d8 = await new Roll("1d8").evaluate();
        enc = `<br>⚔ <b>Встреча!</b> к6 = ${d6.total}, к8 = ${d8.total}: ${esc(I.ENC[ch][d8.total - 1])}`;
      } else enc = `<br><span class="mute">к6 = ${d6.total}, встречи нет</span>`;
    }
    const here = I.gmHere[hkey(r, c)];
    const tired = before <= 8 && st.hours > 8 ? `<br>😓 <b>Больше 8 часов в пути:</b> Тел СЛ 12 от истощения или разбить лагерь.` : "";
    lines.push(`<li><b>${coord(I, r, c)} · ${esc(t.n)}</b> (+${t.h} ч)${ch === "r" ? `<br>🌊 ${esc(t.note)}` : ""}${enc}${here ? `<br>📌 ${here.map(esc).join("; ")}` : ""}${tired}</li>`);
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
}

async function newDay() {
  const I = await island();
  const st = getState();
  st.day += 1; st.hours = 0;
  await saveState(st);
  const roll = await new Roll("1d6").evaluate();
  const w = I.WEATHER[roll.total - 1];
  await ChatMessage.create({ speaker: { alias: "Остров" },
    content: `<div class="isle-chat"><h3>☀ День ${st.day}</h3><p>Погода (к6 = ${roll.total}): <b>${esc(w)}</b></p></div>` });
  await ChatMessage.create({ speaker: { alias: "Остров" }, whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
    content: `<div class="isle-chat"><p>Напоминание: вода — Выживание СЛ 10 (джунгли) / СЛ 14 (болото, топи). Ночёвка без укрытия — ещё одна проверка встречи. 3 дня без укрытия — портится одна вещь.</p></div>` });
}

/* ---------------- открыть игрокам ---------------- */
async function revealItem(item) {
  const st = getState();
  const diary = game.journal.get(st.diaryId);
  if (!diary) return ui.notifications.error("Нет «Дневника экспедиции». Запусти импорт острова в панели.");
  const D2 = foundry.applications.api.DialogV2;
  const res = await D2.prompt({
    window: { title: `Открыть игрокам: ${item.name}` },
    content: `<p><label>Название для игроков<br><input type="text" name="nm" value="${esc(item.name)}" style="width:100%"></label></p>
      <p><label>Что узнают игроки<br><textarea name="tx" rows="5" style="width:100%">${esc(item.text)}</textarea></label></p>
      <p class="hint">Здесь нет твоих спойлеров — только то, что ты впишешь.</p>`,
    ok: { label: "Открыть", callback: (ev, btn) => ({ nm: btn.form.elements.nm.value.trim() || item.name, tx: btn.form.elements.tx.value.trim() }) },
    rejectClose: false
  });
  if (!res) return;
  const I = await island();
  const [page] = await diary.createEmbeddedDocuments("JournalEntryPage", [{ name: res.nm, type: "text", title: { show: true, level: 1 },
    text: { format: 1, content: `<p><em>${coord(I, item.at[0], item.at[1])} · День ${st.day}</em></p>${res.tx ? `<p>${esc(res.tx).replace(/\n/g, "<br>")}</p>` : ""}` } }]);
  const center = canvas.grid.getCenterPoint({ i: item.at[0], j: item.at[1] });
  const [note] = await canvas.scene.createEmbeddedDocuments("Note", [{ entryId: diary.id, pageId: page.id, x: Math.round(center.x), y: Math.round(center.y + 18),
    text: res.nm, texture: { src: item.icon, tint: item.tint }, iconSize: 44, fontSize: 22, textAnchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
    global: true, flags: { [MOD]: { player: true, key: item.key } } }]);
  st.revealed = st.revealed.filter((x) => x.key !== item.key).concat([{ key: item.key, name: res.nm, at: item.at, pageId: page.id, noteId: note.id }]);
  const k = hkey(item.at[0], item.at[1]);
  if (!st.explored.includes(k)) st.explored.push(k);
  await saveState(st);
  ui.notifications.info(`Игроки узнали: ${res.nm}`);
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
      body = `<div class="isle-big"><div><b>День ${st.day}</b><span>${st.hours} ч в пути сегодня${st.hours > 8 ? " · перегруз" : ""}</span></div>
          <button data-act="newday">☀ Новый день</button></div>
        <p><b>Токен партии:</b> ${party ? esc(party.name) : "<span class='mute'>не выбран</span>"}${pos ? ` · сейчас ${coord(I, pos[0], pos[1])}` : ""}</p>
        <p><button data-act="party">Выделенный токен — это партия</button></p>
        <p class="mute">Двигай токен партии — в чат (только тебе) придут часы пути, броски встреч и что спрятано в гексе. Соседние гексы откроются для карточек игроков.</p>
        <p><b>Исследовано гексов:</b> ${st.explored.length} · <b>открыто игрокам:</b> ${st.revealed.length}</p>
        <p><button data-act="hours">Сбросить часы дня</button> <button data-act="reset">Сбросить исследование</button></p>`;
    } else if (this.tab === "reveal") {
      const groups = {};
      for (const it of I.reveal) (groups[it.group] ??= []).push(it);
      const open = new Set(st.revealed.map((x) => x.key));
      body = Object.entries(groups).map(([g, items]) => `<h3>${esc(g)}</h3><ul class="isle-rev">${items.map((it) =>
        `<li class="${open.has(it.key) ? "open" : ""}"><span>${esc(it.name)} <em>${coord(I, it.at[0], it.at[1])}</em></span>${open.has(it.key)
          ? `<button data-hide="${it.key}">Скрыть</button>` : `<button data-reveal="${it.key}">Открыть</button>`}</li>`).join("")}</ul>`).join("");
    } else {
      body = `<p>Создаёт или обновляет сцену «Скрытые земли · Остров», журналы мастера (места, боссы, квесты, данжи, фракции, герои) и «Дневник экспедиции» для игроков.</p>
        <p>Повторный запуск обновляет тексты и пины мастера. Открытое игрокам, исследованные гексы и отметки игроков сохраняются.</p>
        <p><button data-act="import">🌴 Импортировать / обновить остров</button></p>`;
    }
    el.innerHTML = tabs + `<div class="isle-body">${body}</div>`;
    return el;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
    content.querySelectorAll("[data-tab]").forEach((a) => a.onclick = () => { this.tab = a.dataset.tab; this.render(); });
    const act = async (name) => {
      if (name === "import") await importIsland();
      if (name === "newday") await newDay();
      if (name === "party") {
        const t = canvas.tokens.controlled[0];
        if (!t) return ui.notifications.warn("Выдели токен партии на сцене.");
        const st = getState(); st.party = t.id; const h = hexAt(t.center); st.lastHex = hkey(h.r, h.c);
        await saveState(st);
      }
      if (name === "hours") { const st = getState(); st.hours = 0; await saveState(st); }
      if (name === "reset") {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Сбросить исследование?" }, content: "<p>Карточки игроков снова станут «Неизведанные земли» везде, кроме места крушения.</p>" });
        if (ok) { const st = getState(); st.explored = ["18,14", "18,15"]; await saveState(st); }
      }
      this.render();
    };
    content.querySelectorAll("[data-act]").forEach((b) => b.onclick = () => act(b.dataset.act));
    content.querySelectorAll("[data-reveal]").forEach((b) => b.onclick = async () => {
      const I = await island(); await revealItem(I.reveal.find((x) => x.key === b.dataset.reveal)); this.render();
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
    btns.push(`<button data-b="diary" title="Дневник экспедиции">📖 Дневник</button>`);
    btns.push(`<button data-b="pins" title="Показать или спрятать пины на карте">📍 Пины</button>`);
    btns.push(`<button data-b="help" title="Как пользоваться">?</button>`);
  }
  bar.innerHTML = btns.join("");
  document.body.appendChild(bar);
  bar.querySelector("[data-b=panel]")?.addEventListener("click", openPanel);
  bar.querySelector("[data-b=diary]")?.addEventListener("click", () => game.journal.get(getState().diaryId)?.sheet.render(true));
  bar.querySelector("[data-b=pins]")?.addEventListener("click", async () => {
    const v = game.settings.get("core", "notesDisplayToggle");
    await game.settings.set("core", "notesDisplayToggle", !v);
    ui.notifications.info(!v ? "Пины на карте показаны." : "Пины на карте скрыты.");
  });
  bar.querySelector("[data-b=help]")?.addEventListener("click", () => ui.notifications.info("Двойной клик по гексу — что там. Shift + двойной клик — поставить отметку. «Дневник» — всё, что нашла партия.", { permanent: false }));
}

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
  game.modules.get(MOD).api = { importIsland, openPanel, newDay };
});

Hooks.once("ready", () => {
  island();
  game.socket.on(`module.${MOD}`, async (msg) => {
    if (!activeGM()) return;
    const scene = game.scenes.get(msg.sceneId);
    if (!scene) return;
    if (msg.action === "mark") await scene.createEmbeddedDocuments("Drawing", [msg.data]);
    if (msg.action === "unmark") {
      const d = scene.drawings.get(msg.id);
      if (d && d.getFlag(MOD, "by") === msg.userId) await d.delete();
    }
  });
  document.getElementById("board")?.addEventListener("dblclick", onDblClick);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCard(); });
});

Hooks.on("canvasReady", () => { closeCard(); renderBar(); if (panel?.rendered) panel.render(); });
Hooks.on("updateToken", (doc, changes) => { onTokenMoved(doc, changes); });
Hooks.on("updateScene", (scene, changes) => {
  if (scene.id !== canvas.scene?.id) return;
  if (foundry.utils.hasProperty(changes, `flags.${MOD}`)) { renderBar(); if (panel?.rendered) panel.render(); }
});
