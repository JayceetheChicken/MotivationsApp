// Keep the Edge Function runtime dependency pinned independently of the app bundle.
// deno-lint-ignore no-import-prefix
import { createClient } from "npm:@supabase/supabase-js@2.111.0";

import {
  type DeleteAccountAdmin,
  deleteAvatarTree,
  executeDeleteAccount,
  isExplicitUserNotFoundError,
  isValidAccountDeletionFence,
  recentPasswordAuthenticationTimestamp,
} from "../_shared/delete-account.ts";

const allowedBrowserOrigins = new Set(
  (Deno.env.get("ALLOWED_BROWSER_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const baseHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function responseHeaders(origin: string | null): HeadersInit {
  return origin && allowedBrowserOrigins.has(origin)
    ? {
      ...baseHeaders,
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin",
    }
    : baseHeaders;
}

function jsonResponse(
  status: number,
  body: unknown,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(origin),
  });
}

function environment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

const supabaseUrl = environment("SUPABASE_URL");
const serviceRoleKey = environment("SUPABASE_SERVICE_ROLE_KEY");
const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function listFolderPage(folder: string, offset: number): Promise<
  readonly {
    id?: string | null;
    metadata?: unknown;
    name: string;
  }[]
> {
  const { data, error } = await adminClient.storage.from("avatars").list(
    folder,
    {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" },
    },
  );
  if (error) throw error;
  return data ?? [];
}

const admin: DeleteAccountAdmin = {
  async getAuthenticatedUser(accessToken) {
    const { data, error } = await adminClient.auth.getUser(accessToken);
    if (error || !data.user) throw error ?? new Error("User not found");
    const encodedPayload = accessToken.split(".")[1];
    if (!encodedPayload) throw new Error("JWT payload missing");
    const normalized = encodedPayload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as unknown;
    return {
      userId: data.user.id,
      passwordAuthenticatedAtEpochSeconds:
        recentPasswordAuthenticationTimestamp(payload, data.user.id),
    };
  },
  async beginAccountDeletion(userId) {
    const { data, error } = await adminClient.rpc("begin_account_deletion", {
      p_user_id: userId,
    });
    if (error) throw error;
    if (!isValidAccountDeletionFence(data, userId)) {
      throw new Error("Invalid account deletion fence response");
    }
  },
  async deleteAvatarObjects(userId) {
    await deleteAvatarTree(userId, {
      listFolderPage,
      async removeObjects(paths) {
        const { error } = await adminClient.storage.from("avatars").remove([
          ...paths,
        ]);
        if (error) throw error;
      },
    });
  },
  async deleteUser(userId) {
    const { error } = await adminClient.auth.admin.deleteUser(userId, false);
    if (error && !isExplicitUserNotFoundError(error)) throw error;
  },
};

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedBrowserOrigins.has(origin)) {
    return jsonResponse(403, { error: "Anfrage nicht erlaubt." }, null);
  }
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders(origin) });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Methode nicht erlaubt." }, origin);
  }

  let confirmation: unknown;
  try {
    confirmation =
      (await request.json() as { confirmation?: unknown }).confirmation;
  } catch {
    return jsonResponse(400, { error: "Ungültige Anfrage." }, origin);
  }

  const result = await executeDeleteAccount({
    authorization: request.headers.get("authorization"),
    confirmation,
  }, admin);
  return jsonResponse(result.status, result.body, origin);
});
