import { useState } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import {
  AccountRequiredCta,
  ActiveFriendsList,
  FriendStatusCard,
  FriendStatsGrid,
  LearningStatusBadge,
  ParticipantAvatarStack,
  PlannedSessionCard,
  PrivacySourceToggles,
  SharedGoalCard,
  SharedGoalFormFields,
  SharedGoalSummaryCard,
  SocialConnectionsList,
  SocialPrivacyNote,
  SocialQuickActions,
  StudyGroupCard,
  UsernameSearch,
  type FriendStatusViewModel,
  type FriendStatsPeriod,
  type PlannedSessionViewModel,
  type PrivacySourceKey,
  type PrivacySourceValues,
  type SharedGoalFormValue,
  type SharedGoalSummaryViewModel,
  type SocialUserSummary,
  type StudyGroupViewModel,
} from '@/components/social';

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

const friendPeriods: readonly FriendStatsPeriod[] = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
].map((key, index) => ({
  key: key as FriendStatsPeriod['key'],
  timer: { minutes: 30 + index, sessionCount: 1 },
  manual: index === 0 ? null : { minutes: 15, sessionCount: 1 },
  total: index === 0 ? null : { minutes: 45 + index, sessionCount: 2 },
}));

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

  it('submits an exact username and exposes result actions', async () => {
    const onSubmit = jest.fn();
    const onResultAction = jest.fn();
    const rendered = await render(
      <UsernameSearch
        actionLabel="Anfrage senden"
        onQueryChange={jest.fn()}
        onResultAction={onResultAction}
        onSubmit={onSubmit}
        query="alice"
        result={{ user: alice, relationship: 'none' }}
        status="ready"
      />,
    );

    await fireEvent.press(rendered.getByRole('button', { name: 'Suchen' }));
    await fireEvent.press(rendered.getByRole('button', { name: 'Anfrage senden' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onResultAction).toHaveBeenCalledTimes(1);
    expect(rendered.getByText('@alice · Noch nicht verbunden')).toBeTruthy();
    expect(containsImageUri(
      rendered.getByLabelText('Profilbild von Alice Beispiel'),
      alice.avatarUrl,
    )).toBe(true);
    expect(rendered.queryByText('AB')).toBeNull();
    await rendered.unmount();
  });

  it('renders incoming requests and accepted friends with their permitted actions', async () => {
    const onAccept = jest.fn();
    const onDecline = jest.fn();
    const onRemove = jest.fn();
    const incoming = { id: 'request-1', user: alice, status: 'pending_received' as const };
    const accepted = { id: 'friend-1', user: bob, status: 'accepted' as const };
    const rendered = await render(
      <SocialConnectionsList
        connections={[incoming, accepted]}
        onAccept={onAccept}
        onDecline={onDecline}
        onRemove={onRemove}
      />,
    );

    await fireEvent.press(rendered.getByRole('button', { name: 'Annehmen' }));
    await fireEvent.press(rendered.getByRole('button', { name: 'Ablehnen' }));
    await fireEvent.press(rendered.getByRole('button', { name: 'Entfernen' }));

    expect(onAccept).toHaveBeenCalledWith(incoming);
    expect(onDecline).toHaveBeenCalledWith(incoming);
    expect(onRemove).toHaveBeenCalledWith(accepted);
    expect(containsImageUri(
      rendered.getByLabelText('Profilbild von Alice Beispiel'),
      alice.avatarUrl,
    )).toBe(true);
    expect(rendered.getByText('BB')).toBeTruthy();
    await rendered.unmount();
  });

  it('keeps timer and manual privacy consent separate and explains total redaction', async () => {
    const onChange = jest.fn<void, [PrivacySourceKey, boolean]>();
    const values: PrivacySourceValues = {
      shareTimerStats: false,
      shareManualStats: false,
      shareGoalProgress: false,
      shareStreak: false,
    };
    const rendered = await render(
      <PrivacySourceToggles onChange={onChange} values={values} />,
    );

    await fireEvent(rendered.getByLabelText('Timer-Statistiken'), 'valueChange', true);
    await fireEvent(rendered.getByLabelText('Manuelle Einträge'), 'valueChange', true);

    expect(onChange).toHaveBeenNthCalledWith(1, 'shareTimerStats', true);
    expect(onChange).toHaveBeenNthCalledWith(2, 'shareManualStats', true);
    expect(rendered.getByText(/Gesamtwert wird Freunden nur angezeigt/)).toBeTruthy();
    await rendered.unmount();
  });

  it.each([
    [390, '100%'],
    [1024, '31%'],
  ])('shows all six stat periods responsively at %ipx', async (width, expectedBasis) => {
    setWindowWidth(width);
    const rendered = await render(
      <FriendStatsGrid goalReached={false} periods={friendPeriods} streakDays={4} />,
    );

    expect(rendered.getAllByRole('header')).toHaveLength(6);
    expect(rendered.getAllByText('Nicht freigegeben').length).toBeGreaterThanOrEqual(2);
    expect(rendered.getByText('4 Tage')).toBeTruthy();
    expect(StyleSheet.flatten(rendered.getByLabelText('Heute').props.style).flexBasis).toBe(
      expectedBasis,
    );
    await rendered.unmount();
  });

  it('renders explicit loading and retryable error states for friend stats', async () => {
    const onRetry = jest.fn();
    const loading = await render(<FriendStatsGrid periods={[]} state="loading" />);
    expect(loading.getByText(/werden geladen/)).toBeTruthy();
    await loading.unmount();

    const failed = await render(
      <FriendStatsGrid onRetry={onRetry} periods={[]} state="error" />,
    );
    await fireEvent.press(failed.getByRole('button', { name: 'Erneut versuchen' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await failed.unmount();
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

  it('renders general friend status and aggregates without leaking private learning details', async () => {
    const friend = {
      user: alice,
      status: 'learning_now',
      activeSince: '2026-07-22T08:00:00.000Z',
      lastStudyAt: '2026-07-22T08:00:00.000Z',
      weekMinutes: 125,
      streakDays: 4,
      privateSubject: 'Analysis II',
      privateTask: 'Übungsblatt 7 lösen',
      privateNote: 'Schwierige Integrale wiederholen',
    } satisfies FriendStatusViewModel & {
      privateSubject: string;
      privateTask: string;
      privateNote: string;
    };
    const rendered = await render(
      <FriendStatusCard friend={friend} now={new Date('2026-07-22T08:42:00.000Z')} />,
    );

    expect(rendered.getByText('Lernt gerade')).toBeTruthy();
    expect(rendered.getByText('Lernt seit 42 Min.')).toBeTruthy();
    expect(rendered.getByText('2 Std. 5 Min.')).toBeTruthy();
    expect(rendered.getByText('4 Tage')).toBeTruthy();
    expect(rendered.queryByText(friend.privateSubject)).toBeNull();
    expect(rendered.queryByText(friend.privateTask)).toBeNull();
    expect(rendered.queryByText(friend.privateNote)).toBeNull();
    await rendered.unmount();
  });

  it('sorts current learners first and exposes all three status labels', async () => {
    const friends: readonly FriendStatusViewModel[] = [
      {
        user: bob,
        status: 'not_learned_today',
        lastStudyAt: '2026-07-21T08:00:00.000Z',
        weekMinutes: 30,
        streakDays: 1,
      },
      {
        user: alice,
        status: 'learning_now',
        activeSince: '2026-07-22T08:30:00.000Z',
        lastStudyAt: '2026-07-22T08:30:00.000Z',
        weekMinutes: 90,
        streakDays: 3,
      },
    ];
    const rendered = await render(
      <>
        <ActiveFriendsList friends={friends} now={new Date('2026-07-22T09:00:00.000Z')} />
        <LearningStatusBadge status="learned_today" />
      </>,
    );

    expect(rendered.getAllByTestId(/friend-status-/).map((node) => node.props.testID)).toEqual([
      'friend-status-alice-id',
      'friend-status-bob-id',
    ]);
    expect(rendered.getByText('Heute bereits gelernt')).toBeTruthy();
    expect(rendered.getByText('Heute noch nicht gelernt')).toBeTruthy();
    await rendered.unmount();
  });

  it('binds the three social quick actions', async () => {
    const onAddFriend = jest.fn();
    const onCreateGroup = jest.fn();
    const onStartSession = jest.fn();
    const rendered = await render(
      <SocialQuickActions
        onAddFriend={onAddFriend}
        onCreateGroup={onCreateGroup}
        onStartSession={onStartSession}
      />,
    );

    await fireEvent.press(rendered.getByRole('button', { name: 'Freund hinzufügen' }));
    await fireEvent.press(rendered.getByRole('button', { name: 'Gruppe erstellen' }));
    await fireEvent.press(rendered.getByRole('button', { name: 'Gemeinsam lernen' }));

    expect(onAddFriend).toHaveBeenCalledTimes(1);
    expect(onCreateGroup).toHaveBeenCalledTimes(1);
    expect(onStartSession).toHaveBeenCalledTimes(1);
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
