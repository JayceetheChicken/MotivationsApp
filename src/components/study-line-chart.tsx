import { useCallback, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { useAppTheme } from '@/theme';

export type StudyLineChartProps = {
  dataPoints: readonly (number | null)[];
  labels: readonly string[];
  /** Optional full labels used for selection and screen readers while `labels` stay compact on the x-axis. */
  detailLabels?: readonly string[];
  selectedIndex?: number | null;
  onSelect?: (index: number) => void;
  height?: number;
  yAxisLabel?: string;
  formatValue?: (value: number) => string;
  showArea?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

type ChartPoint = Readonly<{
  index: number;
  value: number;
  x: number;
  y: number;
}>;

const DEFAULT_CHART_HEIGHT = 232;
const MIN_CHART_HEIGHT = 180;
const PLOT_TOP = 16;
const PLOT_RIGHT = 12;
const PLOT_BOTTOM = 32;
const PLOT_LEFT = 48;
const Y_TICK_COUNT = 4;

function formatMinutes(value: number): string {
  const roundedValue = Math.max(0, Math.round(value));
  const hours = Math.floor(roundedValue / 60);
  const minutes = roundedValue % 60;

  if (hours === 0) {
    return `${minutes} Min.`;
  }

  if (minutes === 0) {
    return `${hours} Std.`;
  }

  return `${hours} Std. ${minutes} Min.`;
}

function getNiceMaximum(maximum: number): number {
  if (maximum <= 0) {
    return 1;
  }

  const roughStep = maximum / (Y_TICK_COUNT - 1);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalizedStep = roughStep / magnitude;
  const niceNormalizedStep =
    normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10;
  const step = niceNormalizedStep * magnitude;

  return Math.max(step, Math.ceil(maximum / step) * step);
}

function getXAxisIndexes(length: number, availableWidth: number): number[] {
  if (length <= 0) {
    return [];
  }

  const maxLabelCount = Math.max(2, Math.floor(availableWidth / 52));

  if (length <= maxLabelCount) {
    return Array.from({ length }, (_, index) => index);
  }

  const lastIndex = length - 1;
  const step = Math.ceil(lastIndex / (maxLabelCount - 1));
  const indexes = [0];

  for (let index = step; index < lastIndex; index += step) {
    indexes.push(index);
  }

  indexes.push(lastIndex);
  return indexes;
}

function findNearestAvailableIndex(targetIndex: number, availableIndexes: readonly number[]): number {
  return availableIndexes.reduce((nearestIndex, index) =>
    Math.abs(index - targetIndex) < Math.abs(nearestIndex - targetIndex) ? index : nearestIndex,
  );
}

export function StudyLineChart({
  dataPoints,
  labels,
  detailLabels,
  selectedIndex,
  onSelect,
  height = DEFAULT_CHART_HEIGHT,
  yAxisLabel = 'Min.',
  formatValue = formatMinutes,
  showArea = true,
  emptyTitle = 'Noch keine Lernzeit',
  emptyMessage = 'Nach deiner ersten abgeschlossenen Session erscheint hier dein Lernverlauf.',
  accessibilityLabel,
  style,
}: StudyLineChartProps) {
  const theme = useAppTheme();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [internalSelectedIndex, setInternalSelectedIndex] = useState<number | null>(null);
  const chartHeight = Math.max(MIN_CHART_HEIGHT, height);

  const normalizedData = useMemo(
    () =>
      dataPoints.map((value) =>
        value === null || !Number.isFinite(value) ? null : Math.max(0, value),
      ),
    [dataPoints],
  );
  const availableIndexes = useMemo(
    () =>
      normalizedData.flatMap((value, index) => (value === null ? [] : [index])),
    [normalizedData],
  );
  const hasLearningTime = normalizedData.some((value) => value !== null && value > 0);
  const lastAvailableIndex = availableIndexes.at(-1) ?? null;
  const isAvailableIndex = (index: number | null): index is number =>
    index !== null && normalizedData[index] !== null && normalizedData[index] !== undefined;

  const resolvedSelectedIndex =
    selectedIndex === null
      ? null
      : selectedIndex !== undefined
        ? isAvailableIndex(selectedIndex)
          ? selectedIndex
          : null
        : isAvailableIndex(internalSelectedIndex)
          ? internalSelectedIndex
          : lastAvailableIndex;

  const selectedValue =
    resolvedSelectedIndex === null ? null : (normalizedData[resolvedSelectedIndex] ?? null);
  const selectedLabel =
    resolvedSelectedIndex === null
      ? null
      : (detailLabels?.[resolvedSelectedIndex]
        ?? labels[resolvedSelectedIndex]
        ?? String(resolvedSelectedIndex + 1));

  const total = normalizedData.reduce<number>(
    (sum, value) => sum + (value === null ? 0 : value),
    0,
  );
  const highestIndex = availableIndexes.reduce<number | null>((currentIndex, index) => {
    if (currentIndex === null) {
      return index;
    }

    return (normalizedData[index] ?? 0) > (normalizedData[currentIndex] ?? 0)
      ? index
      : currentIndex;
  }, null);
  const futurePointCount = normalizedData.filter((value) => value === null).length;
  const chartSummary =
    accessibilityLabel ??
    [
      `Lernzeitdiagramm mit ${availableIndexes.length} erfassten Zeitpunkten.`,
      `Insgesamt ${formatValue(total)}.`,
      highestIndex === null
        ? null
        : `Höchster Wert: ${detailLabels?.[highestIndex] ?? labels[highestIndex] ?? highestIndex + 1}, ${formatValue(normalizedData[highestIndex] ?? 0)}.`,
      futurePointCount > 0
        ? `${futurePointCount} zukünftige ${futurePointCount === 1 ? 'Zeitangabe ist' : 'Zeitangaben sind'} noch offen.`
        : null,
    ]
      .filter(Boolean)
      .join(' ');

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = Math.max(0, event.nativeEvent.layout.width);
    setMeasuredWidth((currentWidth) =>
      Math.abs(currentWidth - nextWidth) > 0.5 ? nextWidth : currentWidth,
    );
  }, []);

  const handleSelection = useCallback(
    (index: number) => {
      if (selectedIndex === undefined) {
        setInternalSelectedIndex(index);
      }
      onSelect?.(index);
    },
    [onSelect, selectedIndex],
  );

  const selectAdjacentPoint = useCallback(
    (direction: -1 | 1) => {
      if (availableIndexes.length === 0) {
        return;
      }

      const currentPosition =
        resolvedSelectedIndex === null
          ? direction > 0
            ? -1
            : availableIndexes.length
          : availableIndexes.indexOf(resolvedSelectedIndex);
      const nextPosition = Math.min(
        availableIndexes.length - 1,
        Math.max(0, currentPosition + direction),
      );
      handleSelection(availableIndexes[nextPosition]);
    },
    [availableIndexes, handleSelection, resolvedSelectedIndex],
  );

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'increment') {
        selectAdjacentPoint(1);
      } else if (event.nativeEvent.actionName === 'decrement') {
        selectAdjacentPoint(-1);
      }
    },
    [selectAdjacentPoint],
  );

  const plotWidth = Math.max(1, measuredWidth - PLOT_LEFT - PLOT_RIGHT);
  const plotHeight = Math.max(1, chartHeight - PLOT_TOP - PLOT_BOTTOM);
  const plotBottom = PLOT_TOP + plotHeight;
  const maximumValue = normalizedData.reduce<number>(
    (maximum, value) => (value === null ? maximum : Math.max(maximum, value)),
    0,
  );
  const yMaximum = getNiceMaximum(maximumValue);
  const getX = (index: number): number =>
    normalizedData.length <= 1
      ? PLOT_LEFT + plotWidth / 2
      : PLOT_LEFT + (index / (normalizedData.length - 1)) * plotWidth;
  const getY = (value: number): number =>
    PLOT_TOP + (1 - Math.min(value, yMaximum) / yMaximum) * plotHeight;

  const pointSegments = normalizedData.reduce<ChartPoint[][]>((segments, value, index) => {
    if (value === null) {
      return segments.length === 0 || segments.at(-1)?.length === 0
        ? segments
        : [...segments, []];
    }

    if (segments.length === 0) {
      segments.push([]);
    }

    segments.at(-1)?.push({ index, value, x: getX(index), y: getY(value) });
    return segments;
  }, []);
  const nonEmptySegments = pointSegments.filter((segment) => segment.length > 0);
  const points = nonEmptySegments.flat();
  const xAxisIndexes = getXAxisIndexes(normalizedData.length, plotWidth);
  const yTicks = Array.from({ length: Y_TICK_COUNT }, (_, index) =>
    (yMaximum * index) / (Y_TICK_COUNT - 1),
  );

  const handleChartPress = useCallback(
    (event: GestureResponderEvent) => {
      if (availableIndexes.length === 0 || normalizedData.length === 0) {
        return;
      }

      const relativeX = Math.min(plotWidth, Math.max(0, event.nativeEvent.locationX - PLOT_LEFT));
      const approximateIndex =
        normalizedData.length === 1
          ? 0
          : Math.round((relativeX / plotWidth) * (normalizedData.length - 1));
      handleSelection(findNearestAvailableIndex(approximateIndex, availableIndexes));
    },
    [availableIndexes, handleSelection, normalizedData.length, plotWidth],
  );

  if (!hasLearningTime) {
    return (
      <View
        accessible
        accessibilityLabel={`${emptyTitle}. ${emptyMessage}`}
        onLayout={handleLayout}
        style={[
          styles.emptyState,
          {
            minHeight: chartHeight,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surfaceMuted,
            borderRadius: theme.radii.lg,
          },
          style,
        ]}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.emptyMark,
            {
              backgroundColor: theme.colors.primaryMuted,
              borderRadius: theme.radii.pill,
            },
          ]}>
          <View style={[styles.emptyMarkLine, { backgroundColor: theme.colors.primary }]} />
          <View
            style={[
              styles.emptyMarkDot,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.primary,
              },
            ]}
          />
        </View>
        <View style={styles.emptyCopy}>
          <Text selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
            {emptyTitle}
          </Text>
          <Text
            selectable
            style={[theme.typography.body, styles.emptyMessage, { color: theme.colors.textMuted }]}>
            {emptyMessage}
          </Text>
        </View>
      </View>
    );
  }

  const selectedSummary =
    selectedValue === null || selectedLabel === null
      ? 'Kein Zeitpunkt ausgewählt'
      : `${selectedLabel}: ${formatValue(selectedValue)}`;

  return (
    <View onLayout={handleLayout} style={[styles.container, style]}>
      <View style={[styles.selection, { borderBottomColor: theme.colors.divider }]}>
        <Text selectable style={[theme.typography.label, { color: theme.colors.textMuted }]}>
          {selectedLabel ?? 'Lernverlauf'}
        </Text>
        <Text
          selectable
          style={[theme.typography.bodyMedium, styles.selectedValue, { color: theme.colors.text }]}>
          {selectedValue === null ? formatValue(total) : formatValue(selectedValue)}
        </Text>
      </View>

      <View
        accessible
        accessibilityActions={[
          { name: 'decrement', label: 'Vorheriger Zeitpunkt' },
          { name: 'increment', label: 'Nächster Zeitpunkt' },
        ]}
        accessibilityHint="Tippe auf das Diagramm oder wische nach oben und unten, um einen Zeitpunkt auszuwählen."
        accessibilityLabel={chartSummary}
        accessibilityRole="adjustable"
        accessibilityValue={{ text: selectedSummary }}
        onAccessibilityAction={handleAccessibilityAction}
        onResponderRelease={handleChartPress}
        onStartShouldSetResponder={() => true}
        style={{ height: chartHeight }}>
        {measuredWidth > 0 ? (
          <Svg accessible={false} height={chartHeight} width={measuredWidth}>
            <SvgText
              fill={theme.colors.textSubtle}
              fontSize={11}
              fontWeight="600"
              textAnchor="start"
              x={PLOT_LEFT}
              y={10}>
              {yAxisLabel}
            </SvgText>

            {yTicks.map((tickValue) => {
              const y = getY(tickValue);

              return (
                <Line
                  key={`grid-${tickValue}`}
                  stroke={theme.colors.divider}
                  strokeWidth={1}
                  x1={PLOT_LEFT}
                  x2={measuredWidth - PLOT_RIGHT}
                  y1={y}
                  y2={y}
                />
              );
            })}

            {yTicks.map((tickValue) => {
              const y = getY(tickValue);
              const axisLabel =
                yMaximum >= 120
                  ? `${Number((tickValue / 60).toFixed(1))} h`
                  : `${Math.round(tickValue)}`;

              return (
                <SvgText
                  key={`y-label-${tickValue}`}
                  fill={theme.colors.textSubtle}
                  fontSize={11}
                  textAnchor="end"
                  x={PLOT_LEFT - 8}
                  y={y + 4}>
                  {axisLabel}
                </SvgText>
              );
            })}

            {showArea
              ? nonEmptySegments.map((segment) => {
                  if (segment.length < 2) {
                    return null;
                  }

                  const firstPoint = segment[0];
                  const lastPoint = segment.at(-1) ?? firstPoint;
                  const areaPath = [
                    `M ${firstPoint.x} ${plotBottom}`,
                    ...segment.map((point) => `L ${point.x} ${point.y}`),
                    `L ${lastPoint.x} ${plotBottom}`,
                    'Z',
                  ].join(' ');

                  return (
                    <Path
                      d={areaPath}
                      fill={theme.colors.primary}
                      fillOpacity={theme.isDark ? 0.12 : 0.08}
                      key={`area-${firstPoint.index}`}
                    />
                  );
                })
              : null}

            {resolvedSelectedIndex !== null ? (
              <Line
                stroke={theme.colors.borderStrong}
                strokeDasharray="3 5"
                strokeWidth={1}
                x1={getX(resolvedSelectedIndex)}
                x2={getX(resolvedSelectedIndex)}
                y1={PLOT_TOP}
                y2={plotBottom}
              />
            ) : null}

            {nonEmptySegments.map((segment) => {
              const linePath = segment
                .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
                .join(' ');

              return (
                <Path
                  d={linePath}
                  fill="none"
                  key={`line-${segment[0]?.index ?? 0}`}
                  stroke={theme.colors.primary}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                />
              );
            })}

            {points.map((point) => {
              const isSelected = point.index === resolvedSelectedIndex;

              return (
                <Circle
                  cx={point.x}
                  cy={point.y}
                  fill={isSelected ? theme.colors.primary : theme.colors.surface}
                  key={`point-${point.index}`}
                  r={isSelected ? 5 : 3.5}
                  stroke={isSelected ? theme.colors.surface : theme.colors.primary}
                  strokeWidth={isSelected ? 2.5 : 2}
                />
              );
            })}

            {xAxisIndexes.map((index) => {
              const textAnchor =
                index === 0 ? 'start' : index === normalizedData.length - 1 ? 'end' : 'middle';

              return (
                <SvgText
                  fill={
                    normalizedData[index] === null
                      ? theme.colors.textSubtle
                      : theme.colors.textMuted
                  }
                  fontSize={11}
                  key={`x-label-${index}`}
                  textAnchor={textAnchor}
                  x={getX(index)}
                  y={chartHeight - 7}>
                  {labels[index] ?? String(index + 1)}
                </SvgText>
              );
            })}
          </Svg>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  selection: {
    minHeight: 44,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  selectedValue: {
    fontVariant: ['tabular-nums'],
  },
  emptyState: {
    width: '100%',
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    borderWidth: 1,
    borderCurve: 'continuous',
  },
  emptyMark: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyMarkLine: {
    position: 'absolute',
    width: 26,
    height: 2,
    transform: [{ rotate: '-18deg' }],
  },
  emptyMarkDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  emptyCopy: {
    maxWidth: 420,
    alignItems: 'center',
    gap: 4,
  },
  emptyMessage: {
    textAlign: 'center',
  },
});
