import type { StudyData } from '@/types/study';

const LOCAL_USER_ID = 'local-user';

export interface StudyPrivacySnapshot {
  friendComparisonsEnabled: boolean;
  shareAutomaticMinutes: boolean;
  shareGoalProgress: boolean;
  shareStreak: boolean;
}

export interface StudyStateSnapshot {
  data: StudyData;
  privacy: StudyPrivacySnapshot;
}

function mergeById<T extends { id: string }>(
  accountEntries: readonly T[],
  localEntries: readonly T[],
): T[] {
  const merged = new Map(accountEntries.map((entry) => [entry.id, entry]));
  localEntries.forEach((entry) => {
    if (!merged.has(entry.id)) merged.set(entry.id, entry);
  });
  return [...merged.values()];
}

/**
 * Rebinds device-owned records to the authenticated account while keeping all
 * stable entity IDs and links intact.
 */
export function assignStudyStateToAccount(
  state: StudyStateSnapshot,
  accountUserId: string,
): StudyStateSnapshot {
  const cleanAccountUserId = accountUserId.trim();
  if (!cleanAccountUserId) return state;

  const localOwnerIds = new Set([
    LOCAL_USER_ID,
    state.data.currentUser?.id,
  ].filter((value): value is string => Boolean(value)));
  const rebind = (userId: string) => localOwnerIds.has(userId) ? cleanAccountUserId : userId;

  return {
    privacy: { ...state.privacy },
    data: {
      ...state.data,
      currentUser: state.data.currentUser
        ? { ...state.data.currentUser, id: cleanAccountUserId }
        : null,
      sessions: state.data.sessions.map((session) => ({
        ...session,
        userId: rebind(session.userId),
      })),
      grades: state.data.grades.map((grade) => ({
        ...grade,
        userId: rebind(grade.userId),
      })),
      goals: state.data.goals.map((goal) => ({
        ...goal,
        userId: rebind(goal.userId),
      })),
      activeTimer: state.data.activeTimer
        ? { ...state.data.activeTimer, userId: rebind(state.data.activeTimer.userId) }
        : null,
      challenges: state.data.challenges.map((challenge) => ({
        ...challenge,
        creatorId: rebind(challenge.creatorId),
        participants: challenge.participants.map((participant) => ({
          ...participant,
          userId: rebind(participant.userId),
        })),
      })),
    },
  };
}

/**
 * Imports personal device data into an account cache. Account records win on
 * ID collisions, so reconnecting is safe and never creates duplicates.
 * Friendships and shared challenges remain account-specific.
 */
export function mergeLocalStudyStateIntoAccount(
  accountState: StudyStateSnapshot | null,
  localState: StudyStateSnapshot,
  accountUserId: string,
): StudyStateSnapshot {
  const local = assignStudyStateToAccount(localState, accountUserId);
  const account = accountState
    ? assignStudyStateToAccount(accountState, accountUserId)
    : null;

  return {
    privacy: account ? { ...account.privacy } : { ...local.privacy },
    data: {
      currentUser: account?.data.currentUser ?? local.data.currentUser,
      subjects: mergeById(account?.data.subjects ?? [], local.data.subjects),
      sessions: mergeById(account?.data.sessions ?? [], local.data.sessions),
      grades: mergeById(account?.data.grades ?? [], local.data.grades),
      goals: mergeById(account?.data.goals ?? [], local.data.goals),
      friends: account?.data.friends ?? [],
      challenges: account?.data.challenges ?? [],
      activeTimer: account?.data.activeTimer ?? local.data.activeTimer,
    },
  };
}
