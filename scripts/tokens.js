/* Токены мобов острова: раздаёт актёрам мира токены из assets/tokens и ставит случайные вариации. Портрет (арт) не трогает. */
const MOD = "lizard-isle";
const norm = (s) => String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/[-–—_]+/g, " ").replace(/\s+/g, " ").trim();
const dir = (t) => `modules/${MOD}/assets/tokens/${t.slug}`;
const one = (t, i) => `${dir(t)}/${i}.webp`;

// Круглый токен с рамкой должен занимать ровно свои клетки. У актёров из компендиумов под динамическое кольцо
// стоит масштаб картинки ×2 - без кольца он раздувает токен вдвое, поэтому возвращаем 1.
const FIT = { "prototypeToken.ring.enabled": false, "prototypeToken.texture.scaleX": 1, "prototypeToken.texture.scaleY": 1 };

/** Что записать в прототип токена: одна картинка или шаблон со случайным выбором. */
function proto(t) {
  return t.n > 1
    ? { "prototypeToken.texture.src": `${dir(t)}/*.webp`, "prototypeToken.randomImg": true, ...FIT }
    : { "prototypeToken.texture.src": one(t, 1), "prototypeToken.randomImg": false, ...FIT };
}

export async function applyTokens() {
  if (!game.user.isGM) return ui.notifications.warn("Только мастер.");
  const D = await (await fetch(`modules/${MOD}/data/tokens.json`)).json();
  const npcs = game.actors.filter(a => a.type === "npc");
  const byName = new Map();
  // имя может быть «Чуул [Chuul]» или «Виверна / Wyvern» — ищем по целому имени и по каждой его части
  const keys = (name) => [...new Set([norm(name), ...String(name ?? "").split(/[\[\]\/|()]/).map(norm)].filter(Boolean))];
  for (const a of npcs) for (const k of keys(a.name)) { if (!byName.has(k)) byName.set(k, []); byName.get(k).push(a); }
  const find = (names) => [...new Set(names.flatMap(n => byName.get(norm(n)) ?? []))];

  const direct = [];   // { t, actor }
  const copies = [];   // { t, base }
  for (const t of D.tokens) {
    const own = find([t.name, ...t.match]);
    for (const actor of own) direct.push({ t, actor });
    if (!t.clone.length) continue;
    if (find([t.name]).length) continue;            // свой актёр уже есть
    const base = find(t.clone)[0];
    if (base) copies.push({ t, base });
  }
  const ids = new Map(direct.map(d => [d.actor.id, d.t]));
  const placed = [];
  for (const sc of game.scenes) for (const tk of sc.tokens) { const t = ids.get(tk.actorId); if (t) placed.push({ sc, tk, t }); }

  if (!direct.length && !copies.length) return ui.notifications.warn("Остров: в мире не нашлось ни одного подходящего существа. Сначала импортируй мобов из компендиума.");
  const li = (a) => a.map(x => `<li>${foundry.utils.escapeHTML(x)}</li>`).join("");
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Токены мобов острова" },
    content: `<div style="max-height:55vh;overflow:auto">
      <p><b>Заменю токен</b> у ${direct.length} актёров (портрет не трогаю) и перенесу их в папки «${D.folder}» по группам:</p><ul>${li(direct.map(d => `${d.actor.name} → ${d.t.name}${d.t.n > 1 ? ` (${d.t.n} вариаций)` : ""}`))}</ul>
      <p><b>Создам копии</b> в тех же папках — ${copies.length}:</p><ul>${li(copies.map(c => `${c.t.name} — из «${c.base.name}»${c.t.n > 1 ? ` (${c.t.n} вариаций)` : ""}`))}</ul>
      <p>Токенов этих актёров на сценах: ${placed.length} — получат случайную вариацию.</p></div>`
  });
  if (!ok) return;

  // папки: «Остров · мобы» → по группам
  const root = game.folders.find(f => f.type === "Actor" && f.name === D.folder && !f.folder) ?? await Folder.create({ name: D.folder, type: "Actor", color: "#2f7a5b" });
  const sub = new Map();
  for (const [i, g] of (D.groups ?? []).entries()) {
    sub.set(g, game.folders.find(f => f.type === "Actor" && f.name === g && f.folder?.id === root.id)
      ?? await Folder.create({ name: g, type: "Actor", folder: root.id, sorting: "a", sort: (i + 1) * 100, color: "#2f7a5b" }));
  }
  const home = (t) => (sub.get(t.group) ?? root).id;
  for (const { t, actor } of direct) await actor.update({ ...proto(t), folder: home(t) });
  // копии, созданные раньше и лежащие в общей папке, тоже раскладываем
  const old = game.actors.filter(a => a.getFlag(MOD, "token") && !direct.some(d => d.actor.id === a.id));
  for (const a of old) { const t = D.tokens.find(x => x.slug === a.getFlag(MOD, "token")); if (t && a.folder?.id !== home(t)) await a.update({ folder: home(t) }); }
  if (copies.length) {
    const docs = copies.map(({ t, base }) => {
      const o = base.toObject(); delete o._id;
      o.name = t.name; o.folder = home(t); o.flags = { ...(o.flags ?? {}), [MOD]: { token: t.slug } };
      o.prototypeToken = { ...o.prototypeToken, name: t.name, randomImg: t.n > 1, texture: { ...o.prototypeToken.texture, scaleX: 1, scaleY: 1, src: t.n > 1 ? `${dir(t)}/*.webp` : one(t, 1) }, ring: { ...(o.prototypeToken.ring ?? {}), enabled: false } };
      return o;
    });
    await Actor.createDocuments(docs);
  }
  const bySc = new Map(); const turn = new Map();
  for (const { sc, tk, t } of placed) {
    const i = (turn.get(t.slug) ?? Math.floor(Math.random() * t.n)) % t.n; turn.set(t.slug, i + 1);
    if (!bySc.has(sc)) bySc.set(sc, []);
    bySc.get(sc).push({ _id: tk.id, "texture.src": one(t, i + 1), "texture.scaleX": 1, "texture.scaleY": 1, "ring.enabled": false });
  }
  for (const [sc, ups] of bySc) await sc.updateEmbeddedDocuments("Token", ups);
  ui.notifications.info(`Остров: токены заменены у ${direct.length} актёров, создано копий ${copies.length}, обновлено токенов на сценах ${placed.length}.`);
}
