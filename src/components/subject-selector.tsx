import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { SubjectChip } from '@/components/subject-chip';
import {
  normalizeSubjectSearch,
  resolveCatalogSubjectName,
  searchSubjectCatalog,
} from '@/data/subject-catalog';
import { useAppTheme } from '@/theme';
import type { Subject } from '@/types/study';

interface SubjectSelectorProps {
  dark?: boolean;
  onCreateSubject: (name: string) => Subject;
  onSelectSubject: (subject: Subject) => void;
  selectedSubjectId?: string;
  subjects: readonly Subject[];
}

export function SubjectSelector({
  dark = false,
  onCreateSubject,
  onSelectSubject,
  selectedSubjectId,
  subjects,
}: SubjectSelectorProps) {
  const theme = useAppTheme();
  const [query, setQuery] = useState('');
  const normalizedQuery = normalizeSubjectSearch(query);
  const activeSubjects = useMemo(
    () => subjects.filter((subject) => !subject.archived),
    [subjects],
  );
  const visibleSubjects = useMemo(() => {
    if (!normalizedQuery) return activeSubjects;
    const terms = normalizedQuery.split(' ').filter(Boolean);
    return activeSubjects.filter((subject) => {
      const normalizedName = normalizeSubjectSearch(subject.name);
      return terms.every((term) => normalizedName.includes(term));
    });
  }, [activeSubjects, normalizedQuery]);
  const existingNames = useMemo(
    () => new Set(activeSubjects.map((subject) => normalizeSubjectSearch(subject.name))),
    [activeSubjects],
  );
  const catalogMatches = useMemo(
    () => searchSubjectCatalog(query, normalizedQuery ? 10 : 8)
      .filter((entry) => !existingNames.has(normalizeSubjectSearch(entry.name))),
    [existingNames, normalizedQuery, query],
  );
  const exactExisting = activeSubjects.find(
    (subject) => normalizeSubjectSearch(subject.name) === normalizedQuery,
  );
  const exactCatalogName = resolveCatalogSubjectName(query);
  const customName = query.trim().replace(/\s+/g, ' ');
  const canCreateCustom = Boolean(customName && !exactExisting && !exactCatalogName);
  const foreground = dark ? theme.colors.focusText : theme.colors.text;
  const foregroundMuted = dark ? theme.colors.focusTextMuted : theme.colors.textMuted;
  const surface = dark ? theme.colors.focusSurface : theme.colors.surfaceMuted;
  const border = dark ? theme.colors.focusBorderStrong : theme.colors.border;

  const chooseExisting = (subject: Subject) => {
    onSelectSubject(subject);
    setQuery('');
  };

  const createAndSelect = (name: string) => {
    const subject = onCreateSubject(name);
    onSelectSubject(subject);
    setQuery('');
  };

  const submitQuery = () => {
    if (exactExisting) {
      chooseExisting(exactExisting);
      return;
    }
    if (exactCatalogName) {
      createAndSelect(exactCatalogName);
      return;
    }
    if (customName) createAndSelect(customName);
  };

  return (
    <View style={styles.container}>
      <TextInput
        accessibilityLabel="Fach suchen oder eigenes Fach eingeben"
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={80}
        onChangeText={setQuery}
        onSubmitEditing={submitQuery}
        placeholder="Fach suchen, z. B. Biologie"
        placeholderTextColor={foregroundMuted}
        returnKeyType="done"
        style={[
          theme.typography.body,
          styles.searchInput,
          {
            backgroundColor: surface,
            borderColor: border,
            borderRadius: theme.radii.lg,
            color: foreground,
          },
        ]}
        value={query}
      />

      {visibleSubjects.length > 0 ? (
        <View style={styles.section}>
          <Text selectable style={[theme.typography.caption, { color: foregroundMuted }]}>Deine Fächer</Text>
          <View accessibilityRole="radiogroup" style={styles.chips}>
            {visibleSubjects.map((subject) => (
              <SubjectChip
                dark={dark}
                key={subject.id}
                onPress={() => chooseExisting(subject)}
                selected={subject.id === selectedSubjectId}
                subject={subject}
              />
            ))}
          </View>
        </View>
      ) : null}

      {catalogMatches.length > 0 || canCreateCustom ? (
        <View style={styles.section}>
          <Text selectable style={[theme.typography.caption, { color: foregroundMuted }]}>
            {normalizedQuery ? 'Passende Fächer' : 'Häufige Fächer'}
          </Text>
          <View style={styles.suggestions}>
            {catalogMatches.map((entry) => (
              <Pressable
                accessibilityLabel={`${entry.name} als Fach hinzufügen und auswählen`}
                accessibilityRole="button"
                key={entry.name}
                onPress={() => createAndSelect(entry.name)}
                style={({ pressed }) => [
                  styles.suggestion,
                  {
                    backgroundColor: surface,
                    borderColor: border,
                    borderRadius: theme.radii.lg,
                  },
                  pressed ? styles.pressed : undefined,
                ]}>
                <Text numberOfLines={1} style={[theme.typography.bodyMedium, styles.suggestionName, { color: foreground }]}>{entry.name}</Text>
                <Text style={[theme.typography.label, { color: dark ? theme.colors.primaryMuted : theme.colors.primaryText }]}>+</Text>
              </Pressable>
            ))}
            {canCreateCustom ? (
              <Pressable
                accessibilityLabel={`${customName} als eigenes Fach hinzufügen und auswählen`}
                accessibilityRole="button"
                onPress={() => createAndSelect(customName)}
                style={({ pressed }) => [
                  styles.customSuggestion,
                  {
                    backgroundColor: dark ? theme.colors.focusSurface : theme.colors.accentPeachMuted,
                    borderColor: dark ? theme.colors.focusBorderStrong : theme.colors.primary,
                    borderRadius: theme.radii.lg,
                  },
                  pressed ? styles.pressed : undefined,
                ]}>
                <Text style={[theme.typography.bodyMedium, styles.suggestionName, { color: foreground }]}>„{customName}“ hinzufügen</Text>
                <Text style={[theme.typography.label, { color: dark ? theme.colors.primaryMuted : theme.colors.primaryText }]}>+</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {normalizedQuery && visibleSubjects.length === 0 && catalogMatches.length === 0 && !canCreateCustom ? (
        <Text selectable style={[theme.typography.body, { color: foregroundMuted }]}>Kein passendes Fach gefunden.</Text>
      ) : null}
      <Text selectable style={[theme.typography.caption, { color: foregroundMuted }]}>Ist dein Fach nicht dabei, kannst du jeden eigenen Namen eingeben.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 14,
  },
  searchInput: {
    width: '100%',
    minHeight: 52,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  section: {
    gap: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  suggestions: {
    gap: 7,
  },
  suggestion: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  customSuggestion: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  suggestionName: {
    minWidth: 0,
    flex: 1,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
});
