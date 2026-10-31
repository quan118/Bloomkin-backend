import type { Locale, LogType } from './model.js';

const LOG_LABELS: Record<Locale, Record<LogType, string>> = {
  vi: {
    breastfeed: 'bú mẹ',
    bottle: 'bú bình',
    pump: 'hút sữa',
    sleep: 'giấc ngủ',
    diaper: 'thay tã',
    measurement: 'số đo',
    temperature: 'nhiệt độ',
    medicine: 'thuốc',
    symptom: 'triệu chứng',
    note: 'ghi chú',
    kick: 'cử động thai',
    contraction: 'cơn gò',
  },
  en: {
    breastfeed: 'a breastfeed',
    bottle: 'a bottle feed',
    pump: 'a pumping session',
    sleep: 'a sleep',
    diaper: 'a diaper change',
    measurement: 'measurements',
    temperature: 'a temperature',
    medicine: 'medicine',
    symptom: 'a symptom',
    note: 'a note',
    kick: 'kick counts',
    contraction: 'contractions',
  },
};

const TEMPLATES: Record<Locale, (actor: string, label: string) => string> = {
  vi: (actor, label) => `${actor} vừa ghi ${label}`,
  en: (actor, label) => `${actor} logged ${label}`,
};

export function toLocale(value: unknown): Locale {
  return typeof value === 'string' && value.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

/** Push notification text sent to the other people who follow a baby. */
export function logNotification(
  locale: Locale,
  input: { actorName: string; babyName: string; type: LogType },
): { title: string; body: string } {
  const label = LOG_LABELS[locale][input.type];
  return { title: input.babyName, body: TEMPLATES[locale](input.actorName, label) };
}
