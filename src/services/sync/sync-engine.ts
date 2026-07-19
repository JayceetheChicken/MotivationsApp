import type { StudyStateSnapshot } from '@/lib/study-state-transfer';
import type { CoreMutation } from '@/data/repositories/study-repository';
import type { StudyGoal } from '@/types/study';
import {
  toGradePayload,
  toPersonalGoalPayload,
  toSessionPayload,
  toSubjectPayload,
} from '@/data/mappers/database-mappers';

function createUuid(): string {
  const cryptoValue = globalThis.crypto as Crypto | undefined;
  if (typeof cryptoValue?.randomUUID === 'function') return cryptoValue.randomUUID();

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function changed(previous: unknown, next: unknown): boolean {
  return JSON.stringify(previous) !== JSON.stringify(next);
}

function changedEntries<T extends { id: string }>(
  previous: readonly T[],
  next: readonly T[],
): readonly T[] {
  const previousById = new Map(previous.map((entry) => [entry.id, entry]));
  return next.filter((entry) => changed(previousById.get(entry.id), entry));
}

function withoutGoalLifecycle(goal: StudyGoal): unknown {
  const {
    status: _status,
    pausedAt: _pausedAt,
    pausedIntervals: _pausedIntervals,
    completedAt: _completedAt,
    archivedAt: _archivedAt,
    revision: _revision,
    syncVersion: _syncVersion,
    updatedAt: _updatedAt,
    ...content
  } = goal;
  return content;
}

function goalTransitionAt(previous: StudyGoal, next: StudyGoal): string {
  if (next.status === 'paused') return next.pausedAt ?? new Date().toISOString();
  if (next.status === 'completed') return next.completedAt ?? new Date().toISOString();
  if (next.status === 'archived') return next.archivedAt ?? new Date().toISOString();
  const intervals = next.pausedIntervals ?? [];
  return intervals[intervals.length - 1]?.endedAt
    ?? previous.pausedAt
    ?? new Date().toISOString();
}

/**
 * Computes safe, additive account mutations. Deletions are never inferred from
 * a missing array member because filtered UI snapshots are indistinguishable
 * from deletes; callers enqueue explicit soft-delete mutations instead.
 */
export function diffStudySnapshots(
  previous: StudyStateSnapshot | null,
  next: StudyStateSnapshot,
): readonly CoreMutation[] {
  const before = previous?.data;
  const mutations: CoreMutation[] = [];
  const subjectOperations = new Map<string, string>();
  const goalOperations = new Map<string, string>();
  const sessionOperations = new Map<string, string>();

  for (const subject of changedEntries(before?.subjects ?? [], next.data.subjects)) {
    const operationId = createUuid();
    subjectOperations.set(subject.id, operationId);
    mutations.push({
      operationId,
      name: 'upsert_subject',
      entityType: 'subject',
      entityId: subject.id,
      payload: toSubjectPayload(subject),
      expectedRevision: subject.revision,
    });
  }

  const previousGoals = new Map((before?.goals ?? []).map((goal) => [goal.id, goal]));
  for (const goal of changedEntries(before?.goals ?? [], next.data.goals)) {
    const operationId = createUuid();
    goalOperations.set(goal.id, operationId);
    const previousGoal = previousGoals.get(goal.id);
    const lifecycleOnly = previousGoal
      && previousGoal.status !== goal.status
      && !changed(withoutGoalLifecycle(previousGoal), withoutGoalLifecycle(goal));
    if (lifecycleOnly) {
      mutations.push({
        operationId,
        name: 'transition_personal_goal',
        entityType: 'goal',
        entityId: goal.id,
        payload: { status: goal.status, at: goalTransitionAt(previousGoal, goal) },
        expectedRevision: previousGoal.revision ?? goal.revision,
      });
      continue;
    }
    mutations.push({
      operationId,
      name: 'upsert_personal_goal',
      entityType: 'goal',
      entityId: goal.id,
      payload: toPersonalGoalPayload(goal),
      expectedRevision: goal.revision,
      dependsOn: goal.subjectId && subjectOperations.has(goal.subjectId)
        ? [subjectOperations.get(goal.subjectId)!]
        : [],
    });
  }

  for (const session of changedEntries(before?.sessions ?? [], next.data.sessions)) {
    const operationId = createUuid();
    sessionOperations.set(session.id, operationId);
    const dependencies = [
      subjectOperations.get(session.subjectId),
      session.goalId ? goalOperations.get(session.goalId) : undefined,
    ].filter((entry): entry is string => Boolean(entry));
    mutations.push({
      operationId,
      name: 'save_completed_session',
      entityType: 'session',
      entityId: session.id,
      payload: toSessionPayload(session),
      expectedRevision: session.revision,
      dependsOn: dependencies,
    });
  }

  for (const grade of changedEntries(before?.grades ?? [], next.data.grades)) {
    const dependencies = [
      subjectOperations.get(grade.subjectId),
      ...grade.sessionIds.map((sessionId) => sessionOperations.get(sessionId)),
    ].filter((entry): entry is string => Boolean(entry));
    mutations.push({
      operationId: createUuid(),
      name: 'upsert_grade',
      entityType: 'grade',
      entityId: grade.id,
      payload: toGradePayload(grade),
      expectedRevision: grade.revision,
      dependsOn: dependencies,
    });
  }

  return mutations;
}
