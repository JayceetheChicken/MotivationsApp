export interface DeleteAccountAdmin {
  getAuthenticatedUser: (accessToken: string) => Promise<
    Readonly<{
      userId: string;
      passwordAuthenticatedAtEpochSeconds: number;
    }>
  >;
  beginAccountDeletion: (userId: string) => Promise<void>;
  deleteAvatarObjects: (userId: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
}

export interface DeleteAccountRequest {
  authorization: string | null;
  confirmation: unknown;
  nowEpochSeconds?: number;
}

export interface DeleteAccountResult {
  status: number;
  body: Readonly<{ deleted?: boolean; error?: string }>;
}

function bearerToken(authorization: string | null): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function safeFailure(status: number, error: string): DeleteAccountResult {
  return { status, body: { error } };
}

export const MAX_DELETE_REAUTH_AGE_SECONDS = 5 * 60;

export function isExplicitUserNotFoundError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "user_not_found",
  );
}

export function isValidAccountDeletionFence(
  value: unknown,
  expectedUserId: string,
): boolean {
  if (!value || typeof value !== "object") return false;
  const fence = value as {
    prepared?: unknown;
    started_at?: unknown;
    storage_fenced?: unknown;
    trigger_managed?: unknown;
    user_id?: unknown;
  };
  return fence.prepared === true &&
    fence.trigger_managed === true &&
    fence.storage_fenced === true &&
    fence.user_id === expectedUserId &&
    typeof fence.started_at === "string" &&
    Number.isFinite(Date.parse(fence.started_at));
}

type AvatarEntry = Readonly<{
  id?: string | null;
  metadata?: unknown;
  name: string;
}>;

export interface AvatarStorage {
  listFolderPage: (
    folder: string,
    offset: number,
  ) => Promise<readonly AvatarEntry[]>;
  removeObjects: (paths: readonly string[]) => Promise<void>;
}

const AVATAR_PAGE_SIZE = 100;
const MAX_PENDING_AVATAR_FOLDERS = 100;
const MAX_AVATAR_FOLDER_VISITS_PER_REQUEST = 10_000;
const MAX_AVATAR_OBJECTS_PER_REQUEST = 10_000;
function isSafeStorageSegment(value: string): boolean {
  if (!value || value.includes("/") || value.includes("\\")) return false;
  return ![...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

/**
 * Deletes avatar objects in bounded pages instead of retaining the complete
 * object tree in memory. If a legacy account exceeds the per-request object
 * budget, completed pages stay deleted and a retry continues making progress.
 */
export async function deleteAvatarTree(
  userId: string,
  storage: AvatarStorage,
): Promise<void> {
  const pendingFolders = [userId];
  const discoveredFolders = new Set(pendingFolders);
  let deferredFolderFound = false;
  let visitedFolders = 0;
  let removedObjects = 0;

  while (pendingFolders.length > 0) {
    const folder = pendingFolders.shift();
    if (!folder) continue;
    if (visitedFolders >= MAX_AVATAR_FOLDER_VISITS_PER_REQUEST) {
      throw new Error("Avatar folder traversal budget exceeded");
    }
    visitedFolders += 1;
    let offset = 0;

    for (;;) {
      const entries = await storage.listFolderPage(folder, offset);
      if (entries.length === 0) break;

      const objectPaths: string[] = [];
      for (const entry of entries) {
        if (
          !isSafeStorageSegment(entry.name) || entry.name === "." ||
          entry.name === ".."
        ) {
          throw new Error("Invalid avatar storage entry");
        }
        const objectPath = `${folder}/${entry.name}`;
        if (entry.id || entry.metadata) {
          objectPaths.push(objectPath);
        } else if (!discoveredFolders.has(objectPath)) {
          if (pendingFolders.length >= MAX_PENDING_AVATAR_FOLDERS) {
            // Do not fail before the already queued folders have been cleaned.
            // Their synthetic parent entries disappear after object deletion,
            // so the next retry can discover a fresh bounded frontier.
            deferredFolderFound = true;
            continue;
          }
          discoveredFolders.add(objectPath);
          pendingFolders.push(objectPath);
        }
      }

      if (objectPaths.length > 0) {
        if (
          removedObjects + objectPaths.length > MAX_AVATAR_OBJECTS_PER_REQUEST
        ) {
          throw new Error("Avatar object deletion budget exceeded");
        }
        await storage.removeObjects(objectPaths);
        removedObjects += objectPaths.length;
        // Deleting this page shifts later objects towards the beginning.
        offset = 0;
        continue;
      }

      if (entries.length < AVATAR_PAGE_SIZE) break;
      offset += entries.length;
    }
  }

  if (deferredFolderFound) {
    throw new Error("Avatar folder traversal budget exceeded");
  }
}

export function recentPasswordAuthenticationTimestamp(
  payload: unknown,
  expectedUserId: string,
): number {
  if (!payload || typeof payload !== "object") {
    throw new Error("JWT payload missing");
  }
  const claims = payload as { sub?: unknown; amr?: unknown };
  if (claims.sub !== expectedUserId || !Array.isArray(claims.amr)) {
    throw new Error("Password authentication claim missing");
  }

  const timestamps = claims.amr.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const method = (entry as { method?: unknown }).method;
    const timestamp = (entry as { timestamp?: unknown }).timestamp;
    return method === "password" && typeof timestamp === "number" &&
        Number.isSafeInteger(timestamp)
      ? [timestamp]
      : [];
  });
  if (timestamps.length === 0) {
    throw new Error("Recent password authentication required");
  }
  return Math.max(...timestamps);
}

export async function executeDeleteAccount(
  request: DeleteAccountRequest,
  admin: DeleteAccountAdmin,
): Promise<DeleteAccountResult> {
  const token = bearerToken(request.authorization);
  if (!token) return safeFailure(401, "Nicht angemeldet.");
  if (request.confirmation !== "DELETE") {
    return safeFailure(400, "Die ausdrückliche Löschbestätigung fehlt.");
  }

  let userId: string;
  let passwordAuthenticatedAtEpochSeconds: number;
  try {
    ({ userId, passwordAuthenticatedAtEpochSeconds } = await admin
      .getAuthenticatedUser(token));
  } catch {
    return safeFailure(401, "Die Anmeldung ist ungültig oder abgelaufen.");
  }
  if (!userId || !Number.isFinite(passwordAuthenticatedAtEpochSeconds)) {
    return safeFailure(401, "Die Anmeldung ist ungültig oder abgelaufen.");
  }

  const nowEpochSeconds = request.nowEpochSeconds ??
    Math.floor(Date.now() / 1000);
  const authenticationAge = nowEpochSeconds -
    passwordAuthenticatedAtEpochSeconds;
  if (
    authenticationAge < -60 || authenticationAge > MAX_DELETE_REAUTH_AGE_SECONDS
  ) {
    return safeFailure(403, "Bitte bestätige deine Identität erneut.");
  }

  try {
    await admin.beginAccountDeletion(userId);
    await admin.deleteAvatarObjects(userId);
    await admin.deleteUser(userId);
    return { status: 200, body: { deleted: true } };
  } catch {
    // Fixed message only: never emit the bearer token, account id, or a raw
    // provider error that could contain infrastructure details.
    console.error("[delete-account] Server-side deletion failed");
    return safeFailure(
      500,
      "Das Konto konnte nicht vollständig gelöscht werden.",
    );
  }
}
