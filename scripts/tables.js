/* Случайные таблицы острова: создаёт RollTable в папке «Остров · случайные таблицы» из data/tables.json. */
const MOD = "lizard-isle";
export async function buildTables() {
  if (!game.user.isGM) return ui.notifications.warn("Только мастер.");
  const D = await (await fetch(`modules/${MOD}/data/tables.json`)).json();
  const folder = game.folders.find(f => f.type === "RollTable" && f.name === D.folder) ?? await Folder.create({ name: D.folder, type: "RollTable", color: "#2f7a5b" });
  const old = game.tables.filter(t => t.getFlag(MOD, "table"));
  if (old.length) await RollTable.deleteDocuments(old.map(t => t.id));
  const docs = D.tables.map((t, i) => ({
    name: t.name, folder: folder.id, sort: i * 100, formula: t.formula, replacement: true, displayRoll: true,
    description: t.note ?? "", img: "icons/svg/d20-grey.svg", flags: { [MOD]: { table: t.key } },
    results: t.rows.map((r, j) => ({ type: "text", text: r, description: r, name: r, range: [j + 1, j + 1], weight: 1, drawn: false }))
  }));
  await RollTable.createDocuments(docs);
  ui.notifications.info(`Остров: ${docs.length} случайных таблиц в папке «${D.folder}».`);
}
