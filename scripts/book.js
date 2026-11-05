// Полевой журнал экспедиции: задания фракций, находки, хроника, отношения с фракциями.
import { MOD, island, getState, saveState, esc, coord, isIsle, openDiaryPage, pulseHex, hexCenter } from "./isle.js";

export const STATUS = {
  active: { n: "Взято", mark: "✒", stamp: "" },
  done: { n: "Выполнено", mark: "✔", stamp: "ВЫПОЛНЕНО" },
  failed: { n: "Провалено", mark: "✖", stamp: "ПРОВАЛЕНО" }
};
const TABS = [["quests", "Задания"], ["finds", "Находки"], ["chronicle", "Хроника"], ["factions", "Фракции"]];
const REP = ["Вражда", "Неприязнь", "Холод", "Нейтралитет", "Доверие", "Дружба", "Союз"];

/* ---------- запись в хронику ---------- */
export function logEntry(st, text, kind = "note") {
  st.log ??= [];
  st.log.push({ d: st.day, k: kind, t: text });
  if (st.log.length > 400) st.log = st.log.slice(-400);
}

/* ---------- уведомление-свиток у всех ---------- */
export function toast({ title, sub = "", color = "#7a4a1c", icon = "📜", tab = null, sel = null }, broadcast = false) {
  if (broadcast) game.socket.emit(`module.${MOD}`, { action: "toast", data: { title, sub, color, icon, tab, sel } });
  const el = document.createElement("div");
  el.className = "xb-toast";
  el.style.setProperty("--seal", color);
  el.innerHTML = `<i class="xb-roll l"></i><div class="xb-paper"><span class="xb-seal sm">${icon}</span><div><b>${esc(title)}</b>${sub ? `<em>${esc(sub)}</em>` : ""}</div></div><i class="xb-roll r"></i>`;
  if (tab) {
    el.classList.add("click");
    el.title = "Открыть в журнале";
    el.addEventListener("click", () => { openBook(tab, sel); el.classList.add("out"); });
  }
  document.body.appendChild(el);
  try { foundry.audio.AudioHelper.play({ src: "sounds/notify.wav", volume: 0.35, autoplay: true, loop: false }, false); } catch (e) {}
  setTimeout(() => el.classList.add("out"), 5200);
  setTimeout(() => el.remove(), 6000);
}

/* ---------- разметка книги (чистая функция — удобно тестировать) ---------- */
export function bookHTML(I, st, view, isGM) {
  const quests = st.quests ?? {};
  const visibleQ = I.QUESTS.filter((q) => isGM || quests[q.id]);
  const tab = view.tab;
  let left = "", right = "", spread = "";

  if (tab === "quests") {
    const sel = visibleQ.find((q) => q.id === view.sel) ?? visibleQ.find((q) => quests[q.id] === "active") ?? visibleQ[0];
    const groups = Object.entries(I.FQ).map(([fk, f]) => {
      const qs = visibleQ.filter((q) => q.f === fk);
      if (!qs.length) return "";
      return `<div class="xb-fac"><h4><span class="xb-seal" style="--seal:${f.color}">${esc(f.n[0])}</span>${esc(f.n)}</h4><ul>${qs.map((q, i) => {
        const s = quests[q.id];
        return `<li data-q="${q.id}" class="${s ?? "q-hidden"} ${sel?.id === q.id ? "sel" : ""}" style="--i:${i}"><span class="xb-mk">${s ? STATUS[s].mark : "◇"}</span>${esc(q.n)}</li>`;
      }).join("")}</ul></div>`;
    }).join("");
    left = `<h2 class="xb-h">Задания</h2>${groups || `<p class="xb-hand xb-empty">Пока никто на острове не доверил вам дел.</p>`}`;
    if (sel) {
      const f = I.FQ[sel.f], s = quests[sel.id];
      right = `<div class="xb-detail" style="--seal:${f.color}">
        <span class="xb-seal big">${esc(f.n[0])}</span>
        <h2>${esc(sel.n)}</h2>
        <div class="xb-meta">${esc(f.n)} · даёт ${esc(f.giver)}</div>
        <div class="xb-rule"></div>
        <p class="xb-hand">${esc(sel.goal)}</p>
        <p class="xb-loc">⌖ ${coord(I, sel.at[0], sel.at[1])} <a data-pan="${sel.at[0]},${sel.at[1]}">показать на карте</a></p>
        ${s && STATUS[s].stamp ? `<div class="xb-stamp ${s}">${STATUS[s].stamp}</div>` : ""}
        ${isGM ? `<div class="xb-gm"><h4>Тайное мастера</h4>
          <p><b>Подвох.</b> ${esc(sel.twist)}</p><p><b>Последствия.</b> ${esc(sel.plot)}</p>
          <div class="xb-btns">${[["active", "Выдать"], ["done", "Выполнено"], ["failed", "Провалено"], ["", "Скрыть"]]
            .map(([k, n]) => `<button data-qs="${k}" data-qid="${sel.id}" class="${(s ?? "") === k ? "on" : ""}">${n}</button>`).join("")}</div></div>` : ""}
      </div>`;
    } else right = `<div class="xb-blank">❦</div>`;
  }

  if (tab === "finds") {
    const opened = new Map((st.revealed ?? []).map((x) => [x.key, x]));
    const items = I.reveal.filter((r) => r.group !== "Квесты" && (isGM || opened.has(r.key)));
    const groups = {};
    for (const it of items) (groups[it.group] ??= []).push(it);
    const sel = items.find((x) => x.key === view.sel) ?? items.filter((x) => opened.has(x.key)).pop() ?? (isGM ? items[0] : null);
    const nm = (it) => opened.get(it.key)?.name ?? it.name;
    left = `<h2 class="xb-h">Находки</h2>${items.length ? Object.entries(groups).map(([g, xs]) =>
      `<div class="xb-fac"><h4>${esc(g)}</h4><ul>${xs.map((x, i) => `<li data-f="${x.key}" class="${sel?.key === x.key ? "sel" : ""}${opened.has(x.key) ? "" : " xb-locked"}" style="--i:${i}"><span class="xb-mk">${opened.has(x.key) ? "✦" : "🔒"}</span>${esc(nm(x))}</li>`).join("")}</ul></div>`).join("")
      : `<p class="xb-hand xb-empty">Остров ещё не открыл вам своих тайн.</p>`}`;
    if (sel) {
      const o = opened.get(sel.key);
      right = `<div class="xb-detail">
        <h2>${esc(nm(sel))}</h2>
        <div class="xb-meta">${coord(I, sel.at[0], sel.at[1])}${o ? "" : " · <b>игроки не видят</b>"}</div>
        <div class="xb-rule"></div>
        ${sel.img ? `<figure class="xb-photo${o ? "" : " xb-ghost"}"><img src="modules/${MOD}/assets/${sel.img}" data-zoom="${esc(nm(sel))}" draggable="false"></figure>` : ""}
        ${o ? `<div class="xb-text" data-pagetext="${o.pageId}"></div>` : (sel.text ? `<div class="xb-text"><p>${esc(sel.text)}</p></div>` : "")}
        ${isGM ? `<div class="xb-gm">${o
          ? `<button data-fshow="${sel.key}">📖 Показать всем</button><button data-fhide="${sel.key}">🔒 Скрыть от игроков</button>`
          : `<button data-fopen="${sel.key}">👁 Открыть игрокам</button>`}</div>` : ""}
      </div>`;
    } else right = `<div class="xb-blank">❦</div>`;
  }

  if (tab === "chronicle") {
    const days = {};
    for (const e of st.log ?? []) (days[e.d] ??= []).push(e);
    const keys = Object.keys(days).map(Number).sort((a, b) => b - a);
    spread = keys.length ? keys.map((d) => `<div class="xb-day"><h3>День ${d}</h3><ul>${days[d].map((e) => `<li class="k-${e.k}">${esc(e.t)}</li>`).join("")}</ul></div>`).join("")
      : `<p class="xb-hand xb-empty">Страницы чисты. Первая запись появится, когда партия сделает первый шаг.</p>`;
  }

  if (tab === "factions") {
    const rep = st.rep ?? {};
    left = `<h2 class="xb-h">Фракции</h2>${Object.entries(I.FQ).map(([fk, f]) => {
      const v = rep[fk] ?? 0;
      const qs = I.QUESTS.filter((q) => q.f === fk);
      const done = qs.filter((q) => (st.quests ?? {})[q.id] === "done").length;
      return `<div class="xb-rep" style="--seal:${f.color}"><span class="xb-seal">${esc(f.n[0])}</span>
        <div><b>${esc(f.n)}</b><em>${esc(f.giver)} · заданий выполнено: ${done}</em>
        <div class="xb-pips">${[-3, -2, -1, 0, 1, 2, 3].map((p) => `<i class="${p === 0 ? "zero" : ""} ${(v > 0 && p > 0 && p <= v) || (v < 0 && p < 0 && p >= v) ? "on" : ""} ${p < 0 ? "neg" : ""}"></i>`).join("")}</div>
        <span class="xb-rept">${REP[v + 3]}</span></div>
        ${isGM ? `<div class="xb-pm"><button data-rep="${fk}" data-d="-1">−</button><button data-rep="${fk}" data-d="1">+</button></div>` : ""}</div>`;
    }).join("")}`;
    right = `<div class="xb-detail"><h2>Как читать</h2><div class="xb-rule"></div>
      <p class="xb-hand">Метки слева — отношение народа острова к экспедиции. Правее нуля вам доверяют, левее — точат на вас копья.</p>
      <p class="xb-hand">Помогая одним, вы почти всегда задеваете других. Остров помнит всё.</p>
      <div class="xb-legend">${REP.map((r, i) => `<span>${i - 3 > 0 ? "+" : ""}${i - 3} ${r}</span>`).join("")}</div></div>`;
  }

  const ribbons = TABS.map(([k, n], i) => `<a data-tab="${k}" class="xb-rib r${i} ${tab === k ? "on" : ""}"><span>${n}</span></a>`).join("");
  const pages = spread
    ? `<section class="xb-page xb-wide"><h2 class="xb-h">Хроника экспедиции</h2><div class="xb-cols">${spread}</div></section>`
    : `<section class="xb-page xb-left">${left}</section><section class="xb-page xb-right"><div class="xb-turn">${right}</div></section>`;
  return `<div class="xb-book"><div class="xb-cover" data-drag>
      <div class="xb-title" data-drag>Полевой журнал экспедиции · День ${st.day}</div>
      <a class="xb-close" title="Закрыть">✕</a>
      <div class="xb-spread">${pages}<div class="xb-gutter"></div></div>
      <nav class="xb-ribbons">${ribbons}</nav>
      <i class="xb-corner tl"></i><i class="xb-corner tr"></i><i class="xb-corner bl"></i><i class="xb-corner br"></i>
    </div></div>`;
}

/* ---------- окно ---------- */
const { ApplicationV2 } = foundry.applications.api;
export class QuestBook extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "lizard-isle-book", classes: ["xb-app"],
    window: { frame: false, positioned: true },
    position: { width: 1000, height: 660 }
  };
  view = { tab: "quests", sel: null };
  _first = true;

  async _renderHTML() {
    const I = await island();
    const st = getState();
    const el = document.createElement("div");
    el.innerHTML = bookHTML(I, st, this.view, game.user.isGM);
    return el;
  }

  _replaceHTML(result, content) {
    const turned = this._turn; this._turn = false;
    content.replaceChildren(result);
    const book = content.querySelector(".xb-book");
    if (this._first) { book.classList.add("opening"); this._first = false; }
    if (turned) content.querySelector(".xb-turn")?.classList.add("flip");
    content.querySelector(".xb-close").onclick = () => this.close();
    content.querySelectorAll("[data-tab]").forEach((a) => a.onclick = () => { this.view = { tab: a.dataset.tab, sel: null }; this._turn = true; this.render(); });
    content.querySelectorAll("[data-q]").forEach((li) => li.onclick = () => { this.view.sel = li.dataset.q; this._turn = true; this.render(); });
    content.querySelectorAll("[data-f]").forEach((li) => li.onclick = () => { this.view.sel = li.dataset.f; this._turn = true; this.render(); });
    content.querySelectorAll("[data-fopen]").forEach((b) => b.onclick = async () => {
      const m = await import("./isle.js"); const I = await island();
      await m.revealItem(I.reveal.find((x) => x.key === b.dataset.fopen)); this.render();
    });
    content.querySelectorAll("[data-fhide]").forEach((b) => b.onclick = async () => { await (await import("./isle.js")).hideItem(b.dataset.fhide); this.render(); });
    content.querySelectorAll("[data-fshow]").forEach((b) => b.onclick = async () => (await import("./isle.js")).showFind(b.dataset.fshow));
    content.querySelectorAll("[data-zoom]").forEach((im) => im.onclick = () => {
      const IP = foundry.applications.apps.ImagePopout ?? ImagePopout;
      new IP({ src: im.getAttribute("src"), window: { title: im.dataset.zoom } }).render(true);
    });
    content.querySelectorAll("[data-pan]").forEach((a) => a.onclick = () => panTo(...a.dataset.pan.split(",").map(Number)));
    content.querySelectorAll("[data-page]").forEach((a) => a.onclick = () => openDiaryPage(a.dataset.page));
    content.querySelectorAll("[data-qs]").forEach((b) => b.onclick = () => setQuest(b.dataset.qid, b.dataset.qs));
    content.querySelectorAll("[data-rep]").forEach((b) => b.onclick = () => changeRep(b.dataset.rep, Number(b.dataset.d)));
    // текст находки — из страницы дневника
    const pt = content.querySelector("[data-pagetext]");
    if (pt) {
      const diary = game.journal.get(getState().diaryId);
      const page = diary?.pages.get(pt.dataset.pagetext);
      pt.innerHTML = (page?.text?.content ?? "").replace(/<p><img[^>]*><\/p>/g, "");
    }
    // окно поверх всего: своё положение, перетаскивание за обложку, клик — на передний план
    const el = this.element;
    placeWindow(el);
    el.onpointerdown = () => toFront(el);
    content.querySelector(".xb-cover").addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".xb-page, button, a, input, select, .xb-ribbons")) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, p0 = { ...POS };
      el.classList.add("dragging");
      const mv = (ev) => { POS.left = p0.left + ev.clientX - sx; POS.top = p0.top + ev.clientY - sy; placeWindow(el); };
      const up = () => { el.classList.remove("dragging"); window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); savePos(); };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    });
  }

  // положением окна управляем сами, чтобы Foundry его не сбрасывал
  setPosition() { if (this.element) placeWindow(this.element); return this.position; }

  async close(options) {
    const el = this.element?.querySelector(".xb-book");
    if (el) { el.classList.add("closing"); await new Promise((r) => setTimeout(r, 260)); }
    this._first = true;
    return super.close(options);
  }
}

let book = null;
/* положение окна запоминается у каждого игрока */
const POS = { left: null, top: null };
try { Object.assign(POS, JSON.parse(localStorage.getItem(`${MOD}.bookPos`) || "{}")); } catch (e) {}
function savePos() { try { localStorage.setItem(`${MOD}.bookPos`, JSON.stringify(POS)); } catch (e) {} }
let Z = 9000;
function toFront(el) { el.style.zIndex = String(++Z); }
function placeWindow(el) {
  const w = Math.min(1000, window.innerWidth - 40), h = Math.min(660, window.innerHeight - 40);
  if (POS.left === null || POS.top === null) { POS.left = (window.innerWidth - w) / 2; POS.top = (window.innerHeight - h) / 2; }
  // не даём утащить книгу за край экрана целиком
  POS.left = Math.max(-w + 120, Math.min(window.innerWidth - 120, POS.left));
  POS.top = Math.max(0, Math.min(window.innerHeight - 60, POS.top));
  Object.assign(el.style, { position: "fixed", left: `${POS.left}px`, top: `${POS.top}px`, width: `${w}px`, height: `${h}px`, margin: "0" });
  if (!el.style.zIndex) toFront(el);
}

export function openBook(tab, sel = null) {
  if (!isIsle()) return ui.notifications.warn("Журнал работает на сцене острова.");
  book ??= new QuestBook();
  if (tab) book.view = { tab, sel };
  if (book.rendered) { book._turn = true; book.render(); toFront(book.element); return; }
  book.render({ force: true });
}
window.addEventListener("resize", () => { if (book?.rendered) placeWindow(book.element); });
export function toggleBook() { if (book?.rendered) book.close(); else openBook(); }
export function refreshBook() { if (book?.rendered) book.render(); }

function panTo(r, c) {
  const p = hexCenter(r, c);
  canvas.animatePan({ x: p.x, y: p.y, scale: Math.max(canvas.stage.scale.x, 0.7), duration: 900 });
  pulseHex(r, c, "#ffd27a", false);
}

async function setQuest(id, status) {
  if (!game.user.isGM) return;
  const I = await island();
  const q = I.QUESTS.find((x) => x.id === id);
  const f = I.FQ[q.f];
  const st = getState();
  st.quests ??= {};
  if (!status) delete st.quests[id];
  else st.quests[id] = status;
  if (status === "active") logEntry(st, `${f.giver} поручает: «${q.n}».`, "quest");
  if (status === "done") logEntry(st, `Задание «${q.n}» выполнено.`, "done");
  if (status === "failed") logEntry(st, `Задание «${q.n}» провалено.`, "fail");
  await saveState(st);
  if (status) {
    const head = { active: "Новое задание", done: "Задание выполнено", failed: "Задание провалено" }[status];
    toast({ title: `${head}: ${q.n}`, sub: `${f.n} · ${f.giver}`, color: f.color, icon: status === "done" ? "✔" : status === "failed" ? "✖" : "📜", tab: "quests", sel: q.id }, true);
    if (status === "active") pulseHex(q.at[0], q.at[1], f.color, true);
  }
}

async function changeRep(fk, d) {
  if (!game.user.isGM) return;
  const I = await island();
  const st = getState();
  st.rep ??= {};
  const v = Math.max(-3, Math.min(3, (st.rep[fk] ?? 0) + d));
  if (v === (st.rep[fk] ?? 0)) return;
  st.rep[fk] = v;
  const f = I.FQ[fk];
  logEntry(st, `${f.n}: ${d > 0 ? "отношение улучшилось" : "отношение ухудшилось"} — ${REP[v + 3].toLowerCase()}.`, d > 0 ? "up" : "down");
  await saveState(st);
  toast({ title: `${f.n}: ${REP[v + 3]}`, sub: d > 0 ? "К вам относятся лучше" : "К вам относятся хуже", color: f.color, icon: d > 0 ? "▲" : "▼", tab: "factions" }, true);
}
