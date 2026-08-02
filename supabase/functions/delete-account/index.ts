// Keep the Edge Function runtime dependency pinned independently of the app bundle.
// deno-lint-ignore no-import-prefix
import { createClient } from "npm:@supabase/supabase-js@2.111.0";

import {
  type DeleteAccountAdmin,
  executeDeleteAccount,
} from "../_shared/delete-account.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
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
  async getUserId(accessToken) {
    const { data, error } = await adminClient.auth.getUser(accessToken);
    if (error || !data.user) throw error ?? new Error("User not found");
    return data.user.id;
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
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Methode nicht erlaubt." });
  }

  let confirmation: unknown;
  try {
    confirmation =
      (await request.json() as { confirmation?: unknown }).confirmation;
  } catch {
    return jsonResponse(400, { error: "Ungültige Anfrage." });
  }

  const result = await executeDeleteAccount({
    authorization: request.headers.get("authorization"),
    confirmation,
  }, admin);
  return jsonResponse(result.status, result.body);
});
