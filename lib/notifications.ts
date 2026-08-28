import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  if (existingStatus === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// Finds the next occurrence of startDate + k*intervalDays that is >= now.
export function computeNextDueDate(startDate: Date, intervalDays: number, now: Date): Date {
  if (startDate.getTime() >= now.getTime()) return startDate;

  const elapsedDays = (now.getTime() - startDate.getTime()) / MS_PER_DAY;
  const intervalsPassed = Math.ceil(elapsedDays / intervalDays);
  return new Date(startDate.getTime() + intervalsPassed * intervalDays * MS_PER_DAY);
}

async function scheduleOneShot(title: string, dueDate: Date): Promise<string> {
  const seconds = Math.max(1, Math.round((dueDate.getTime() - Date.now()) / 1000));
  return Notifications.scheduleNotificationAsync({
    content: { title, body: `Don't forget "${title}"!` },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
    },
  });
}

// A native, OS-managed repeating trigger: once scheduled, the OS keeps firing
// it every intervalDays with no app code involved, so delivery doesn't depend
// on the app ever being reopened.
async function scheduleRepeating(title: string, intervalDays: number): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: { title, body: `Don't forget "${title}"!` },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: intervalDays * 24 * 60 * 60,
      repeats: true,
    },
  });
}

// Schedules a precise one-shot for the very next due date (so it lands exactly
// on the chosen start day/time), plus — unless the reminder only happens once —
// a native repeating trigger that covers every occurrence after that indefinitely.
export async function scheduleReminderNotifications(
  title: string,
  firstDueDate: Date,
  intervalDays: number,
  repeats: boolean
): Promise<{ notificationId: string; repeatingNotificationId: string | null }> {
  const notificationId = await scheduleOneShot(title, firstDueDate);
  const repeatingNotificationId = repeats ? await scheduleRepeating(title, intervalDays) : null;
  return { notificationId, repeatingNotificationId };
}

export async function cancelNotification(notificationId: string | null) {
  if (!notificationId) return;
  await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => {});
}

export function androidChannelSetup() {
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}
