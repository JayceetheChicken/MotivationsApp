import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AccountRequiredCta } from '@/components/social';
import { AppButton } from '@/components/ui/app-button';
import { AppCard } from '@/components/ui/app-card';
import { Avatar } from '@/components/ui/avatar';
import { Screen } from '@/components/ui/screen';
import { SectionHeader } from '@/components/ui/section-header';
import type { CreateStudyGroupInput } from '@/data/repositories/study-repository';
import { useAuthStore } from '@/state/auth-store';
import { useStudyStore } from '@/state/study-store';
import { useAppTheme } from '@/theme';

const GROUP_ICONS = ['📚', '🧠', '🎓', '✍️', '📐', '🧪'] as const;

export default function CreateStudyGroupScreen() {
  const theme = useAppTheme();
  const auth = useAuthStore();
  const { friendConnections, createStudyGroup, socialError } = useStudyStore();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<(typeof GROUP_ICONS)[number]>('📚');
  const [memberIds, setMemberIds] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const friends = useMemo(
    () => friendConnections
      .filter((connection) => connection.status === 'accepted')
      .map((connection) => connection.otherUser),
    [friendConnections],
  );

  const toggleMember = (userId: string) => {
    setMemberIds((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
    setError(null);
  };

  const submit = async () => {
    const cleanName = name.trim();
    if (cleanName.length < 3) {
      setError('Gib einen Gruppennamen mit mindestens drei Zeichen ein.');
      return;
    }
    if (memberIds.length === 0) {
      setError('Wähle mindestens einen bestätigten Freund aus.');
      return;
    }
    const input: CreateStudyGroupInput = {
      operationId: randomUUID(),
      memberIds,
      group: {
        id: randomUUID(),
        name: cleanName,
        icon,
        imageUrl: null,
      },
    };

    setSubmitting(true);
    setError(null);
    try {
      const group = await createStudyGroup(input);
      if (!group) throw new Error('Die Gruppe wurde nicht zurückgegeben.');
      router.replace({
        pathname: '/(tabs)/(friends)/group/[group-id]',
        params: { 'group-id': group.id },
      });
    } catch (submitError) {
      setError(submitError instanceof Error
        ? submitError.message
        : 'Die Lerngruppe konnte nicht erstellt werden.');
    } finally {
      setSubmitting(false);
    }
  };

  if (auth.activeMode !== 'supabase') {
    return (
      <Screen>
        <SectionHeader
          description="Lerngruppen stehen nur mit einem verbundenen Konto zur Verfügung."
          title="Lerngruppe erstellen"
        />
        <AccountRequiredCta
          loading={auth.loading}
          onRegister={() => router.push('/register')}
          onSignIn={() => router.push('/login')}
        />
      </Screen>
    );
  }

  return (
    <Screen maxWidth={820} keyboardShouldPersistTaps="handled">
      <SectionHeader
        description="Nur ausdrücklich gemeinsame Ziele und Sessions erscheinen in der Gruppe. Persönliche Aktivitäten bleiben privat."
        eyebrow="Gemeinsam dranbleiben"
        title="Neue Lerngruppe"
      />

      {(error || socialError) ? (
        <AppCard padding="sm" variant="outlined">
          <Text accessibilityRole="alert" selectable style={[theme.typography.bodyMedium, { color: theme.colors.danger }]}>
            {error ?? socialError}
          </Text>
        </AppCard>
      ) : null}

      <AppCard padding="lg" style={styles.formCard}>
        <View style={styles.field}>
          <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>Gruppenname</Text>
          <TextInput
            accessibilityLabel="Name der Lerngruppe"
            autoCapitalize="sentences"
            maxLength={60}
            onChangeText={(value) => { setName(value); setError(null); }}
            placeholder="z. B. Abi-Lerngruppe"
            placeholderTextColor={theme.colors.textSubtle}
            style={[
              styles.input,
              theme.typography.body,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.borderStrong,
                borderRadius: theme.radii.md,
                color: theme.colors.text,
              },
            ]}
            value={name}
          />
        </View>

        <View style={styles.field}>
          <Text selectable style={[theme.typography.label, { color: theme.colors.text }]}>Gruppen-Icon</Text>
          <View accessibilityLabel="Gruppen-Icon auswählen" accessibilityRole="radiogroup" style={styles.iconChoices}>
            {GROUP_ICONS.map((candidate) => {
              const selected = candidate === icon;
              return (
                <Pressable
                  accessibilityLabel={`Gruppen-Icon ${candidate}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  key={candidate}
                  onPress={() => setIcon(candidate)}
                  style={({ pressed }) => [
                    styles.iconChoice,
                    {
                      backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                      borderRadius: theme.radii.md,
                    },
                    pressed ? styles.pressed : undefined,
                  ]}>
                  <Text style={styles.iconText}>{candidate}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

      </AppCard>

      <View style={styles.section}>
        <SectionHeader
          description="Ausgewählte Freunde erhalten eine private Einladung."
          title="Mitglieder einladen"
        />
        {friends.length === 0 ? (
          <AppCard variant="subtle">
            <Text selectable style={[theme.typography.body, { color: theme.colors.textMuted }]}>
              Füge zuerst mindestens einen Freund hinzu, um eine Gruppe zu erstellen.
            </Text>
          </AppCard>
        ) : (
          <AppCard padding="none" style={styles.friendList}>
            {friends.map((friend) => {
              const selected = memberIds.includes(friend.id);
              return (
                <Pressable
                  accessibilityLabel={`${friend.displayName} in die Gruppe einladen`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  key={friend.id}
                  onPress={() => toggleMember(friend.id)}
                  style={({ pressed }) => [
                    styles.friendRow,
                    { borderBottomColor: theme.colors.divider },
                    pressed ? styles.pressed : undefined,
                  ]}>
                  <Avatar
                    name={friend.displayName}
                    size="sm"
                    source={friend.avatarUrl ? { uri: friend.avatarUrl } : undefined}
                  />
                  <View style={styles.friendCopy}>
                    <Text numberOfLines={1} selectable style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
                      {friend.displayName}
                    </Text>
                    <Text numberOfLines={1} selectable style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                      @{friend.username}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.checkbox,
                      {
                        backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
                        borderColor: selected ? theme.colors.primary : theme.colors.borderStrong,
                        borderRadius: theme.radii.sm,
                      },
                    ]}>
                    <Text style={[theme.typography.label, { color: selected ? theme.colors.onPrimary : 'transparent' }]}>✓</Text>
                  </View>
                </Pressable>
              );
            })}
          </AppCard>
        )}
      </View>

      <AppButton
        disabled={friends.length === 0}
        fullWidth
        label="Gruppe erstellen und einladen"
        loading={submitting}
        onPress={() => void submit()}
        size="large"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  formCard: { width: '100%', gap: 20 },
  field: { width: '100%', gap: 8 },
  input: { width: '100%', minHeight: 52, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1 },
  iconChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  iconChoice: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  iconText: { fontSize: 24, lineHeight: 30 },
  section: { width: '100%', gap: 14 },
  friendList: { width: '100%', overflow: 'hidden' },
  friendRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  friendCopy: { minWidth: 0, flex: 1, gap: 1 },
  checkbox: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  pressed: { opacity: 0.74 },
});
