import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  ACTIVITY_LEVEL_THRESHOLDS,
  buildActivityHeatmap,
  findActivityDay,
  toLocalDateKey,
  type ActivityDayDetail,
  type ActivityGoalInput,
  type ActivityHeatmapDay,
  type ActivityLevelThresholds,
  type ActivitySessionInput,
  type ActivitySubjectInput,
} from '@/lib/activity';
import { useAppTheme, type AppTheme } from '@/theme';

export interface ActivityHeatmapProps {
  readonly sessions: readonly ActivitySessionInput[];
  readonly userId: string;
  readonly subjects?: readonly ActivitySubjectInput[];
  readonly goals?: readonly ActivityGoalInput[];
  readonly referenceDate?: Date;
  readonly thresholds?: ActivityLevelThresholds;
  readonly locale?: string;
  readonly selectedDateKey?: string | null;
  readonly defaultSelectedDateKey?: string;
  readonly onSelectDay?: (day: ActivityDayDetail) => void;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

const CELL_SIZE = 12;
const MIN_FITTED_CELL_SIZE = 9;
const CELL_GAP = 3;
const DAY_LABEL_WIDTH = 28;
const MONTH_LABEL_HEIGHT = 22;
const TABLET_FIT_WIDTH = 600;
const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

function formatMinutes(minutes: number): string {
  const roundedMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;

  if (hours === 0) return `${remainingMinutes} Min.`;
  if (remainingMinutes === 0) return `${hours} Std.`;
  return `${hours} Std. ${remainingMinutes} Min.`;
}

function getHeatmapPalette(theme: AppTheme): readonly [string, string, string, string, string, string] {
  return [
    theme.colors.surfaceMuted,
    theme.colors.accentPeachMuted,
    theme.colors.accentPeach,
    theme.colors.focus,
    theme.colors.primary,
    theme.colors.primaryText,
  ];
}

function ActivityDetail({ day, locale }: { day: ActivityHeatmapDay; locale: string }) {
  const theme = useAppTheme();
  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(day.date),
    [day.date, locale],
  );

  return (
    <View
      accessible
      accessibilityLabel={`${dateLabel}. Gesamt ${formatMinutes(day.totalMinutes)}. ${day.sessionCount} ${day.sessionCount === 1 ? 'Session' : 'Sessions'}.`}
      style={[
        styles.detail,
        {
          backgroundColor: theme.colors.surfaceMuted,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.md,
        },
      ]}>
      <View style={styles.detailHeader}>
        <View style={styles.detailDateBlock}>
          <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>
            {dateLabel}
          </Text>
          <Text selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
            {day.sessionCount} {day.sessionCount === 1 ? 'Session' : 'Sessions'}
          </Text>
        </View>
        <Text
          selectable
          style={[
            theme.typography.bodyMedium,
            styles.detailTotal,
            { color: theme.colors.primaryText },
          ]}>
          {formatMinutes(day.totalMinutes)}
        </Text>
      </View>

      {day.totalMinutes <= 0 ? (
        <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
          An diesem Tag wurde noch keine Lernzeit erfasst.
        </Text>
      ) : (
        <View style={styles.breakdowns}>
          {day.goals.length > 0 ? (
            <View style={styles.breakdownGroup}>
              <Text
                selectable
                style={[theme.typography.caption, { color: theme.colors.textSubtle }]}>
                Lernziele
              </Text>
              {day.goals.map((item) => (
                <View key={`goal-${item.id ?? 'free'}`} style={styles.breakdownRow}>
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.label,
                      styles.breakdownLabel,
                      { color: theme.colors.text },
                    ]}>
                    {item.label}
                  </Text>
                  <Text
                    selectable
                    style={[theme.typography.label, { color: theme.colors.textMuted }]}>
                    {formatMinutes(item.minutes)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {day.subjects.length > 0 ? (
            <View style={styles.breakdownGroup}>
              <Text
                selectable
                style={[theme.typography.caption, { color: theme.colors.textSubtle }]}>
                Fächer
              </Text>
              {day.subjects.map((item) => (
                <View key={`subject-${item.id ?? 'unknown'}`} style={styles.breakdownRow}>
                  <Text
                    numberOfLines={1}
                    style={[
                      theme.typography.label,
                      styles.breakdownLabel,
                      { color: theme.colors.text },
                    ]}>
                    {item.label}
                  </Text>
                  <Text
                    selectable
                    style={[theme.typography.label, { color: theme.colors.textMuted }]}>
                    {formatMinutes(item.minutes)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

export function ActivityHeatmap({
  sessions,
  userId,
  subjects,
  goals,
  referenceDate,
  thresholds = ACTIVITY_LEVEL_THRESHOLDS,
  locale = 'de-DE',
  selectedDateKey,
  defaultSelectedDateKey,
  onSelectDay,
  style,
  testID,
}: ActivityHeatmapProps) {
  const theme = useAppTheme();
  const scrollViewRef = useRef<ScrollView>(null);
  const hasAutoScrolled = useRef(false);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [initialReferenceDate] = useState(() => new Date());
  const [internalSelectedDateKey, setInternalSelectedDateKey] = useState<string | null>(
    defaultSelectedDateKey ?? null,
  );
  const effectiveReferenceDate = referenceDate ?? initialReferenceDate;
  const heatmap = useMemo(
    () =>
      buildActivityHeatmap(sessions, {
        userId,
        subjects,
        goals,
        referenceDate: effectiveReferenceDate,
        thresholds,
        locale,
      }),
    [effectiveReferenceDate, goals, locale, sessions, subjects, thresholds, userId],
  );
  const todayDateKey = toLocalDateKey(effectiveReferenceDate);
  const requestedDateKey =
    selectedDateKey !== undefined ? selectedDateKey : internalSelectedDateKey;
  const selectedDay =
    (requestedDateKey ? findActivityDay(heatmap, requestedDateKey) : null) ??
    findActivityDay(heatmap, todayDateKey) ??
    heatmap.weeks.at(-1)?.days.find((day) => day.isInRange) ??
    null;
  const palette = getHeatmapPalette(theme);
  const weekCount = heatmap.weeks.length;
  const fittedCellSize = Math.floor(
    (availableWidth - DAY_LABEL_WIDTH - Math.max(0, weekCount - 1) * CELL_GAP) /
      Math.max(1, weekCount),
  );
  const cellSize =
    availableWidth >= TABLET_FIT_WIDTH && fittedCellSize >= MIN_FITTED_CELL_SIZE
      ? Math.min(CELL_SIZE, fittedCellSize)
      : CELL_SIZE;
  const gridWidth =
    DAY_LABEL_WIDTH + weekCount * cellSize + Math.max(0, weekCount - 1) * CELL_GAP;

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.max(0, event.nativeEvent.layout.width);
    setAvailableWidth((currentWidth) =>
      Math.abs(currentWidth - width) > 0.5 ? width : currentWidth,
    );
  }, []);

  const handleContentSizeChange = useCallback(
    (contentWidth: number) => {
      if (!hasAutoScrolled.current && availableWidth > 0 && contentWidth > availableWidth) {
        hasAutoScrolled.current = true;
        scrollViewRef.current?.scrollToEnd({ animated: false });
      }
    },
    [availableWidth],
  );

  const handleSelectDay = useCallback(
    (day: ActivityHeatmapDay) => {
      if (selectedDateKey === undefined) setInternalSelectedDateKey(day.dateKey);
      onSelectDay?.(day);
    },
    [onSelectDay, selectedDateKey],
  );

  const fullDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [locale],
  );

  return (
    <View onLayout={handleLayout} style={[styles.container, style]} testID={testID}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        horizontal
        onContentSizeChange={handleContentSizeChange}
        ref={scrollViewRef}
        showsHorizontalScrollIndicator={availableWidth > 0 && gridWidth > availableWidth}>
        <View style={{ width: gridWidth }}>
          <View
            style={[
              styles.monthLabels,
              { height: MONTH_LABEL_HEIGHT, marginLeft: DAY_LABEL_WIDTH },
            ]}>
            {heatmap.monthLabels.map((month) => (
              <Text
                key={month.key}
                numberOfLines={1}
                style={[
                  theme.typography.caption,
                  styles.monthLabel,
                  {
                    color: theme.colors.textSubtle,
                    left: month.weekIndex * (cellSize + CELL_GAP),
                  },
                ]}>
                {month.label}
              </Text>
            ))}
          </View>

          <View style={styles.gridRow}>
            <View style={[styles.weekdayLabels, { width: DAY_LABEL_WIDTH, gap: CELL_GAP }]}>
              {WEEKDAY_LABELS.map((label) => (
                <Text
                  key={label}
                  style={[
                    theme.typography.caption,
                    styles.weekdayLabel,
                    { color: theme.colors.textSubtle, height: cellSize, lineHeight: cellSize },
                  ]}>
                  {label}
                </Text>
              ))}
            </View>

            <View style={[styles.weeks, { gap: CELL_GAP }]}>
              {heatmap.weeks.map((week) => (
                <View key={week.key} style={{ gap: CELL_GAP }}>
                  {week.days.map((day) => {
                    if (!day.isInRange) {
                      return <View key={day.dateKey} style={{ height: cellSize, width: cellSize }} />;
                    }

                    const isSelected = selectedDay?.dateKey === day.dateKey;
                    const dateLabel = fullDateFormatter.format(day.date);
                    return (
                      <Pressable
                        accessibilityLabel={`${dateLabel}, ${formatMinutes(day.totalMinutes)}, Aktivitätsstufe ${day.level} von 5`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        hitSlop={3}
                        key={day.dateKey}
                        onPress={() => handleSelectDay(day)}
                        style={({ pressed }) => [
                          styles.day,
                          {
                            width: cellSize,
                            height: cellSize,
                            borderRadius: Math.max(2, Math.round(cellSize / 4)),
                            backgroundColor: palette[day.level],
                            borderColor: isSelected
                              ? theme.colors.text
                              : day.level === 0
                                ? theme.colors.border
                                : 'transparent',
                          },
                          isSelected ? styles.selectedDay : undefined,
                          pressed ? styles.pressedDay : undefined,
                        ]}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={styles.legend}>
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Weniger</Text>
        <View style={styles.legendScale}>
          {palette.map((color, index) => (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              key={`${color}-${index}`}
              style={[
                styles.legendCell,
                {
                  backgroundColor: color,
                  borderColor: index === 0 ? theme.colors.border : 'transparent',
                },
              ]}
            />
          ))}
        </View>
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Mehr</Text>
      </View>

      {selectedDay ? <ActivityDetail day={selectedDay} locale={locale} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 14,
  },
  scrollContent: {
    minWidth: '100%',
  },
  monthLabels: {
    position: 'relative',
  },
  monthLabel: {
    position: 'absolute',
    top: 0,
    width: 34,
  },
  gridRow: {
    flexDirection: 'row',
  },
  weekdayLabels: {
    justifyContent: 'flex-start',
  },
  weekdayLabel: {
    fontSize: 9,
    fontWeight: '600',
  },
  weeks: {
    flexDirection: 'row',
  },
  day: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  selectedDay: {
    borderWidth: 2,
    transform: [{ scale: 1.12 }],
  },
  pressedDay: {
    opacity: 0.72,
  },
  legend: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 7,
  },
  legendScale: {
    flexDirection: 'row',
    gap: 3,
  },
  legendCell: {
    width: 12,
    height: 12,
    borderRadius: 3,
    borderWidth: StyleSheet.hairlineWidth,
  },
  detail: {
    gap: 12,
    borderWidth: 1,
    padding: 14,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailDateBlock: {
    flex: 1,
    gap: 2,
  },
  detailTotal: {
    flexShrink: 0,
    fontVariant: ['tabular-nums'],
  },
  breakdowns: {
    gap: 12,
  },
  breakdownGroup: {
    gap: 5,
  },
  breakdownRow: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  breakdownLabel: {
    flex: 1,
  },
});
