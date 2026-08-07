// Keep the Edge Function runtime dependency pinned independently of the app bundle.
// deno-lint-ignore no-import-prefix
import { createClient } from "npm:@supabase/supabase-js@2.111.0";

import {
  type DeleteAccountAdmin,
  executeDeleteAccount,
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

async function listFolder(folder: string): Promise<
  readonly {
    id?: string | null;
    metadata?: unknown;
    name: string;
  }[]
> {
  const result: { id?: string | null; metadata?: unknown; name: string }[] = [];
  for (let offset = 0;; offset += 100) {
    const { data, error } = await adminClient.storage.from("avatars").list(
      folder,
      {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      },
    );
    if (error) {
      if (/bucket.*not found|not found.*bucket/i.test(error.message)) return [];
      throw error;
    }
    result.push(...(data ?? []));
    if (!data || data.length < 100) break;
  }
  return result;
}

const admin: DeleteAccountAdmin = {
  async getAuthenticatedUser(accessToken) {
    const { data, error } = await adminClient.auth.getUser(accessToken);
    if (error || !data.user) throw error ?? new Error("User not found");
    const encodedPayload = accessToken.split(".")[1];
    if (!encodedPayload) throw new Error("JWT payload missing");
    const normalized = encodedPayload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { iat?: unknown };
    if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat)) {
      throw new Error("JWT issued-at missing");
    }
    return { userId: data.user.id, issuedAtEpochSeconds: payload.iat };
  },
  async listAvatarObjectPaths(userId) {
    const paths: string[] = [];
    const folders = [userId];
    let visitedFolders = 0;
    while (folders.length > 0) {
      const folder = folders.shift();
      if (!folder) continue;
      visitedFolders += 1;
      if (visitedFolders > 100 || paths.length > 10_000) {
        throw new Error("Avatar object traversal limit exceeded");
      }
      for (const entry of await listFolder(folder)) {
        const path = `${folder}/${entry.name}`;
        if (entry.id || entry.metadata) paths.push(path);
        else folders.push(path);
      }
    }
    return paths;
  },
  async removeAvatarObjects(paths) {
    for (let offset = 0; offset < paths.length; offset += 100) {
      const { error } = await adminClient.storage
        .from("avatars")
        .remove(paths.slice(offset, offset + 100));
      if (error) throw error;
    }
  },
  async prepareUserData(userId) {
    const { data, error } = await adminClient.rpc("prepare_account_deletion", {
      p_user_id: userId,
    });
    if (error || !(data as { prepared?: unknown } | null)?.prepared) {
      throw error ?? new Error("Account preparation failed");
    }
  },
  async deleteUser(userId) {
    const { error } = await adminClient.auth.admin.deleteUser(userId, false);
    if (
      error &&
      error.status !== 404 &&
      error.code !== "user_not_found" &&
      !/user.*not found/i.test(error.message)
    ) throw error;
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
