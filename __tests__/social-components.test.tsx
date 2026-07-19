import { useState } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import {
  AccountRequiredCta,
  FriendStatsGrid,
  PrivacySourceToggles,
  SharedGoalCard,
  SharedGoalFormFields,
  SocialConnectionsList,
  UsernameSearch,
  type FriendStatsPeriod,
  type PrivacySourceKey,
  type PrivacySourceValues,
  type SharedGoalFormValue,
  type SocialUserSummary,
} from '@/components/social';

function setWindowWidth(width: number) {
  const dimensions = { width, height: 900, scale: 1, fontScale: 1 };
  Dimensions.set({ window: dimensions, screen: dimensions });
}

const alice: SocialUserSummary = {
  id: 'alice-id',
  username: 'alice',
  displayName: 'Alice Beispiel',
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
  period: 'week',
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
  ])('uses a phone or tablet form layout at %ipx without date fields', async (width, flexDirection) => {
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
    expect(rendered.queryByLabelText(/datum/i)).toBeNull();
    expect(rendered.queryByText(/Startdatum|Enddatum/)).toBeNull();

    await fireEvent.changeText(
      rendered.getByLabelText('Titel des gemeinsamen Lernziels'),
      'Prüfungsteam',
    );
    await fireEvent.press(rendered.getByRole('checkbox', { name: 'Alice Beispiel einladen' }));

    expect(rendered.getByDisplayValue('Prüfungsteam')).toBeTruthy();
    expect(
      rendered.getByRole('checkbox', { name: 'Alice Beispiel einladen' }).props.accessibilityState,
    ).toMatchObject({ checked: true });
    await rendered.unmount();
  });
});
