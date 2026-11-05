/*
 * Пещера Эха (Е-9): две сцены — «Явь» (ледяная пещера) и «Сон» (лаборатория с капсулами).
 * Карты лежат у мастера на сервере в Data/peshera_eha/. Какой файл какой — мастер выбирает в окне.
 * Пин «⇄» на сцене: двойной клик — переход между Явью и Сном.
 */
const MOD = "lizard-isle";
const DIR = "peshera_eha";
const FOLDER = "Пещера Эха";
const IMG = /\.(webp|png|jpe?g|avif|mp4|webm)$/i;

const NOTES = {
  real: [
    [0.11, 0.13, "Грот с озером. Вход, эхо ещё тихое."],
    [0.45, 0.10, "Северные дуги. Капитан слышит свою команду."],
    [0.84, 0.30, "Зал голосов. Сводит с ума; проходит только монах."],
    [0.46, 0.50, "Провал. Отсюда все голоса. Здесь засыпают — переход в Сон."],
    [0.25, 0.70, "Юго-западный зал. Логово Эхо-мимика."],
    [0.68, 0.70, "Карман. Осколок карты игл, голос подруги."]
  ],
  dream: [
    [0.13, 0.20, "Кушетка и приборы. Здесь Леонин «просыпается»."],
    [0.70, 0.18, "Галерея капсул. В шести капсулах — убитые друзья, каждый шепчет своё."],
    [0.12, 0.55, "Почерк подруги на приборах (для волшебника)."],
    [0.62, 0.78, "Зал чанов. То, что растёт здесь. Выход на востоке — ответить друзьям правду."]
  ]
};

async function pickFiles(files) {
  const opts = files.map(f => `<option value="${f}">${decodeURIComponent(f.split("/").pop())}</option>`).join("");
  return foundry.applications.api.DialogV2.prompt({
    window: { title: "Пещера Эха: какие карты" },
    content: `<p>Выбери файлы из <b>Data/${DIR}/</b>.</p>
      <label style="display:block;margin:6px 0">Явь (ледяная пещера)<select name="real" style="width:100%">${opts}</select></label>
      <label style="display:block;margin:6px 0">Сон (лаборатория с капсулами)<select name="dream" style="width:100%">${files.map((f, i) => `<option value="${f}"${i === 1 ? " selected" : ""}>${decodeURIComponent(f.split("/").pop())}</option>`).join("")}</select></label>`,
    ok: { label: "Собрать", callback: (ev, btn) => ({ real: btn.form.elements.real.value, dream: btn.form.elements.dream.value }) }
  });
}

const dims = (src) => new Promise((res) => {
  if (/\.(mp4|webm)$/i.test(src)) { const v = document.createElement("video"); v.onloadedmetadata = () => res([v.videoWidth, v.videoHeight]); v.onerror = () => res([2000, 1500]); v.src = src; return; }
  const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res([2000, 1500]); i.src = src;
});

export async function buildEcho() {
  if (!game.user.isGM) return ui.notifications.warn("Только мастер.");
  let files = [];
  try {
    const FP = foundry.applications.apps.FilePicker.implementation ?? FilePicker;
    files = (await FP.browse("data", DIR)).files.filter(f => IMG.test(f));
  } catch (e) { }
  if (files.length < 2) return ui.notifications.error(`В Data/${DIR}/ нужно минимум 2 карты (Явь и Сон). Нашёл: ${files.length}.`, { permanent: true });
  const pick = await pickFiles(files); if (!pick) return;
  if (pick.real === pick.dream) return ui.notifications.warn("Явь и Сон — один и тот же файл. Выбери разные.");
  let folder = game.folders.find(x => x.type === "Scene" && x.name === FOLDER) ?? await Folder.create({ name: FOLDER, type: "Scene", color: "#2c5b6b" });
  const old = game.scenes.filter(s => s.getFlag(MOD, "echo"));
  if (old.length) await Scene.deleteDocuments(old.map(s => s.id));
  const mk = async (key, name, src, dark) => {
    const [w, h] = await dims(src);
    return { name, folder: folder.id, width: w, height: h, padding: 0, background: { src }, backgroundColor: "#000000",
      grid: { type: 1, size: Math.round(w / 40), alpha: 0 }, tokenVision: true, fog: { exploration: true },
      environment: { darknessLevel: dark }, navigation: false, flags: { [MOD]: { echo: key } } };
  };
  const [real, dream] = await Scene.createDocuments([await mk("real", "Пещера Эха · Явь", pick.real, 0.35), await mk("dream", "Пещера Эха · Сон", pick.dream, 0.1)]);
  for (const [s, other, key, label] of [[real, dream, "real", "⇄ Уснуть у провала → Сон"], [dream, real, "dream", "⇄ Проснуться → Явь"]]) {
    const W = s.width, H = s.height;
    const notes = NOTES[key].map(([x, y, t]) => ({ x: Math.round(W * x), y: Math.round(H * y), text: t, texture: { src: "icons/svg/book.svg", tint: "#9fd3e0" },
      iconSize: 34, fontSize: 18, flags: { [MOD]: { info: true } } }));
    const at = key === "real" ? [0.46, 0.43] : [0.93, 0.80];
    notes.push({ x: Math.round(W * at[0]), y: Math.round(H * at[1]), text: label, texture: { src: "icons/svg/sleep.svg", tint: "#e8c46a" }, iconSize: 44, fontSize: 22,
      flags: { [MOD]: { go: other.id } } });
    await s.createEmbeddedDocuments("Note", notes);
  }
  ui.notifications.info("Пещера Эха: сцены «Явь» и «Сон» готовы. Двойной клик по ⇄ — переход. Пины с книжкой — подсказки по залам, двигай как удобно.", { permanent: true });
}
