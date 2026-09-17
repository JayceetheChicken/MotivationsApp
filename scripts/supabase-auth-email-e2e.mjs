import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';

// Local Mailpit only: never sends test mail to a real person or uses a hosted
// admin key. Run after `supabase start` with status variables in the environment.
const api = new URL(process.env.API_URL);
assert.ok(api.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(api.hostname)
  && api.port === '54321', 'Auth mail E2E requires local Supabase');
const mail = 'http://127.0.0.1:54324';
const storage = new Map();
const client = createClient(api.origin, process.env.ANON_KEY, { auth: {
  flowType: 'pkce', detectSessionInUrl: false, autoRefreshToken: false, persistSession: true,
  storage: { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } },
} });
const admin = createClient(api.origin, process.env.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const suffix = randomUUID().replaceAll('-', '');
const email = `auth-${suffix}@example.test`;
const password = `Lz!${randomUUID()}aA7`;
const seen = new Set();
let userId;

async function confirmation(expectedType, expectedRedirect) {
  let message;
  for (let attempt = 0; attempt < 30 && !message; attempt++) {
    const response = await fetch(`${mail}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    assert.ok(response.ok, 'Local mailbox search failed');
    const result = await response.json();
    const item = result.messages?.find(candidate => !seen.has(candidate.ID));
    if (item) {
      seen.add(item.ID);
      const detail = await fetch(`${mail}/api/v1/message/${item.ID}`);
      assert.ok(detail.ok, 'Local mailbox message failed');
      message = await detail.json();
    } else await delay(1000);
  }
  assert.ok(message, 'Confirmation email was not delivered to local Mailpit');
  const html = message.HTML ?? '';
  const links = [...html.matchAll(/href=["']([^"']+)["']/g)].map(match => match[1].replaceAll('&amp;', '&'));
  const verification = links.map(link => new URL(link)).find(url => url.pathname === '/auth/v1/verify');
  assert.ok(verification?.origin === api.origin, 'Email must contain the actual local Supabase verification URL');
  assert.ok(verification.searchParams.get('type') === expectedType, 'Unexpected email type');
  assert.ok(verification.searchParams.get('redirect_to') === expectedRedirect, 'Email redirect mismatch');
  const verified = await fetch(verification, { redirect: 'manual' });
  assert.ok(verified.status === 302 || verified.status === 303, 'Verification did not redirect');
  const callback = new URL(verified.headers.get('location'));
  const expected = new URL(expectedRedirect);
  assert.ok(callback.protocol === expected.protocol && callback.host === expected.host
    && callback.pathname === expected.pathname, 'Supabase fell back to its Site URL');
  assert.ok(callback.searchParams.get('code') && !callback.hash, 'PKCE callback missing or implicit tokens returned');
  return { code: callback.searchParams.get('code'), verification };
}

try {
  const signup = await client.auth.signUp({ email, password, options: {
    emailRedirectTo: 'lernzeit://auth/callback',
    data: { display_name: 'Auth Test', username: `auth_${suffix.slice(0, 16)}`,
      community_rules_version: '2026-08-02', community_rules_accepted_at: new Date().toISOString() },
  } });
  assert.ok(!signup.error && signup.data.user?.id, 'Signup failed');
  userId = signup.data.user.id;
  assert.ok(!signup.data.session, 'Signup bypassed email confirmation');
  const confirmed = await confirmation('signup', 'lernzeit://auth/callback');
  const exchange = await client.auth.exchangeCodeForSession(confirmed.code);
  assert.ok(!exchange.error && exchange.data.session?.user.id === userId, 'PKCE session exchange failed');
  const identity = await client.auth.getUser();
  assert.ok(!identity.error && identity.data.user.email_confirmed_at, 'Server identity is not email-confirmed');
  const replay = await client.auth.exchangeCodeForSession(confirmed.code);
  assert.ok(replay.error, 'One-time code was accepted twice');
  const out = await client.auth.signOut({ scope: 'local' });
  assert.ok(!out.error, 'Signout failed');
  const reset = await client.auth.resetPasswordForEmail(email, {
    redirectTo: 'lernzeit://auth/update-password?type=recovery',
  });
  assert.ok(!reset.error, 'Recovery request failed');
  const recovery = await confirmation('recovery', 'lernzeit://auth/update-password?type=recovery');
  const recovered = await client.auth.exchangeCodeForSession(recovery.code);
  assert.ok(!recovered.error && recovered.data.redirectType === 'recovery', 'Recovery PKCE exchange failed');
  const updated = await client.auth.updateUser({ password: `${password}-new` });
  assert.ok(!updated.error, 'Password update failed');
  console.log('Auth email E2E passed: real signup, Mailpit delivery, deep-link redirect, PKCE, confirmed session, replay rejection, recovery and password update.');
} finally {
  if (userId) {
    const cleanup = await admin.auth.admin.deleteUser(userId);
    assert.ok(!cleanup.error, 'Auth test account cleanup failed');
  }
}
