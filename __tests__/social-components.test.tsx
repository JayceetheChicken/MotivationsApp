import { useState } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import {
  AccountRequiredCta,
  FriendPresenceRow,
  FriendSearch,
  ParticipantAvatarStack,
  PlannedSessionCard,
  SharedGoalCard,
  SharedGoalFormFields,
  SharedGoalSummaryCard,
  SocialPrivacyNote,
  StudyGroupCard,
  type PlannedSessionViewModel,
  type SharedGoalFormValue,
  type SharedGoalSummaryViewModel,
  type SocialUserSummary,
  type StudyGroupViewModel,
} from '@/components/social';
import { Avatar } from '@/components/ui/avatar';

function setWindowWidth(width: number) {
  const dimensions = { width, height: 900, scale: 1, fontScale: 1 };
  Dimensions.set({ window: dimensions, screen: dimensions });
}

function containsImageUri(node: unknown, uri: string | undefined): boolean {
  if (!uri || !node || typeof node !== 'object') return false;
  const candidate = node as {
    props?: { source?: { uri?: string } | readonly { uri?: string }[] };
    children?: readonly unknown[];
  };
  const source = candidate.props?.source;
  return (Array.isArray(source)
    ? source.some((entry) => entry.uri === uri)
    : (source as { uri?: string } | undefined)?.uri === uri) ||
    candidate.children?.some((child) => containsImageUri(child, uri)) === true;
}

const alice: SocialUserSummary = {
  id: 'alice-id',
  username: 'alice',
  displayName: 'Alice Beispiel',
  avatarUrl: 'https://cdn.example.com/avatars/alice/avatar.jpg?v=3',
};

const bob: SocialUserSummary = {
  id: 'bob-id',
  username: 'bob',
  displayName: 'Bob Beispiel',
};

const initialFormValue: SharedGoalFormValue = {
  title: '',
  description: '',
  mode: 'shared',
  targetType: 'duration',
  durationUnit: 'minutes',
  cadence: 'weekly',
  startsOn: '2026-07-20',
  endsOn: '2026-08-16',
  sourcePolicy: 'all',
  targetValue: '',
  minimumSessionMinutes: '10',
  participantIds: [],
};

describe('Social UI components', () => {
  it('falls back to initials when a remote avatar cannot be loaded', async () => {
    const rendered = await render(
      <Avatar name="Alice Beispiel" source={{ uri: 'https://invalid.test/avatar.jpg' }} />,
    );
    expect(rendered.queryByText('AB')).toBeNull();
    await fireEvent(rendered.getByTestId('avatar-image'), 'error', {
      nativeEvent: { error: 'network failure' },
    });
    expect(rendered.getByText('AB')).toBeTruthy();
    await rendered.unmount();
  });

  it('offers account actions without accessing auth or study stores', async () => {
    const onSignIn = jest.fn();
    const onRegister = jest.fn();
    const rendered = await render(
      <AccountRequiredCta onRegister={onRegister} onSignIn={onSignIn} />,
    );

    await fireEvent.press(rendered.getByRole('button', { name: 'Online-Konto anmelden' }));
    await fireEvent.press(rendered.getByRole('button', { name: 'Online-Konto erstellen' }));

    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onRegister).toHaveBeenCalledTimes(1);
    await rendered.unmount();
  });

  it('supports exact username search and a result action', async () => {
    const onQueryChange = jest.fn();
    const onSubmit = jest.fn();
    const onResultAction = jest.fn();
    const rendered = await render(
      <FriendSearch
        actionLabel="Hinzufügen"
        onQueryChange={onQueryChange}
        onResultAction={onResultAction}
        onSubmit={onSubmit}
        query="berta"
        result={{ user: bob, relationship: 'none' }}
        status="ready"
      />,
    );

    await fireEvent.changeText(
      rendered.getByLabelText('Eindeutigen Benutzernamen suchen'),
      'berta2',
    );
    await fireEvent.press(rendered.getByRole('button', { name: 'Suchen' }));
    await fireEvent.press(rendered.getByRole('button', { name: 'Hinzufügen' }));

    expect(onQueryChange).toHaveBeenCalledWith('berta2');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onResultAction).toHaveBeenCalledTimes(1);
    expect(rendered.getByText(/Noch nicht verbunden/)).toBeTruthy();

    const longestUsername = 'a'.repeat(30);
    await fireEvent.changeText(
      rendered.getByLabelText('Eindeutigen Benutzernamen suchen'),
      `@${longestUsername}`,
    );
    expect(onQueryChange).toHaveBeenLastCalledWith(longestUsername);
    await rendered.unmount();
  });

  it('shows presence and last activity without private friend statistics', async () => {
    const onRemove = jest.fn();
    const privateDetails = {
      subject: 'Private Analysis-Notizen',
      weeklyMinutes: 999,
      streak: 99,
    };
    const rendered = await render(
      <FriendPresenceRow
        now={new Date('2026-07-22T08:42:00.000Z')}
        onRemove={onRemove}
        overview={{
          friend: {
            id: alice.id,
            username: alice.username,
            displayName: alice.displayName,
            avatarUrl: alice.avatarUrl,
          },
          presenceStatus: 'online',
          lastActiveAt: '2026-07-22T08:40:00.000Z',
          presenceExpiresAt: '2026-07-22T08:45:00.000Z',
          onlineExpiresAt: '2026-07-22T08:45:00.000Z',
        }}
      />,
    );

    expect(rendered.getByText('Online')).toBeTruthy();
    expect(rendered.getByText(/Zuletzt aktiv vor 2 Min\./)).toBeTruthy();
    expect(rendered.queryByText(privateDetails.subject)).toBeNull();
    expect(rendered.queryByText(String(privateDetails.weeklyMinutes))).toBeNull();
    expect(rendered.queryByText(String(privateDetails.streak))).toBeNull();
    await fireEvent.press(rendered.getByRole('button', {
      name: 'Freundschaft mit Alice Beispiel entfernen',
    }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    await rendered.unmount();
  });

  it('downgrades expired learning and online presence without waiting for a refetch', async () => {
    const overview = {
      friend: alice,
      presenceStatus: 'learning' as const,
      lastActiveAt: '2026-07-22T08:40:00.000Z',
      presenceExpiresAt: '2026-07-22T08:41:00.000Z',
      onlineExpiresAt: '2026-07-22T08:45:00.000Z',
    };
    const rendered = await render(
      <FriendPresenceRow now={Date.parse('2026-07-22T08:42:00.000Z')} overview={overview} />,
    );
    expect(rendered.getByText('Online')).toBeTruthy();

    await rendered.rerender(
      <FriendPresenceRow now={Date.parse('2026-07-22T08:46:00.000Z')} overview={overview} />,
    );
    expect(rendered.getByText('Offline')).toBeTruthy();
    expect(rendered.queryByText('Lernt gerade')).toBeNull();
    await rendered.unmount();
  });

  it('shows individual contributions and one distinct shared team summary', async () => {
    const rendered = await render(
      <SharedGoalCard
        description="Zusammen für Analysis lernen"
        mode="shared"
        participants={[
          { user: alice, status: 'accepted', contribution: 160 },
          { user: bob, status: 'accepted', contribution: 90 },
        ]}
        periodLabel="Diese Woche"
        status="active"
        target={300}
        targetType="duration"
        teamProgress={{
          value: 250,
          target: 300,
          percent: 83.3,
          remaining: 50,
          reached: false,
          exceeded: 0,
        }}
        title="Analysis-Team"
      />,
    );

    expect(rendered.getAllByText('Gemeinsamer Teamfortschritt')).toHaveLength(1);
    expect(rendered.getByText('2 Std. 40 Min.')).toBeTruthy();
    expect(rendered.getByText('1 Std. 30 Min.')).toBeTruthy();
    expect(rendered.getByText('50 Min.')).toBeTruthy();
    expect(containsImageUri(
      rendered.getByLabelText('Profilbild von Alice Beispiel'),
      alice.avatarUrl,
    )).toBe(true);
    await rendered.unmount();
  });

  it('does not present missing server progress as a zero contribution', async () => {
    const rendered = await render(
      <SharedGoalCard
        mode="per_participant"
        participants={[{ user: alice, status: 'invited', contribution: null }]}
        periodLabel="Diese Woche"
        status="active"
        target={120}
        targetType="duration"
        title="Noch nicht angenommen"
      />,
    );

    expect(rendered.getByText('Noch nicht verfügbar')).toBeTruthy();
    expect(rendered.queryByText('0 Min.')).toBeNull();
    await rendered.unmount();
  });

  it.each([
    [390, undefined],
    [1024, 'row'],
  ])('uses a phone or tablet form layout at %ipx with cadence and date fields', async (width, flexDirection) => {
    setWindowWidth(width);

    function ControlledForm() {
      const [value, setValue] = useState(initialFormValue);
      return (
        <SharedGoalFormFields
          friends={[alice, bob]}
          onChange={setValue}
          value={value}
        />
      );
    }

    const rendered = await render(<ControlledForm />);
    const layoutStyle = StyleSheet.flatten(rendered.getByTestId('shared-goal-form-layout').props.style);

    expect(layoutStyle.flexDirection).toBe(flexDirection);
    expect(rendered.getByLabelText('Rhythmus des gemeinsamen Lernziels')).toBeTruthy();
    expect(rendered.getByLabelText('Startdatum des gemeinsamen Lernziels')).toBeTruthy();
    expect(rendered.getByLabelText('Enddatum des gemeinsamen Lernziels')).toBeTruthy();
    expect(rendered.getByText('Startdatum (optional)')).toBeTruthy();
    expect(rendered.getByText('Enddatum (optional)')).toBeTruthy();

    await fireEvent.changeText(
      rendered.getByLabelText('Titel des gemeinsamen Lernziels'),
      'Prüfungsteam',
    );
    await fireEvent.press(rendered.getByRole('checkbox', { name: 'Alice Beispiel einladen' }));

    expect(rendered.getByDisplayValue('Prüfungsteam')).toBeTruthy();
    expect(
      rendered.getByRole('checkbox', { name: 'Alice Beispiel einladen' }).props.accessibilityState,
    ).toMatchObject({ checked: true });
    expect(containsImageUri(
      rendered.getByRole('checkbox', { name: 'Alice Beispiel einladen' }),
      alice.avatarUrl,
    )).toBe(true);
    expect(rendered.getByText('BB')).toBeTruthy();
    await rendered.unmount();
  });

  it('renders compact shared content cards using only shared metadata', async () => {
    const goal: SharedGoalSummaryViewModel = {
      id: 'goal-summary',
      title: 'Prüfungsteam',
      description: 'Gemeinsam dranbleiben',
      status: 'active',
      targetType: 'duration',
      periodLabel: 'Diese Woche',
      remainingLabel: 'Noch 3 Tage',
      participants: [alice, bob],
      ownProgress: {
        value: 120,
        target: 240,
        percent: 50,
        remaining: 120,
        reached: false,
        exceeded: 0,
      },
      teamProgress: {
        value: 300,
        target: 400,
        percent: 75,
        remaining: 100,
        reached: false,
        exceeded: 0,
      },
    };
    const session = {
      id: 'session-summary',
      title: 'Gemeinsamer Fokus',
      startsAt: '2026-07-23T16:00:00.000Z',
      plannedDurationMinutes: 60,
      status: 'planned',
      participants: [alice, bob],
      privateSubject: 'Physik',
      privateTask: 'Kapitel 4',
    } satisfies PlannedSessionViewModel & {
      privateSubject: string;
      privateTask: string;
    };
    const group: StudyGroupViewModel = {
      id: 'group-summary',
      name: 'Lerngruppe Nord',
      icon: 'LN',
      memberCount: 5,
      activeGoalCount: 2,
      nextSessionAt: session.startsAt,
    };
    const onJoin = jest.fn();
    const rendered = await render(
      <>
        <SharedGoalSummaryCard goal={goal} />
        <PlannedSessionCard onJoin={onJoin} session={session} />
        <StudyGroupCard group={group} />
        <ParticipantAvatarStack maxVisible={1} participants={[alice, bob]} />
        <SocialPrivacyNote />
      </>,
    );

    expect(rendered.getByText('Dein Fortschritt')).toBeTruthy();
    expect(rendered.getByText('Gemeinsam')).toBeTruthy();
    expect(rendered.getByText('Gemeinsamer Fokus')).toBeTruthy();
    expect(rendered.getByText('Lerngruppe Nord')).toBeTruthy();
    expect(rendered.getByText('+1', { includeHiddenElements: true })).toBeTruthy();
    expect(rendered.getByText('Privat bleibt privat')).toBeTruthy();
    expect(rendered.queryByText(session.privateSubject)).toBeNull();
    expect(rendered.queryByText(session.privateTask)).toBeNull();

    await fireEvent.press(rendered.getByRole('button', { name: 'Beitreten' }));
    expect(onJoin).toHaveBeenCalledTimes(1);
    await rendered.unmount();
  });
});
