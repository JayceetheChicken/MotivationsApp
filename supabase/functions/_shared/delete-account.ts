export interface DeleteAccountAdmin {
  getAuthenticatedUser: (accessToken: string) => Promise<
    Readonly<{
      userId: string;
      issuedAtEpochSeconds: number;
    }>
  >;
  listAvatarObjectPaths: (userId: string) => Promise<readonly string[]>;
  removeAvatarObjects: (paths: readonly string[]) => Promise<void>;
  prepareUserData: (userId: string) => Promise<void>;
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
  let issuedAtEpochSeconds: number;
  try {
    ({ userId, issuedAtEpochSeconds } = await admin.getAuthenticatedUser(
      token,
    ));
  } catch {
    return safeFailure(401, "Die Anmeldung ist ungültig oder abgelaufen.");
  }
  if (!userId || !Number.isFinite(issuedAtEpochSeconds)) {
    return safeFailure(401, "Die Anmeldung ist ungültig oder abgelaufen.");
  }

  const nowEpochSeconds = request.nowEpochSeconds ??
    Math.floor(Date.now() / 1000);
  const authenticationAge = nowEpochSeconds - issuedAtEpochSeconds;
  if (
    authenticationAge < -60 || authenticationAge > MAX_DELETE_REAUTH_AGE_SECONDS
  ) {
    return safeFailure(403, "Bitte bestätige deine Identität erneut.");
  }

  try {
    const avatarPaths = await admin.listAvatarObjectPaths(userId);
    if (avatarPaths.length > 0) await admin.removeAvatarObjects(avatarPaths);
    await admin.prepareUserData(userId);
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
