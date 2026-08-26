import * as SQLite from 'expo-sqlite';

export type IntervalUnit = 'day' | 'week' | 'month' | 'year';

export type Reminder = {
  id: number;
  title: string;
  startDate: string; // ISO datetime — the chosen starting day combined with the chosen notification time
  intervalValue: number; // the natural number the user entered, e.g. 2
  intervalUnit: IntervalUnit; // the unit that number is in, e.g. 'month'
  intervalDays: number; // intervalValue converted to days, used for scheduling/due-date math
  repeats: number; // 0 or 1 — whether this reminder recurs, or only happens once
  notificationId: string | null; // one-shot notification for the first occurrence
  repeatingNotificationId: string | null; // native repeating notification for every occurrence after that (null when repeats = 0)
};

const db = SQLite.openDatabaseSync('reminders.db');

export async function initDb() {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(reminders)');
  const hasCurrentSchema = columns.some((c) => c.name === 'intervalUnit');
  if (columns.length > 0 && !hasCurrentSchema) {
    await db.execAsync('DROP TABLE reminders');
  }

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      startDate TEXT NOT NULL,
      intervalValue INTEGER NOT NULL DEFAULT 1,
      intervalUnit TEXT NOT NULL DEFAULT 'day',
      intervalDays INTEGER NOT NULL,
      repeats INTEGER NOT NULL DEFAULT 1,
      notificationId TEXT,
      repeatingNotificationId TEXT
    );
  `);
}

export async function getReminders(): Promise<Reminder[]> {
  return db.getAllAsync<Reminder>('SELECT * FROM reminders ORDER BY id ASC');
}

export async function insertReminder(
  title: string,
  startDate: string,
  intervalValue: number,
  intervalUnit: IntervalUnit,
  intervalDays: number,
  repeats: boolean,
  notificationId: string | null,
  repeatingNotificationId: string | null
): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO reminders (title, startDate, intervalValue, intervalUnit, intervalDays, repeats, notificationId, repeatingNotificationId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    title,
    startDate,
    intervalValue,
    intervalUnit,
    intervalDays,
    repeats ? 1 : 0,
    notificationId,
    repeatingNotificationId
  );
  return result.lastInsertRowId;
}

export async function updateReminder(
  id: number,
  title: string,
  startDate: string,
  intervalValue: number,
  intervalUnit: IntervalUnit,
  intervalDays: number,
  repeats: boolean,
  notificationId: string | null,
  repeatingNotificationId: string | null
) {
  await db.runAsync(
    'UPDATE reminders SET title = ?, startDate = ?, intervalValue = ?, intervalUnit = ?, intervalDays = ?, repeats = ?, notificationId = ?, repeatingNotificationId = ? WHERE id = ?',
    title,
    startDate,
    intervalValue,
    intervalUnit,
    intervalDays,
    repeats ? 1 : 0,
    notificationId,
    repeatingNotificationId,
    id
  );
}

export async function deleteReminder(id: number) {
  await db.runAsync('DELETE FROM reminders WHERE id = ?', id);
}
