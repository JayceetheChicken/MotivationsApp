import type { StudyStateSnapshot } from '@/lib/study-state-transfer';
import type {
  ImportChunk,
  ImportCounts,
  ImportRepository,
  LocalImportManifest,
  LocalImportReport,
} from '@/data/repositories/study-repository';
import { throwIfAborted } from '@/data/repositories/repository-error';

const DEFAULT_CHUNK_SIZE = 50;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function utf8Bytes(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value);
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

/** Small synchronous SHA-256 fallback so native imports do not depend on Web Crypto. */
export function sha256Hex(value: string): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const input = [...utf8Bytes(value)];
  const bitLength = input.length * 8;
  input.push(0x80);
  while (input.length % 64 !== 56) input.push(0);
  const bitLengthHigh = Math.floor(bitLength / 0x100000000);
  const bitLengthLow = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) input.push((bitLengthHigh >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) input.push((bitLengthLow >>> shift) & 0xff);

  for (let offset = 0; offset < input.length; offset += 64) {
    const words = new Array<number>(64).fill(0);
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      words[index] = (
        (input[position] << 24)
        | (input[position + 1] << 16)
        | (input[position + 2] << 8)
        | input[position + 3]
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choose + constants[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return hash.map((entry) => entry.toString(16).padStart(8, '0')).join('');
}

function chunkPayload(
  entityType: ImportChunk['entityType'],
  payload: readonly unknown[],
  chunkSize: number,
  startIndex: number,
): ImportChunk[] {
  const chunks: ImportChunk[] = [];
  for (let offset = 0; offset < payload.length; offset += chunkSize) {
    const entries = payload.slice(offset, offset + chunkSize);
    chunks.push({
      index: startIndex + chunks.length,
      entityType,
      hash: sha256Hex(stableStringify(entries)),
      payload: entries,
    });
  }
  return chunks;
}

function buildWarnings(snapshot: StudyStateSnapshot): string[] {
  const warnings: string[] = [];
  const subjectIds = new Set(snapshot.data.subjects.map((subject) => subject.id));
  const goalIds = new Set(snapshot.data.goals.map((goal) => goal.id));
  const sessionIds = new Set(snapshot.data.sessions.map((session) => session.id));

  for (const goal of snapshot.data.goals) {
    if (goal.subjectId && !subjectIds.has(goal.subjectId)) warnings.push(`Ziel ${goal.id} verweist auf ein fehlendes Fach.`);
  }
  for (const session of snapshot.data.sessions) {
    if (!subjectIds.has(session.subjectId)) warnings.push(`Session ${session.id} verweist auf ein fehlendes Fach.`);
    if (session.goalId && !goalIds.has(session.goalId)) warnings.push(`Session ${session.id} verweist auf ein fehlendes Ziel.`);
  }
  for (const grade of snapshot.data.grades) {
    if (!subjectIds.has(grade.subjectId)) warnings.push(`Note ${grade.id} verweist auf ein fehlendes Fach.`);
    for (const sessionId of grade.sessionIds) {
      if (!sessionIds.has(sessionId)) warnings.push(`Note ${grade.id} verweist auf eine fehlende Session.`);
    }
  }
  if (snapshot.data.activeTimer) warnings.push('Ein laufender oder pausierter Timer wird erst nach ausdrücklicher Bestätigung dem Konto zugeordnet.');
  if (snapshot.data.friends.length > 0) warnings.push('Lokale Freundschaften werden aus Sicherheitsgründen nicht importiert.');
  if (snapshot.data.challenges.length > 0) warnings.push('Lokale gemeinsame Ziele werden aus Sicherheitsgründen nicht importiert.');
  return [...new Set(warnings)];
}

export function createLocalImportManifest(
  snapshot: StudyStateSnapshot,
  deviceFingerprint: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
): LocalImportManifest {
  const cleanFingerprint = deviceFingerprint.trim();
  if (!cleanFingerprint) throw new Error('Für den Import wird ein Gerätefingerabdruck benötigt.');
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 100) {
    throw new Error('Die Import-Chunkgröße muss zwischen 1 und 100 liegen.');
  }

  const payloads = {
    // The import RPC consumes the persisted local (camelCase) wire shape so
    // legacy IDs and references remain available for the server-side ID map.
    subjects: snapshot.data.subjects.map((subject) => ({ ...subject })),
    goals: snapshot.data.goals.map((goal) => ({ ...goal })),
    sessions: snapshot.data.sessions.map((session) => ({ ...session })),
    grades: snapshot.data.grades.map((grade) => ({ ...grade, sessionIds: [...grade.sessionIds] })),
  };
  const counts: ImportCounts = {
    subjects: payloads.subjects.length,
    goals: payloads.goals.length,
    sessions: payloads.sessions.length,
    grades: payloads.grades.length,
    gradeSessionLinks: snapshot.data.grades.reduce((sum, grade) => sum + grade.sessionIds.length, 0),
  };
  const chunks: ImportChunk[] = [];
  (Object.keys(payloads) as (keyof typeof payloads)[]).forEach((entityType) => {
    chunks.push(...chunkPayload(entityType, payloads[entityType], chunkSize, chunks.length));
  });
  const canonicalPayload = { counts, payloads };

  return {
    version: 1,
    deviceFingerprint: cleanFingerprint,
    payloadHash: sha256Hex(stableStringify(canonicalPayload)),
    counts,
    chunks,
    warnings: buildWarnings(snapshot),
    hasActiveTimer: snapshot.data.activeTimer !== null,
    excluded: {
      friends: snapshot.data.friends.length,
      challenges: snapshot.data.challenges.length,
      privacy: true,
    },
  };
}

export interface ImportProgress {
  stagedChunks: number;
  totalChunks: number;
}

export class ImportCoordinator {
  constructor(private readonly repository: ImportRepository) {}

  async execute(
    manifest: LocalImportManifest,
    onProgress?: (progress: ImportProgress) => void,
    signal?: AbortSignal,
  ): Promise<LocalImportReport> {
    throwIfAborted(signal);
    let handle = await this.repository.begin(manifest, signal);
    if (handle.state !== 'staging') return this.repository.finalize(handle.importId, signal);
    const accepted = new Set(handle.acceptedChunkIndices);
    onProgress?.({ stagedChunks: accepted.size, totalChunks: manifest.chunks.length });

    for (const chunk of manifest.chunks) {
      throwIfAborted(signal);
      if (!accepted.has(chunk.index)) {
        handle = await this.repository.stageChunk(handle.importId, chunk, signal);
        handle.acceptedChunkIndices.forEach((index) => accepted.add(index));
      }
      onProgress?.({ stagedChunks: accepted.size, totalChunks: manifest.chunks.length });
    }

    throwIfAborted(signal);
    return this.repository.finalize(handle.importId, signal);
  }
}
