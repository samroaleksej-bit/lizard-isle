/*
 * Лабиринт Ордена (М-25) — 20 сцен из анимированных тайлов Epic Quest «Tombs of the Forbidden Souls».
 * Видео в модуль не входят: мастер кладёт их на сервер в Data/labirint-ordena/ (имена файлов как в архиве).
 * Пины на сцене: «→ NN · Название» — двойной клик переносит всех на соседнюю сцену,
 * «⟳ …» — переключает вариант тайла (ловушка, тени, огненный череп).
 */
const MOD = "lizard-isle";
const DIR = "labirint-ordena";
const FOLDER = "Лабиринт Ордена";
const url = (p) => String(p).split("/").map(encodeURIComponent).join("/");
const f = (name) => `${DIR}/${name}.mp4`;

// dir: куда идёт выход на сцене (L/R/T/B) — пин ставится у этого края.
export const ROOMS = [
  { n: 1,  name: "Врата усыпальницы", file: "MD02-01", note: "Вход. Пройти вглубь зала — встают тени.", variants: [["Тени", "MD02-01b (Shadows)"]], exits: [] },
  { n: 2,  name: "Малая часовня", file: "MD02-02", exits: [[7, "B"]] },
  { n: 3,  name: "Колодезная", file: "MD02-03", exits: [[4, "R"], [8, "B"]] },
  { n: 4,  name: "Изломанный коридор", file: "MD02-04", exits: [[3, "L"], [9, "B"]] },
  { n: 5,  name: "Зал игл", file: "MD02-05 (Trap OFF)", note: "Ловушка.", variants: [["Ловушка включена", "MD02-05 (Trap ON)"], ["Ловушка вкл/выкл", "MD02-05 (Trap ON and Off)"]], exits: [[10, "B"]] },
  { n: 6,  name: "Скрипторий", file: "MD02-06", exits: [[7, "R"], [11, "B"]] },
  { n: 7,  name: "Провал", file: "MD02-07", exits: [[2, "T"], [6, "L"], [8, "R"], [12, "B"]] },
  { n: 8,  name: "Перекрёсток", file: "MD02-08", exits: [[3, "T"], [7, "L"], [13, "B"]] },
  { n: 9,  name: "Караульня", file: "MD02-09", exits: [[4, "T"], [10, "R"], [14, "B"]] },
  { n: 10, name: "Звёздный ров", file: "MD02-10", variants: [["С сеткой", "MD02-10 (Grid)"]], exits: [[5, "T"], [9, "L"]] },
  { n: 11, name: "Северный проход", file: "MD02-11", variants: [["Вариант", "MD02-11 (Variation)"]], exits: [[6, "T"], [12, "R"], [16, "B"]] },
  { n: 12, name: "Обрушенный алтарь", file: "MD02-12", exits: [[7, "T"], [11, "L"], [13, "R"]] },
  { n: 13, name: "Огненная галерея", file: "MD02-13 (Trap)", note: "Ловушка.", exits: [[12, "L"], [14, "R"]] },
  { n: 14, name: "Колодец", file: "MD02-14", variants: [["Яма открыта", "MD02-14 (Trap)"]], exits: [[9, "T"], [13, "L"], [15, "R"]] },
  { n: 15, name: "Склеп магистра", file: "MD02-15", variants: [["Ловушка", "MD02-15 (Trap)"]], exits: [[14, "L"]] },
  { n: 16, name: "Лестничный зал", file: "MD02-16", exits: [[11, "T"], [17, "R"]] },
  { n: 17, name: "Галерея стражей I", file: "MD02-17", exits: [[16, "L"], [18, "R"]] },
  { n: 18, name: "Галерея стражей II", file: "MD02-18", variants: [["Ловушка", "MD02-18 (Trap)"]], exits: [[17, "L"], [19, "R"]] },
  { n: 19, name: "Зал Печати", file: "MD02-19", note: "Финал. Войти в центр — тени и Огненный череп.", variants: [["Огненный череп", "MD02-19 (Fire Skull)"], ["Вариант", "MD02-19 (Variation)"]], exits: [[18, "L"], [20, "R"]] },
  { n: 20, name: "Спуск", file: "MD02-20", note: "Лестница на нижний уровень.", exits: [[19, "L"]] }
];
// 01 — вход; от него к лабиринту ведёт проход к Малой часовне.
ROOMS[0].exits = [[2, "R"]];
ROOMS[1].exits.unshift([1, "L"]);

const W = 1920, H = 1080, GRID = 56;
const title = (r) => `${String(r.n).padStart(2, "0")} · ${r.name}`;
const POS = { L: [70, H / 2], R: [W - 70, H / 2], T: [W / 2, 60], B: [W / 2, H - 60] };

export async function buildLabyrinth() {
  if (!game.user.isGM) return ui.notifications.warn("Только мастер.");
  // проверка файлов на сервере
  let have = null;
  try {
    const FP = foundry.applications.apps.FilePicker.implementation ?? FilePicker;
    const res = await FP.browse("data", DIR);
    have = new Set(res.files.map(x => decodeURIComponent(x.split("/").pop())));
  } catch (e) { have = null; }
  if (have) {
    const need = ROOMS.flatMap(r => [r.file, ...(r.variants ?? []).map(v => v[1])]).map(x => x + ".mp4");
    const miss = need.filter(x => !have.has(x));
    if (miss.length === need.length) return ui.notifications.error(`Не нашёл видео в Data/${DIR}/. Залей туда MP4 из архива.`, { permanent: true });
    if (miss.length) ui.notifications.warn(`Нет файлов (${miss.length}): ${miss.slice(0, 5).join(", ")}${miss.length > 5 ? "…" : ""}`, { permanent: true });
  }
  let folder = game.folders.find(x => x.type === "Scene" && x.name === FOLDER);
  if (!folder) folder = await Folder.create({ name: FOLDER, type: "Scene", color: "#6b4a2a" });
  const old = game.scenes.filter(s => s.getFlag(MOD, "lab"));
  if (old.length) {
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Лабиринт Ордена" }, content: `<p>Сцены лабиринта уже есть (${old.length}). Пересоздать?</p>` });
    if (!ok) return;
    await Scene.deleteDocuments(old.map(s => s.id));
  }
  const data = ROOMS.map((r, i) => ({
    name: title(r), folder: folder.id, sort: i * 100, width: W, height: H, padding: 0,
    background: { src: url(f(r.file)) }, backgroundColor: "#000000",
    grid: { type: 1, size: GRID, alpha: 0 }, tokenVision: true, fog: { exploration: true },
    environment: { darknessLevel: 0.15 }, navigation: false,
    flags: { [MOD]: { lab: r.n } }
  }));
  const scenes = await Scene.createDocuments(data);
  const byN = Object.fromEntries(scenes.map(s => [s.getFlag(MOD, "lab"), s]));
  for (const r of ROOMS) {
    const s = byN[r.n], notes = [];
    const seen = {};
    for (const [to, d] of r.exits) {
      const k = (seen[d] = (seen[d] ?? 0) + 1) - 1;
      const [x, y] = POS[d];
      notes.push({ x: x + (d === "T" || d === "B" ? k * 160 : 0), y: y + (d === "L" || d === "R" ? k * 90 : 0),
        text: `→ ${title(ROOMS[to - 1])}`, texture: { src: "icons/svg/door-exit.svg", tint: "#e8c46a" }, iconSize: 40, fontSize: 22,
        textAnchor: d === "B" ? 2 : 1, global: false, flags: { [MOD]: { go: byN[to].id } } });
    }
    const vs = [["Обычный", r.file], ...(r.variants ?? [])];
    if (vs.length > 1) notes.push({ x: W / 2, y: H / 2 - 120, text: `⟳ ${vs.map(v => v[0]).join(" / ")}`, texture: { src: "icons/svg/clockwork.svg", tint: "#e4677c" },
      iconSize: 36, fontSize: 18, flags: { [MOD]: { variants: vs.map(v => [v[0], url(f(v[1]))]) } } });
    if (r.note) notes.push({ x: W / 2, y: H / 2, text: r.note, texture: { src: "icons/svg/book.svg", tint: "#c9b089" }, iconSize: 32, fontSize: 18, flags: { [MOD]: { info: true } } });
    if (notes.length) await s.createEmbeddedDocuments("Note", notes);
  }
  ui.notifications.info(`Лабиринт Ордена: ${scenes.length} сцен в папке «${FOLDER}». Двойной клик по «→» — переход всей партии.`, { permanent: true });
  return scenes;
}

/** Двойной клик по пину лабиринта: переход или смена варианта тайла. */
Hooks.on("activateNote", (note) => {
  const fl = note.document.flags?.[MOD]; if (!fl) return;
  if (fl.go) {
    if (!game.user.isGM) return false;
    const s = game.scenes.get(fl.go); if (s) s.activate();
    return false;
  }
  if (fl.variants) {
    if (!game.user.isGM) return false;
    const sc = note.document.parent, cur = sc.background.src;
    const i = fl.variants.findIndex(v => v[1] === cur), next = fl.variants[(i + 1) % fl.variants.length];
    sc.update({ "background.src": next[1] });
    ui.notifications.info(`${sc.name}: ${next[0]}`);
    return false;
  }
  if (fl.info) return false;
});
