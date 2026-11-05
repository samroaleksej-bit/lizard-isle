/*
 * Доска экспедиции: общая для всех схема острова с открытыми местами и уликами,
 * карточки NPC (перетащи актёра), заметки и нити-связи. Игроки правят доску, мастер хранит.
 */
const MOD = "lizard-isle";
import { sfx } from "./sfx.js";
const ROOT = `modules/${MOD}`;
const W = 3990, H = 2587, GW = 140, GR = GW / Math.sqrt(3);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const uid = () => foundry.utils.randomID(10);
const COLORS = ["#c0392b", "#d9a94a", "#2f7a5b", "#2f6f8f", "#7a4fa8", "#e8e0c8"];
const GROUP_ICON = { "Места": "🏛", "Логова боссов": "☠", "Охоты": "🏹", "Данжи": "🕳", "Улики": "🔎", "Квесты": "📜" };
const hexXY = (r, c) => ({ x: c * GW + GW / 2 + (r % 2 ? GW / 2 : 0), y: GR + r * 1.5 * GR });

export function registerBoard() {
  game.settings.register(MOD, "board", { scope: "world", config: false, type: Object, default: { cards: {}, threads: {} },
    onChange: () => Board.el && Board.render() });
}
const data = () => foundry.utils.deepClone(game.settings.get(MOD, "board") ?? { cards: {}, threads: {} });

/* изменения: мастер пишет сам, игрок просит мастера через сокет */
export async function applyOp(op, userId) {
  const d = data(); d.cards ??= {}; d.threads ??= {};
  const isGM = game.users.get(userId)?.isGM;
  const own = (o) => isGM || !o?.by || o.by === userId;
  switch (op.t) {
    case "add": d.cards[op.card.id] = { ...op.card, by: userId }; break;
    case "move": if (d.cards[op.id]) Object.assign(d.cards[op.id], { x: op.x, y: op.y }); else (d.pins ??= {})[op.id] = { x: op.x, y: op.y }; break;
    case "edit": if (d.cards[op.id]) Object.assign(d.cards[op.id], op.patch); break;
    case "del": if (own(d.cards[op.id])) { delete d.cards[op.id]; for (const [k, t] of Object.entries(d.threads)) if (t.a === op.id || t.b === op.id) delete d.threads[k]; } break;
    case "link": d.threads[op.thread.id] = { ...op.thread, by: userId }; break;
    case "relabel": if (d.threads[op.id]) d.threads[op.id].label = op.label; break;
    case "unlink": if (own(d.threads[op.id])) delete d.threads[op.id]; break;
    case "clear": if (isGM) { d.cards = {}; d.threads = {}; d.pins = {}; } break;
  }
  await game.settings.set(MOD, "board", d);
}
const OP_SFX = { add: "pin", link: "thread", unlink: "snip", del: "unpin", clear: "crumple" };
function send(op) {
  if (OP_SFX[op.t]) sfx(op.t === "add" && op.card?.type === "note" ? "pen" : OP_SFX[op.t]);
  if (game.user.isGM) return applyOp(op, game.user.id);
  if (!game.users.activeGM) return ui.notifications.warn("Доска: нужен мастер онлайн, чтобы сохранить изменения.");
  game.socket.emit(`module.${MOD}`, { action: "board", op, userId: game.user.id });
}

/* что открыто игрокам: точки на схеме */
async function pins() {
  const I = await (await import("./isle.js")).island();
  const st = (await import("./isle.js")).getState(game.scenes.find((s) => s.getFlag(MOD, "isle")));
  const open = new Set((st.revealed ?? []).map((x) => x.key ?? x));
  const moved = data().pins ?? {};
  return I.reveal.filter((x) => game.user.isGM || open.has(x.key)).map((x) => {
    const p = moved["pin:" + x.key] ?? hexXY(x.at[0], x.at[1]);
    return { id: "pin:" + x.key, key: x.key, name: x.name, group: x.group, img: x.img ? `${ROOT}/assets/${x.img}` : null, item: x, x: p.x, y: p.y, hidden: !open.has(x.key) };
  });
}

export const Board = {
  el: null, view: { tx: 0, ty: 0, s: 0.3 }, linkFrom: null, color: COLORS[0], showMap: false, side: true, actorIdx: null,
  toggle() { this.el ? this.close() : this.open(); },
  close() { this.el?.remove(); this.el = null; },
  open() {
    const el = document.createElement("div");
    el.id = "isle-board";
    try { const p = JSON.parse(localStorage.getItem(`${MOD}.boardWin`)); if (p) Object.assign(el.style, { left: p.l + "px", top: p.t + "px", width: p.w + "px", height: p.h + "px" }); } catch (e) {}
    el.innerHTML = `
      <header><b>🧵 Доска экспедиции</b><span class="bd-hint">Слева — находки и поиск актёров: тащи на доску. Двойной клик — заметка. ПКМ — удалить.</span><a data-x="close" title="Закрыть">✕</a></header>
      <nav>
        <button data-x="note">＋ Заметка</button>
        <button data-x="link" title="Нажми карточку, потом вторую">🧵 Нить</button>
        <span class="bd-colors">${COLORS.map((c) => `<i data-c="${c}" style="background:${c}"></i>`).join("")}</span>
        <button data-x="side" class="${this.side ? "on" : ""}">📚 Находки и актёры</button>
        <button data-x="map">🗺 Карта</button>
        <button data-x="fit">⤢ Всё</button>
        ${game.user.isGM ? `<button data-x="clear" class="bd-danger">Очистить</button>` : ""}
      </nav>
      <div class="bd-body">
        <aside class="bd-side${this.side ? "" : " off"}">
          <div class="bd-stabs"><a data-st="finds" class="on">🔎 Находки</a><a data-st="actors">👤 Актёры</a></div>
          <div class="bd-sp" data-sp="finds"><div class="bd-list" data-list="finds"></div></div>
          <div class="bd-sp" data-sp="actors" hidden><input type="search" placeholder="Поиск актёра: зомби, гоблин…" data-q>
            <div class="bd-list" data-list="actors"><p class="bd-empty">Введи хотя бы 2 буквы. Ищу в актёрах мира и компендиумах.</p></div></div>
          <p class="bd-shint">Перетащи на доску или кликни — появится карточка.</p>
        </aside>
        <div class="bd-view"><div class="bd-world"></div></div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    this.bind();
    this.bindSide();
    this.fit();
    this.render();
  },
  fit() {
    const v = this.el.querySelector(".bd-view").getBoundingClientRect();
    const s = Math.min(v.width / W, v.height / H) * 0.98;
    this.view = { s, tx: (v.width - W * s) / 2, ty: (v.height - H * s) / 2 };
    this.applyView();
  },
  applyView() { const w = this.el?.querySelector(".bd-world"); if (w) w.style.transform = `translate(${this.view.tx}px,${this.view.ty}px) scale(${this.view.s})`; },
  async render() {
    if (!this.el) return;
    const d = data(), P = [];
    const nodes = new Map();
    P.forEach((p) => nodes.set(p.id, p));
    Object.values(d.cards ?? {}).forEach((c) => nodes.set(c.id, c));
    const world = this.el.querySelector(".bd-world");
    const th = Object.values(d.threads ?? {}).filter((t) => nodes.has(t.a) && nodes.has(t.b)).map((t) => {
      const a = nodes.get(t.a), b = nodes.get(t.b), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + 40;
      return `<path d="M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}" stroke="${t.color}" class="bd-thread" data-th="${t.id}"/>
        ${t.label ? `<text x="${mx}" y="${(a.y + b.y) / 2 + 14}" class="bd-tl" data-th="${t.id}">${esc(t.label)}</text>` : ""}`;
    }).join("");
    world.innerHTML = `
      ${this.showMap ? `<img class="bd-map" src="${ROOT}/assets/island-map-hd.webp" draggable="false">` : `<div class="bd-map bd-blank"></div>`}
      <svg class="bd-svg" viewBox="0 0 ${W} ${H}">${th}</svg>
      ${P.map((p) => `<div class="bd-pin${p.hidden ? " bd-gmonly" : ""}${this.linkFrom === p.id ? " bd-sel" : ""}" data-id="${p.id}" style="left:${p.x}px;top:${p.y}px" title="${esc(p.group)}${p.hidden ? " · игроки не видят" : ""}">
          <span>${GROUP_ICON[p.group] ?? "•"}</span><em>${esc(p.name)}</em></div>`).join("")}
      ${Object.values(d.cards ?? {}).map((c) => `<div class="bd-card bd-${c.type}${this.linkFrom === c.id ? " bd-sel" : ""}" data-id="${c.id}" style="left:${c.x}px;top:${c.y}px;--bd-c:${c.color ?? "#d9a94a"}">
          ${c.img ? `<img src="${esc(c.img)}" draggable="false">` : ""}<b>${esc(c.name ?? "")}</b>${c.text ? `<p>${esc(c.text)}</p>` : ""}
          <small>${esc(game.users.get(c.by)?.name ?? "")}</small></div>`).join("")}`;
    this.renderFinds();
    this.el.querySelector("[data-x=link]").classList.toggle("on", this.linkFrom !== null);
    this.el.querySelectorAll(".bd-colors i").forEach((i) => i.classList.toggle("on", i.dataset.c === this.color));
  },
  async look(id) {
    const p = (await pins()).find((x) => x.id === id); if (!p?.img) return;
    (await import("./isle.js")).showHandout(p.item);
  },
  toWorld(ev) { const r = this.el.querySelector(".bd-view").getBoundingClientRect(); return { x: (ev.clientX - r.left - this.view.tx) / this.view.s, y: (ev.clientY - r.top - this.view.ty) / this.view.s }; },
  async addNote(at) {
    const res = await foundry.applications.api.DialogV2.prompt({ window: { title: "Заметка на доску" },
      content: `<p><input name="n" placeholder="Заголовок" style="width:100%"></p><p><textarea name="t" rows="3" placeholder="Текст" style="width:100%"></textarea></p>`,
      ok: { label: "Повесить", callback: (e, b) => ({ n: b.form.elements.n.value.trim(), t: b.form.elements.t.value.trim() }) }, rejectClose: false });
    if (!res || (!res.n && !res.t)) return;
    send({ t: "add", card: { id: uid(), type: "note", name: res.n, text: res.t, x: at.x, y: at.y, color: this.color } });
  },
  async editCard(id) {
    const c = data().cards?.[id]; if (!c) return;
    const res = await foundry.applications.api.DialogV2.prompt({ window: { title: "Карточка" },
      content: `<p><input name="n" value="${esc(c.name ?? "")}" style="width:100%"></p><p><textarea name="t" rows="3" style="width:100%">${esc(c.text ?? "")}</textarea></p>`,
      ok: { label: "Сохранить", callback: (e, b) => ({ name: b.form.elements.n.value.trim(), text: b.form.elements.t.value.trim() }) }, rejectClose: false });
    if (res) send({ t: "edit", id, patch: res });
  },
  bind() {
    const el = this.el, view = el.querySelector(".bd-view");
    // окно: перетаскивание за шапку, размер — угол
    el.querySelector("header").addEventListener("pointerdown", (ev) => {
      if (ev.target.closest("a")) return;
      const r = el.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top;
      const mv = (e) => { el.style.left = Math.max(0, e.clientX - dx) + "px"; el.style.top = Math.max(0, e.clientY - dy) + "px"; };
      const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); this.saveWin(); };
      addEventListener("pointermove", mv); addEventListener("pointerup", up);
    });
    new ResizeObserver(() => this.saveWin()).observe(el);
    el.querySelector("[data-x=close]").onclick = () => this.close();
    el.querySelector("nav").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-x],[data-c]"); if (!b) return;
      if (b.dataset.c) { this.color = b.dataset.c; return this.render(); }
      const x = b.dataset.x;
      if (x === "note") { const v = view.getBoundingClientRect(); this.addNote(this.toWorld({ clientX: v.left + v.width / 2, clientY: v.top + v.height / 2 })); }
      if (x === "link") { this.linkFrom = this.linkFrom === null ? "" : null; this.render(); }
      if (x === "side") { this.side = !this.side; b.classList.toggle("on", this.side); el.querySelector(".bd-side").classList.toggle("off", !this.side); }
      if (x === "map") { this.showMap = !this.showMap; this.render(); }
      if (x === "fit") this.fit();
      if (x === "clear") foundry.applications.api.DialogV2.confirm({ window: { title: "Очистить доску?" }, content: "<p>Удалить все карточки и нити? Места на схеме останутся.</p>" }).then((ok) => ok && send({ t: "clear" }));
    });
    // зум колесом, панорама за фон, перетаскивание карточек
    view.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const r = view.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top, k = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
      const s = Math.min(3, Math.max(0.08, this.view.s * k)), f = s / this.view.s;
      this.view = { s, tx: mx - (mx - this.view.tx) * f, ty: my - (my - this.view.ty) * f }; this.applyView();
    }, { passive: false });
    view.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      const node = ev.target.closest("[data-id]");
      if (node && this.linkFrom !== null) {
        const id = node.dataset.id;
        if (!this.linkFrom) { this.linkFrom = id; return this.render(); }
        if (this.linkFrom !== id) send({ t: "link", thread: { id: uid(), a: this.linkFrom, b: id, color: this.color } });
        this.linkFrom = ""; return this.render();
      }
      const sx = ev.clientX, sy = ev.clientY;
      if (node) {
        const id = node.dataset.id, ox = parseFloat(node.style.left), oy = parseFloat(node.style.top);
        const mv = (e) => { node.style.left = ox + (e.clientX - sx) / this.view.s + "px"; node.style.top = oy + (e.clientY - sy) / this.view.s + "px"; };
        const up = (e) => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
          if (Math.hypot(e.clientX - sx, e.clientY - sy) > 3) send({ t: "move", id, x: Math.round(parseFloat(node.style.left)), y: Math.round(parseFloat(node.style.top)) });
          else if (id.startsWith("pin:")) (async () => (await import("./book.js")).openBook("finds", id.slice(4)))(); };
        addEventListener("pointermove", mv); addEventListener("pointerup", up); return;
      }
      const { tx, ty } = this.view;
      const mv = (e) => { this.view.tx = tx + e.clientX - sx; this.view.ty = ty + e.clientY - sy; this.applyView(); };
      const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
      addEventListener("pointermove", mv); addEventListener("pointerup", up);
    });
    view.addEventListener("dblclick", (ev) => {
      const th = ev.target.closest("[data-th]");
      if (th) return foundry.applications.api.DialogV2.prompt({ window: { title: "Подпись нити" }, content: `<input name="l" style="width:100%">`,
        ok: { callback: (e, b) => b.form.elements.l.value.trim() }, rejectClose: false }).then((l) => l !== null && l !== undefined && send({ t: "relabel", id: th.dataset.th, label: l }));
      const c = ev.target.closest(".bd-card"); if (c) return this.editCard(c.dataset.id);
      if (!ev.target.closest("[data-id]")) this.addNote(this.toWorld(ev));
    });
    view.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      const th = ev.target.closest("[data-th]"); if (th) return send({ t: "unlink", id: th.dataset.th });
      const c = ev.target.closest(".bd-card"); if (c) return send({ t: "del", id: c.dataset.id });
    });
    // NPC: перетащи актёра (или журнал) из боковой панели
    view.addEventListener("dragover", (ev) => ev.preventDefault());
    view.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      let d; try { d = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch (e) { return; }
      const at = this.toWorld(ev);
      if (d?.isle) return this.addFrom(d, at);
      const doc = d?.uuid ? await fromUuid(d.uuid) : null; if (!doc) return;
      if (doc.documentName === "Actor") send({ t: "add", card: { id: uid(), type: "npc", name: doc.name, img: doc.img, actor: doc.uuid, x: at.x, y: at.y, color: this.color } });
      else send({ t: "add", card: { id: uid(), type: "note", name: doc.name, text: "", x: at.x, y: at.y, color: this.color } });
    });
  },
  centre() { const v = this.el.querySelector(".bd-view").getBoundingClientRect(); return this.toWorld({ clientX: v.left + v.width / 2, clientY: v.top + v.height / 2 }); },
  addFrom(d, at) {
    if (d.isle === "find") send({ t: "add", card: { id: uid(), type: "find", name: d.name, img: d.img, find: d.key, x: at.x, y: at.y, color: this.color } });
    if (d.isle === "actor") send({ t: "add", card: { id: uid(), type: "npc", name: d.name, img: d.img, x: at.x, y: at.y, color: this.color } });
  },
  async renderFinds() {
    const box = this.el?.querySelector("[data-list=finds]"); if (!box) return;
    const isle = await import("./isle.js");
    const I = await isle.island();
    const st = isle.getState(game.scenes.find((x) => x.getFlag(MOD, "isle")));
    const items = (st.revealed ?? []).map((r) => ({ ...I.reveal.find((x) => x.key === r.key), name: r.name, key: r.key })).filter((x) => x.group !== "Квесты");
    box.innerHTML = items.length ? items.map((x) => this.row({ isle: "find", key: x.key, name: x.name, img: x.img ? `${ROOT}/assets/${x.img}` : "icons/svg/book.svg" }, x.group)).join("")
      : `<p class="bd-empty">Пока ничего не открыто игрокам.</p>`;
  },
  row(d, sub) {
    return `<div class="bd-row" draggable="true" data-drag="${esc(JSON.stringify(d))}"><img src="${esc(d.img)}"><span><b>${esc(d.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span></div>`;
  },
  async actorIndex() {
    if (this.actorIdx) return this.actorIdx;
    const out = game.actors.filter((a) => a.visible).map((a) => ({ name: a.name, img: a.img, src: "Мир", cr: a.system?.details?.cr, type: a.system?.details?.type?.value }));
    for (const pack of game.packs.filter((p) => p.documentName === "Actor" && p.visible)) {
      try {
        const idx = await pack.getIndex({ fields: ["img", "system.details.cr", "system.details.type.value"] });
        for (const e of idx) out.push({ name: e.name, img: e.img, src: pack.metadata.label, cr: e.system?.details?.cr, type: e.system?.details?.type?.value });
      } catch (e) {}
    }
    return (this.actorIdx = out);
  },
  async searchActors(q) {
    const box = this.el?.querySelector("[data-list=actors]"); if (!box) return;
    q = q.trim().toLowerCase();
    if (q.length < 2) return box.innerHTML = `<p class="bd-empty">Введи хотя бы 2 буквы. Ищу в актёрах мира и компендиумах.</p>`;
    box.innerHTML = `<p class="bd-empty">Ищу…</p>`;
    const all = await this.actorIndex();
    const crS = (c) => c === undefined || c === null || c === "" ? "" : `КО ${c === 0.125 ? "1/8" : c === 0.25 ? "1/4" : c === 0.5 ? "1/2" : c}`;
    const hits = all.filter((a) => a.name.toLowerCase().includes(q)).sort((a, b) => a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q) || a.name.length - b.name.length).slice(0, 60);
    box.innerHTML = hits.length ? hits.map((a) => this.row({ isle: "actor", name: a.name, img: a.img || "icons/svg/mystery-man.svg" },
      game.user.isGM ? [crS(a.cr), a.type, a.src].filter(Boolean).join(" · ") : a.src)).join("") : `<p class="bd-empty">Ничего не нашёл.</p>`;
  },
  bindSide() {
    const side = this.el.querySelector(".bd-side");
    side.querySelectorAll("[data-st]").forEach((a) => a.onclick = () => {
      side.querySelectorAll("[data-st]").forEach((b) => b.classList.toggle("on", b === a));
      side.querySelectorAll("[data-sp]").forEach((p) => p.hidden = p.dataset.sp !== a.dataset.st);
      if (a.dataset.st === "actors") side.querySelector("[data-q]").focus(); else this.renderFinds();
    });
    let t; side.querySelector("[data-q]").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => this.searchActors(e.target.value), 200); });
    side.addEventListener("dragstart", (ev) => { const r = ev.target.closest("[data-drag]"); if (r) ev.dataTransfer.setData("text/plain", r.dataset.drag); });
    side.addEventListener("click", (ev) => { const r = ev.target.closest("[data-drag]"); if (r) { const c = this.centre(); this.addFrom(JSON.parse(r.dataset.drag), { x: c.x + (Math.random() - .5) * 600, y: c.y + (Math.random() - .5) * 400 }); }; });
    side.addEventListener("keydown", (ev) => ev.stopPropagation());
    this.renderFinds();
  },
  saveWin() { if (!this.el) return; const r = this.el.getBoundingClientRect(); try { localStorage.setItem(`${MOD}.boardWin`, JSON.stringify({ l: r.left, t: r.top, w: r.width, h: r.height })); } catch (e) {} }
};
