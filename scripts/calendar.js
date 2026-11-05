/* Календарь Эластрии (черновик) для ядра Foundry. Simple Timekeeping и другие модули читают game.time.calendar. */
const MOD = "lizard-isle";
export const ELASTRIA = {
  name: "Эластрия", description: "Календарь Эластрии. Год 1279 — кампания «Скрытые земли людоящеров».",
  years: { yearZero: 0, firstWeekday: 0, leapYear: { leapStart: 0, leapInterval: 4 } },
  months: { values: [
    ["Месяц Кишина", "Киш", 31], ["Месяц Эйлин", "Эйл", 28, 29], ["Месяц Авроры", "Авр", 31], ["Месяц Мелодии", "Мел", 30],
    ["Месяц Фины", "Фин", 31], ["Месяц Сириуса", "Сир", 30], ["Месяц Аматуса", "Амт", 31], ["Месяц Панцерфауста", "Пнц", 31],
    ["Месяц Дрейвена", "Дрв", 30], ["Месяц Пинки", "Пнк", 31], ["Месяц Барагона", "Бар", 30], ["Месяц Симори", "Сим", 31]
  ].map(([name, abbreviation, days, leapDays], i) => ({ name, abbreviation, ordinal: i + 1, days, leapDays: leapDays ?? days })) },
  days: { values: [
    ["День Дрейвена", "Дрв"], ["День Авроры", "Авр"], ["День Мелодии", "Мел"], ["День Симори", "Сим"],
    ["День Сириуса", "Сир"], ["День Аматуса", "Амт"], ["День Роско", "Рск"]
  ].map(([name, abbreviation], i) => ({ name, abbreviation, ordinal: i + 1, isRestDay: i === 6 })),
    daysPerYear: 365, hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60 },
  seasons: { values: [
    { name: "Зима", monthStart: 12, monthEnd: 2 }, { name: "Весна", monthStart: 3, monthEnd: 5 },
    { name: "Лето", monthStart: 6, monthEnd: 8 }, { name: "Осень", monthStart: 9, monthEnd: 11 }
  ] }
};

export function registerCalendar() {
  game.settings.register(MOD, "calendar", { name: "Календарь Эластрии", hint: "Заменяет календарь мира на эластрийский (12 месяцев по богам, 1279 год). Нужна перезагрузка.",
    scope: "world", config: true, type: Boolean, default: true, requiresReload: true });
  try { if (game.settings.get(MOD, "calendar") && CONFIG.time) CONFIG.time.worldCalendarConfig = ELASTRIA; } catch (e) { console.warn("Остров | календарь", e); }
}

export function parts() {
  try {
    const cal = game.time.calendar, c = cal.timeToComponents(game.time.worldTime);
    const m = cal.months?.values?.[c.month], wd = cal.days?.values?.[c.dayOfWeek];
    return { ...c, monthName: m?.name ?? `месяц ${c.month + 1}`, weekday: wd?.name ?? "", date: c.dayOfMonth + 1 };
  } catch (e) { return null; }
}
export const fmtDate = (p) => p ? `${p.date} ${p.monthName.replace("Месяц ", "")}, ${p.year} · ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}` : "";

export async function setDate({ year, month, day, hour }) {
  const cal = game.time.calendar;
  const t = cal.componentsToTime({ year, day: 0, hour, minute: 0, second: 0 });
  let doy = 0; const leap = cal.isLeapYear?.(year);
  for (let i = 0; i < month; i++) { const m = cal.months.values[i]; doy += leap ? (m.leapDays ?? m.days) : m.days; }
  const target = t + (doy + day - 1) * cal.days.hoursPerDay * cal.days.minutesPerHour * cal.days.secondsPerMinute;
  await game.time.advance(target - game.time.worldTime);
}
