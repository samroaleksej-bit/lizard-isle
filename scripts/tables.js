/* Случайные таблицы острова и автоброски при переходе партии. */
const MOD = "lizard-isle";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Создаёт недостающие таблицы. Уже созданные (и отредактированные мастером) не трогает, если не попросить recreate. */
export async function buildTables({ recreate = false } = {}) {
  if (!game.user.isGM) return ui.notifications.warn("Только мастер.");
  const D = await (await fetch(`modules/${MOD}/data/tables.json`)).json();
  const folder = game.folders.find(f => f.type === "RollTable" && f.name === D.folder) ?? await Folder.create({ name: D.folder, type: "RollTable", color: "#2f7a5b" });
  const have = new Map(game.tables.filter(t => t.getFlag(MOD, "table")).map(t => [t.getFlag(MOD, "table"), t]));
  if (recreate && have.size) { await RollTable.deleteDocuments([...have.values()].map(t => t.id)); have.clear(); }
  const docs = D.tables.filter(t => !have.has(t.key)).map((t, i) => ({
    name: t.name, folder: folder.id, sort: D.tables.indexOf(t) * 100, formula: t.formula, replacement: true, displayRoll: true,
    description: t.note ?? "", img: "icons/svg/d20-grey.svg", flags: { [MOD]: { table: t.key } },
    results: t.rows.map((r, j) => { const [text, a, b] = Array.isArray(r) ? r : [r, j + 1, j + 1];
      return { type: "text", text, description: text, name: text, range: [a, b], weight: b - a + 1, drawn: false }; })
  }));
  if (docs.length) await RollTable.createDocuments(docs);
  ui.notifications.info(docs.length ? `Остров: создано таблиц ${docs.length}. Твои правки в старых сохранены.` : "Остров: все таблицы уже есть. Твои правки не тронуты.");
}

const table = (key) => game.tables.find(t => t.getFlag(MOD, "table") === key);
const resText = (r) => r?.description || r?.text || r?.name || "";
async function draw(key) {
  const t = table(key); if (!t) return null;
  const res = await t.draw({ displayChat: false });
  return { roll: res.roll?.total, text: res.results.map(resText).join("; "), name: t.name };
}

/* местность → боевая таблица */
const ZONE = { b: "coast", ",": "coast", r: "coast", j: "jungle", d: "jungle", s: "swamp", f: "swamp", c: "canopy", T: "canopy", u: "ruins", m: "ruins", h: "ruins", n: "ruins" };

export const hasTables = () => !!table("when");

/** Бросок «что происходит» для одного гекса. Возвращает { gm, public } строки HTML (или null). */
export async function rollHex(ch, hexLabel) {
  const w = await draw("when"); if (!w) return null;
  const t = w.text.toLowerCase();
  let kind = "none";
  if (t.includes("небоев")) kind = "talk";
  else if (t.includes("бой")) kind = "combat";
  else if (t.includes("наход")) kind = "loot";
  else if (t.includes("опасн")) kind = "hazard";
  else if (t.includes("знак") || t.includes("фракц")) kind = Math.random() < 0.5 ? "omen" : "faction";
  const head = `<span class="mute">«Когда бросать» к = ${w.roll}</span>`;
  if (kind === "none") return { gm: `${head} · ничего не происходит`, pub: null };
  const key = kind === "combat" ? ZONE[ch] ?? "jungle" : kind;
  const r = await draw(key);
  if (!r) return { gm: `${head} · ${esc(w.text)} (нет таблицы «${key}»)`, pub: null };
  const ICON = { combat: "⚔", talk: "👣", loot: "🎁", hazard: "⚠", omen: "👁", faction: "⚑" };
  const line = `${ICON[kind]} <b>${esc(r.name.replace(/^\d+\s·\s/, ""))}</b> (к = ${r.roll}): ${esc(r.text)}`;
  if (kind === "combat") return { gm: `${head}<br>${line}`, pub: null, combat: true, text: r.text, where: hexLabel };
  return { gm: `${head}<br>${line}`, pub: `${ICON[kind]} ${esc(r.text)}`, kind, text: r.text, where: hexLabel };
}
