import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ReorderableList, {
  ReorderableListReorderEvent,
  reorderItems,
  useIsActive,
  useReorderableDrag,
} from 'react-native-reorderable-list';
import type { ListRenderItemInfo } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {
  IntervalUnit,
  Reminder,
  deleteReminder,
  getReminders,
  initDb,
  insertReminder,
  updateReminder,
  updateReminderOrder,
} from './lib/db';
import {
  androidChannelSetup,
  cancelNotification,
  computeNextDueDate,
  requestNotificationPermissions,
  scheduleReminderNotifications,
} from './lib/notifications';

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function defaultNotificationTime(): Date {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return d;
}

function combineDateAndTime(date: Date, time: Date): Date {
  const combined = new Date(date);
  combined.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return combined;
}

function formatDateTime(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }) + ' · ' + date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const INTERVAL_UNITS: IntervalUnit[] = ['day', 'week', 'month', 'year'];

const UNIT_TO_DAYS: Record<IntervalUnit, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

function unitLabel(unit: IntervalUnit, value: number): string {
  return `${unit}${value === 1 ? '' : 's'}`;
}

function getDueDate(reminder: Reminder, now: Date): Date {
  const anchor = new Date(reminder.startDate);
  return reminder.repeats
    ? computeNextDueDate(anchor, reminder.intervalDays, now)
    : anchor;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b);
}

type Occurrence = { reminder: Reminder; date: Date };

// Reminders don't store their occurrences — every occurrence in a date range is derived by
// walking forward from the reminder's anchor date in steps of intervalDays. Since that walk
// only ever moves forward from the anchor, a reminder created partway through a month (e.g.
// "pay rent" set up on Aug 15 for the 29th) can never produce an occurrence before Aug 29,
// even though later months show one every time around.
function getOccurrencesInRange(reminders: Reminder[], rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const reminder of reminders) {
    const anchor = new Date(reminder.startDate);
    if (!reminder.repeats) {
      if (anchor >= rangeStart && anchor < rangeEnd) occurrences.push({ reminder, date: anchor });
      continue;
    }
    const intervalMs = reminder.intervalDays * MS_PER_DAY;
    if (intervalMs <= 0 || anchor >= rangeEnd) continue;

    let step = anchor < rangeStart ? Math.ceil((rangeStart.getTime() - anchor.getTime()) / intervalMs) : 0;
    let candidate = new Date(anchor.getTime() + step * intervalMs);
    while (candidate < rangeEnd) {
      if (candidate >= rangeStart) occurrences.push({ reminder, date: candidate });
      step += 1;
      candidate = new Date(anchor.getTime() + step * intervalMs);
    }
  }
  return occurrences.sort((a, b) => a.date.getTime() - b.date.getTime());
}

function CalendarView({ reminders, now }: { reminders: Reminder[]; now: Date }) {
  const today = startOfDay(now);
  const [mode, setMode] = useState<'days' | 'months'>('days');
  const [viewedYear, setViewedYear] = useState(today.getFullYear());
  const [viewedMonth, setViewedMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(today);

  const gridStart = useMemo(() => {
    const firstOfMonth = new Date(viewedYear, viewedMonth, 1);
    return new Date(viewedYear, viewedMonth, 1 - firstOfMonth.getDay());
  }, [viewedYear, viewedMonth]);

  const gridDays = useMemo(
    () => Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)),
    [gridStart]
  );

  const occurrencesByDay = useMemo(() => {
    const rangeEnd = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + 42);
    const map = new Map<string, Occurrence[]>();
    for (const occurrence of getOccurrencesInRange(reminders, gridStart, rangeEnd)) {
      const key = dateKey(occurrence.date);
      const existing = map.get(key);
      if (existing) existing.push(occurrence);
      else map.set(key, [occurrence]);
    }
    return map;
  }, [reminders, gridStart]);

  function goPrev() {
    if (mode === 'months') {
      setViewedYear((y) => y - 1);
    } else if (viewedMonth === 0) {
      setViewedMonth(11);
      setViewedYear((y) => y - 1);
    } else {
      setViewedMonth((m) => m - 1);
    }
  }

  function goNext() {
    if (mode === 'months') {
      setViewedYear((y) => y + 1);
    } else if (viewedMonth === 11) {
      setViewedMonth(0);
      setViewedYear((y) => y + 1);
    } else {
      setViewedMonth((m) => m + 1);
    }
  }

  const selectedOccurrences = occurrencesByDay.get(dateKey(selectedDate)) ?? [];

  return (
    <View style={styles.calendarContainer}>
      <View style={styles.calendarHeaderRow}>
        <Pressable onPress={goPrev} hitSlop={12} style={styles.calendarNavButton}>
          <Ionicons name="chevron-back" size={22} color="#2f6fed" />
        </Pressable>
        <Pressable onPress={() => setMode(mode === 'days' ? 'months' : 'days')}>
          <Text style={styles.calendarHeaderTitle}>
            {mode === 'days' ? `${MONTH_NAMES[viewedMonth]} ${viewedYear}` : String(viewedYear)}
          </Text>
        </Pressable>
        <Pressable onPress={goNext} hitSlop={12} style={styles.calendarNavButton}>
          <Ionicons name="chevron-forward" size={22} color="#2f6fed" />
        </Pressable>
      </View>

      {mode === 'months' ? (
        <View style={styles.monthGrid}>
          {MONTH_NAMES.map((name, index) => (
            <Pressable
              key={name}
              style={[styles.monthCell, index === viewedMonth && styles.monthCellSelected]}
              onPress={() => {
                setViewedMonth(index);
                setMode('days');
              }}
            >
              <Text style={[styles.monthCellText, index === viewedMonth && styles.monthCellTextSelected]}>
                {name.slice(0, 3)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <>
          <View style={styles.weekDaysRow}>
            {WEEKDAY_LABELS.map((label, index) => (
              <Text key={index} style={styles.weekDayLabel}>{label}</Text>
            ))}
          </View>
          <View style={styles.dayGrid}>
            {gridDays.map((day) => {
              const inMonth = day.getMonth() === viewedMonth;
              const isToday = isSameDay(day, today);
              const isSelected = isSameDay(day, selectedDate);
              const dayOccurrences = occurrencesByDay.get(dateKey(day));
              const hasFuture = day >= today;
              return (
                <Pressable
                  key={dateKey(day)}
                  style={[styles.dayCell, isSelected && styles.dayCellSelected]}
                  onPress={() => setSelectedDate(day)}
                >
                  <View style={[styles.dayNumberWrap, isToday && styles.dayNumberWrapToday]}>
                    <Text
                      style={[
                        styles.dayNumberText,
                        !inMonth && styles.dayNumberTextOutside,
                        isToday && styles.dayNumberTextToday,
                      ]}
                    >
                      {day.getDate()}
                    </Text>
                  </View>
                  {dayOccurrences && dayOccurrences.length > 0 && (
                    <View style={[styles.dayDot, hasFuture ? styles.dayDotFuture : styles.dayDotPast]} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {mode === 'days' && (
        <View style={styles.selectedDayPanel}>
          <Text style={styles.selectedDayHeader}>
            {selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </Text>
          {selectedOccurrences.length === 0 ? (
            <Text style={styles.empty}>No reminders on this day.</Text>
          ) : (
            selectedOccurrences.map((occurrence, index) => (
              <View key={`${occurrence.reminder.id}-${index}`} style={styles.occurrenceRow}>
                <Text style={styles.occurrenceTitle}>{occurrence.reminder.title}</Text>
                <Text style={styles.occurrenceTime}>{formatTime(occurrence.date)}</Text>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

function ReminderRow({
  item,
  now,
  dragDisabled,
  onEdit,
  onDelete,
}: {
  item: Reminder;
  now: Date;
  dragDisabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const drag = useReorderableDrag();
  const isActive = useIsActive();
  const dueDate = getDueDate(item, now);
  return (
    <View style={[styles.row, isActive && styles.rowActive]}>
      <Pressable
        style={{ flex: 1 }}
        onLongPress={dragDisabled ? undefined : drag}
        delayLongPress={200}
      >
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowSubtitle}>
          {item.repeats
            ? `Every ${item.intervalValue} ${unitLabel(item.intervalUnit, item.intervalValue)} · next `
            : 'Once · '}
          {formatDateTime(dueDate)}
        </Text>
      </Pressable>
      <Pressable onPress={onEdit} hitSlop={12} style={styles.iconButton}>
        <Ionicons name="pencil-outline" size={20} color="#2f6fed" />
      </Pressable>
      <Pressable onPress={onDelete} hitSlop={12} style={styles.iconButton}>
        <Ionicons name="trash-outline" size={20} color="#d33" />
      </Pressable>
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ReminderApp />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ReminderApp() {
  const insets = useSafeAreaInsets();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState(false);
  const [startDate, setStartDate] = useState(startOfDay(new Date()));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [notificationTime, setNotificationTime] = useState(defaultNotificationTime());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [intervalValue, setIntervalValue] = useState('7');
  const [intervalValueError, setIntervalValueError] = useState(false);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>('day');
  const [repeats, setRepeats] = useState(true);

  const loadReminders = useCallback(async () => {
    setReminders(await getReminders());
  }, []);

  useEffect(() => {
    (async () => {
      await initDb();
      androidChannelSetup();
      await requestNotificationPermissions();
      await loadReminders();
      setReady(true);
    })();
  }, [loadReminders]);

  function resetForm() {
    setTitle('');
    setTitleError(false);
    setStartDate(startOfDay(new Date()));
    setNotificationTime(defaultNotificationTime());
    setIntervalValue('7');
    setIntervalValueError(false);
    setIntervalUnit('day');
    setRepeats(true);
  }

  function openAddModal() {
    resetForm();
    setEditingId(null);
    setModalVisible(true);
  }

  function openEditModal(reminder: Reminder) {
    const anchor = new Date(reminder.startDate);
    setTitle(reminder.title);
    setTitleError(false);
    setStartDate(startOfDay(anchor));
    setNotificationTime(anchor);
    setIntervalValue(String(reminder.intervalValue));
    setIntervalValueError(false);
    setIntervalUnit(reminder.intervalUnit);
    setRepeats(!!reminder.repeats);
    setEditingId(reminder.id);
    setModalVisible(true);
  }

  async function handleSubmit() {
    const parsedValue = parseInt(intervalValue, 10);
    const value = repeats ? parsedValue : Number.isFinite(parsedValue) && parsedValue >= 1 ? parsedValue : 1;

    const isTitleInvalid = !title.trim();
    const isIntervalValueInvalid = repeats && (!Number.isFinite(value) || value < 1);
    setTitleError(isTitleInvalid);
    setIntervalValueError(isIntervalValueInvalid);
    if (isTitleInvalid || isIntervalValueInvalid) return;

    const intervalDays = value * UNIT_TO_DAYS[intervalUnit];
    const anchor = combineDateAndTime(startDate, notificationTime);
    const now = new Date();
    const firstDueDate = repeats ? computeNextDueDate(anchor, intervalDays, now) : anchor;

    if (editingId !== null) {
      const existing = reminders.find((r) => r.id === editingId);
      if (existing) {
        await cancelNotification(existing.notificationId);
        await cancelNotification(existing.repeatingNotificationId);
      }
      const { notificationId, repeatingNotificationId } = await scheduleReminderNotifications(
        title.trim(),
        firstDueDate,
        intervalDays,
        repeats
      );
      await updateReminder(
        editingId,
        title.trim(),
        anchor.toISOString(),
        value,
        intervalUnit,
        intervalDays,
        repeats,
        notificationId,
        repeatingNotificationId
      );
    } else {
      const { notificationId, repeatingNotificationId } = await scheduleReminderNotifications(
        title.trim(),
        firstDueDate,
        intervalDays,
        repeats
      );
      await insertReminder(
        title.trim(),
        anchor.toISOString(),
        value,
        intervalUnit,
        intervalDays,
        repeats,
        notificationId,
        repeatingNotificationId
      );
    }

    resetForm();
    setEditingId(null);
    setModalVisible(false);
    await loadReminders();
  }

  function handleDelete(reminder: Reminder) {
    Alert.alert(
      'Are you sure to delete this reminder?',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await cancelNotification(reminder.notificationId);
            await cancelNotification(reminder.repeatingNotificationId);
            await deleteReminder(reminder.id);
            await loadReminders();
          },
        },
      ]
    );
  }

  if (!ready) {
    return (
      <View style={styles.container}>
        <StatusBar style="auto" />
      </View>
    );
  }

  const now = new Date();
  const query = searchQuery.trim().toLowerCase();
  const visibleReminders = query
    ? reminders.filter((r) => r.title.toLowerCase().includes(query))
    : reminders;

  async function handleReorder({ from, to }: ReorderableListReorderEvent) {
    if (query) return; // reordering is only meaningful against the full, unfiltered list
    const newOrder = reorderItems(visibleReminders, from, to);
    setReminders(newOrder);
    await updateReminderOrder(newOrder.map((r) => r.id));
  }

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <View style={styles.topRow}>
        <Text style={styles.header}>{view === 'list' ? 'Reminders' : 'Calendar'}</Text>
        <Pressable
          onPress={() => setView(view === 'list' ? 'calendar' : 'list')}
          hitSlop={12}
          style={styles.calendarToggle}
        >
          <Ionicons name={view === 'list' ? 'calendar-outline' : 'list-outline'} size={26} color="#2f6fed" />
        </Pressable>
      </View>

      {view === 'calendar' ? (
        <CalendarView reminders={reminders} now={now} />
      ) : (
        <>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search reminders"
              returnKeyType="search"
              onSubmitEditing={() => Keyboard.dismiss()}
            />
            <Pressable style={styles.searchButton} onPress={() => Keyboard.dismiss()}>
              <Text style={styles.searchButtonText}>Search</Text>
            </Pressable>
          </View>

          <ReorderableList
            style={styles.list}
            data={visibleReminders}
            keyExtractor={(item) => String(item.id)}
            onReorder={handleReorder}
            shouldUpdateActiveItem
            ListEmptyComponent={
              <Text style={styles.empty}>
                {query ? `No reminders match "${searchQuery.trim()}".` : 'No reminders yet. Tap + to add one.'}
              </Text>
            }
            renderItem={({ item }: ListRenderItemInfo<Reminder>) => (
              <ReminderRow
                item={item}
                now={now}
                dragDisabled={!!query}
                onEdit={() => openEditModal(item)}
                onDelete={() => handleDelete(item)}
              />
            )}
          />

          <Pressable style={styles.fab} onPress={openAddModal}>
            <Text style={styles.fabText}>+</Text>
          </Pressable>
        </>
      )}

      <Modal visible={modalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <ScrollView
            style={styles.modalCard}
            contentContainerStyle={[styles.modalCardContent, { paddingBottom: insets.bottom + 20 }]}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.modalHeader}>
              {editingId !== null ? 'Edit Reminder' : 'New Reminder'}
            </Text>

            <Text style={styles.label}>Title</Text>
            <TextInput
              style={[styles.input, titleError && styles.inputError]}
              value={title}
              onChangeText={(text) => {
                setTitle(text);
                if (text.trim()) setTitleError(false);
              }}
              placeholder="e.g. Linda's Birthday"
            />

            <Text style={styles.label}>Starting day</Text>
            <Pressable style={styles.input} onPress={() => setShowDatePicker(true)}>
              <Text>{startDate.toDateString()}</Text>
            </Pressable>
            {showDatePicker && (
              <DateTimePicker
                value={startDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onValueChange={(_event, selected) => {
                  setShowDatePicker(Platform.OS === 'ios');
                  setStartDate(startOfDay(selected));
                }}
                onDismiss={() => setShowDatePicker(false)}
              />
            )}

            <Text style={styles.label}>Notification time</Text>
            <Pressable style={styles.input} onPress={() => setShowTimePicker(true)}>
              <Text>{formatTime(notificationTime)}</Text>
            </Pressable>
            {showTimePicker && (
              <DateTimePicker
                value={notificationTime}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onValueChange={(_event, selected) => {
                  setShowTimePicker(Platform.OS === 'ios');
                  setNotificationTime(selected);
                }}
                onDismiss={() => setShowTimePicker(false)}
              />
            )}

            <View style={styles.repeatHeaderRow}>
              <Text style={styles.label}>Repeat every</Text>
              <View style={styles.happensOnceRow}>
                <Text style={styles.happensOnceLabel}>Happens once</Text>
                <Switch
                  value={!repeats}
                  onValueChange={(value) => {
                    setRepeats(!value);
                    if (value) setIntervalValueError(false);
                  }}
                />
              </View>
            </View>
            <View style={styles.intervalRow}>
              <TextInput
                style={[
                  styles.input,
                  styles.intervalValueInput,
                  !repeats && styles.inputDisabled,
                  intervalValueError && styles.inputError,
                ]}
                value={intervalValue}
                onChangeText={(text) => {
                  const digitsOnly = text.replace(/[^0-9]/g, '');
                  setIntervalValue(digitsOnly);
                  if (digitsOnly && parseInt(digitsOnly, 10) >= 1) setIntervalValueError(false);
                }}
                keyboardType="number-pad"
                editable={repeats}
              />
              <View style={[styles.unitPickerWrapper, !repeats && styles.inputDisabled]}>
                <Picker
                  selectedValue={intervalUnit}
                  onValueChange={(value) => setIntervalUnit(value)}
                  enabled={repeats}
                  mode="dropdown"
                  style={styles.unitPicker}
                >
                  {INTERVAL_UNITS.map((unit) => (
                    <Picker.Item
                      key={unit}
                      label={unitLabel(unit, intervalValue === '1' ? 1 : 2)}
                      value={unit}
                    />
                  ))}
                </Picker>
              </View>
            </View>

            <View style={styles.modalActions}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  resetForm();
                  setEditingId(null);
                  setModalVisible(false);
                }}
              >
                <Text>{editingId !== null ? 'Discard' : 'Cancel'}</Text>
              </Pressable>
              <Pressable style={styles.primaryButton} onPress={handleSubmit}>
                <Text style={styles.primaryButtonText}>
                  {editingId !== null ? 'Submit' : 'Save'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  header: {
    fontSize: 28,
    fontWeight: '700',
  },
  calendarToggle: {
    padding: 4,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchButton: {
    backgroundColor: '#2f6fed',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  searchButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  list: {
    flex: 1,
  },
  empty: {
    color: '#888',
    marginTop: 40,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    backgroundColor: '#fff',
  },
  rowActive: {
    backgroundColor: '#eef3ff',
    borderRadius: 10,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    transform: [{ scale: 1.03 }],
  },
  rowTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  rowSubtitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  iconButton: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 40,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#2f6fed',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  fabText: {
    color: '#fff',
    fontSize: 30,
    lineHeight: 32,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '92%',
  },
  modalCardContent: {
    padding: 20,
  },
  modalHeader: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    color: '#666',
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
    textAlignVertical: 'center',
  },
  inputDisabled: {
    opacity: 0.4,
  },
  inputError: {
    borderWidth: 1.5,
    borderColor: '#d32f2f',
  },
  repeatHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  happensOnceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  happensOnceLabel: {
    fontSize: 13,
    color: '#666',
  },
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  intervalValueInput: {
    width: 64,
  },
  unitPickerWrapper: {
    flex: 1,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
    borderRadius: 8,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  unitPicker: {
    color: '#333',
    height: 54,
    marginTop: -5,
    marginBottom: -5,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 24,
    gap: 12,
  },
  secondaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  primaryButton: {
    backgroundColor: '#2f6fed',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  calendarContainer: {
    flex: 1,
  },
  calendarHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    marginBottom: 12,
  },
  calendarNavButton: {
    padding: 6,
  },
  calendarHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    minWidth: 160,
    textAlign: 'center',
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  monthCell: {
    width: '33.33%',
    aspectRatio: 1.6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthCellSelected: {
    backgroundColor: '#eef3ff',
    borderRadius: 10,
  },
  monthCellText: {
    fontSize: 16,
    color: '#333',
  },
  monthCellTextSelected: {
    color: '#2f6fed',
    fontWeight: '700',
  },
  weekDaysRow: {
    flexDirection: 'row',
  },
  weekDayLabel: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  dayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellSelected: {
    backgroundColor: '#eef3ff',
    borderRadius: 10,
  },
  dayNumberWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumberWrapToday: {
    backgroundColor: '#2f6fed',
  },
  dayNumberText: {
    fontSize: 15,
    color: '#333',
  },
  dayNumberTextOutside: {
    color: '#ccc',
  },
  dayNumberTextToday: {
    color: '#fff',
    fontWeight: '700',
  },
  dayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 3,
  },
  dayDotFuture: {
    backgroundColor: '#2f6fed',
  },
  dayDotPast: {
    backgroundColor: '#bbb',
  },
  selectedDayPanel: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
  },
  selectedDayHeader: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  occurrenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  occurrenceTitle: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  occurrenceTime: {
    fontSize: 14,
    color: '#666',
  },
});
