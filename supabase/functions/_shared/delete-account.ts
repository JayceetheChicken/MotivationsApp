export interface DeleteAccountAdmin {
  getUserId: (accessToken: string) => Promise<string>;
  listAvatarObjectPaths: (userId: string) => Promise<readonly string[]>;
  removeAvatarObjects: (paths: readonly string[]) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
}

export interface DeleteAccountRequest {
  authorization: string | null;
  confirmation: unknown;
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
  try {
    userId = await admin.getUserId(token);
  } catch {
    return safeFailure(401, "Die Anmeldung ist ungültig oder abgelaufen.");
  }
  if (!userId) {
    return safeFailure(401, "Die Anmeldung ist ungültig oder abgelaufen.");
  }

  try {
    const avatarPaths = await admin.listAvatarObjectPaths(userId);
    if (avatarPaths.length > 0) await admin.removeAvatarObjects(avatarPaths);
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
