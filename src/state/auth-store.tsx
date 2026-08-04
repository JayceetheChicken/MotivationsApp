import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import {
  createContext,
  type PropsWithChildren,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { requestOnlineAccountDeletion } from '@/auth/account-deletion';
import { clearAccountLocalData } from '@/auth/account-local-cleanup';
import { authStorage } from '@/auth/storage';
import {
  hasPasswordRecoveryMaterial,
  parsePasswordRecoveryUrl,
  PASSWORD_RECOVERY_REDIRECT_KIND,
  PASSWORD_RECOVERY_REDIRECT_URL,
  passwordRecoveryRequestFingerprint,
} from '@/auth/navigation';
import {
  supabase,
  supabaseConfiguration,
  type SupabaseConfiguration,
} from '@/auth/supabase';
import {
  avatarUriError,
  displayNameError,
  usernameError,
} from '@/auth/validation';
import { withTimeout } from '@/lib/with-timeout';
import { safeDebug, safeWarning } from '@/lib/safe-logger';

const LOCAL_PROFILE_STORAGE_KEY = 'lernzeit.local-profile.v1';
const SIGN_UP_CONFIRMATION_MESSAGE =
  'Falls die Angaben verwendet werden können, erhältst du gleich eine E-Mail zur Bestätigung.';
const BOOT_STEP_TIMEOUT_MS = 4000;

/**
 * Boot steps must always settle: a hanging or failing step resolves to its
 * fallback so the app can continue as a guest instead of blocking startup.
 */
async function settleBootStep<T>(label: string, promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await withTimeout(promise, BOOT_STEP_TIMEOUT_MS, label);
  } catch {
    safeWarning('[BOOT] Ein optionaler Startschritt ist fehlgeschlagen.');
    return fallback;
  }
}

export interface LocalProfile {
  schemaVersion: 1;
  displayName: string;
  username: string;
  avatarUri?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalProfileInput {
  displayName: string;
  username: string;
  avatarUri?: string;
}

export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
  username: string;
  communityRulesAccepted: boolean;
}

export interface AuthActionResult {
  ok: boolean;
  message: string;
  sessionCreated?: boolean;
}

export type AuthPendingAction =
  | 'restore'
  | 'sign-in'
  | 'sign-up'
  | 'reset-password'
  | 'update-password'
  | 'sign-out'
  | 'sign-out-clear-device'
  | 'delete-account'
  | 'save-local-profile'
  | 'remove-local-profile';

export type ActiveAuthMode = 'none' | 'supabase' | 'local';

interface AuthStoreValue {
  hydrated: boolean;
  loading: boolean;
  pendingAction: AuthPendingAction | null;
  session: Session | null;
  user: User | null;
  localProfile: LocalProfile | null;
  passwordRecoveryPending: boolean;
  activeMode: ActiveAuthMode;
  error: string | null;
  notice: string | null;
  configuration: SupabaseConfiguration;
  signIn: (email: string, password: string) => Promise<AuthActionResult>;
  signUp: (input: SignUpInput) => Promise<AuthActionResult>;
  sendPasswordReset: (email: string) => Promise<AuthActionResult>;
  updatePassword: (password: string) => Promise<AuthActionResult>;
  signOut: () => Promise<AuthActionResult>;
  signOutAndClearDeviceData: () => Promise<AuthActionResult>;
  deleteAccount: (password: string) => Promise<AuthActionResult>;
  saveLocalProfile: (input: LocalProfileInput) => Promise<AuthActionResult>;
  removeLocalProfile: () => Promise<AuthActionResult>;
  clearFeedback: () => void;
}

function isLocalProfile(value: unknown): value is LocalProfile {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<LocalProfile>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.displayName === 'string' &&
    candidate.displayName.trim().length >= 2 &&
    candidate.displayName.length <= 50 &&
    typeof candidate.username === 'string' &&
    candidate.username.trim().length >= 3 &&
    candidate.username.length <= 30 &&
    (candidate.avatarUri === undefined || (
      typeof candidate.avatarUri === 'string' && candidate.avatarUri.length <= 4096
    )) &&
    typeof candidate.createdAt === 'string' &&
    Number.isFinite(Date.parse(candidate.createdAt)) &&
    typeof candidate.updatedAt === 'string' &&
    Number.isFinite(Date.parse(candidate.updatedAt))
  );
}

async function readLocalProfile(): Promise<LocalProfile | null> {
  const rawValue = await authStorage.getItem(LOCAL_PROFILE_STORAGE_KEY);
  if (!rawValue) return null;

  try {
    const parsed: unknown = JSON.parse(rawValue);
    return isLocalProfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function errorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('message' in error)) return undefined;
  return typeof error.message === 'string' ? error.message : undefined;
}

function translateAuthError(error: unknown): string {
  const code = errorCode(error);
  const translatedByCode: Record<string, string> = {
    anonymous_provider_disabled: 'Anonyme Anmeldung ist für dieses Projekt deaktiviert.',
    email_address_invalid: 'Diese E-Mail-Adresse ist ungültig.',
    email_exists: 'Die Registrierung konnte nicht abgeschlossen werden. Bitte prüfe deine Angaben.',
    email_not_confirmed: 'Bestätige zuerst deine E-Mail-Adresse.',
    invalid_credentials: 'E-Mail-Adresse oder Passwort ist nicht korrekt.',
    over_email_send_rate_limit: 'Zu viele E-Mails in kurzer Zeit. Bitte versuche es später erneut.',
    over_request_rate_limit: 'Zu viele Anfragen in kurzer Zeit. Bitte warte einen Moment.',
    signup_disabled: 'Neue Registrierungen sind für dieses Projekt derzeit deaktiviert.',
    user_already_exists: 'Die Registrierung konnte nicht abgeschlossen werden. Bitte prüfe deine Angaben.',
    user_banned: 'Dieses Konto ist derzeit gesperrt.',
    weak_password: 'Das Passwort erfüllt die Sicherheitsanforderungen nicht.',
  };

  if (code && translatedByCode[code]) return translatedByCode[code];

  const message = errorMessage(error)?.toLowerCase();
  if (message?.includes('network request failed') || message?.includes('failed to fetch')) {
    return 'Der Online-Dienst ist gerade nicht erreichbar. Prüfe deine Internetverbindung.';
  }
  if (message?.includes('invalid login credentials')) {
    return 'E-Mail-Adresse oder Passwort ist nicht korrekt.';
  }

  return 'Die Anfrage konnte nicht abgeschlossen werden. Bitte versuche es erneut.';
}

const AuthStoreContext = createContext<AuthStoreValue | null>(null);

export function AuthStoreProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const processedRecoveryLinksRef = useRef(new Set<string>());
  const [localProfile, setLocalProfile] = useState<LocalProfile | null>(null);
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<AuthPendingAction | null>('restore');
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const authSubscription = supabase?.auth.onAuthStateChange((event, nextSession) => {
      if (!isMounted) return;
      sessionRef.current = nextSession;
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') setPasswordRecoveryPending(true);
    }).data.subscription;

    const handleAuthUrl = async (url: string | null) => {
      if (!url || !supabase || !isMounted) return;
      const recovery = parsePasswordRecoveryUrl(url);
      if (!recovery) {
        if (hasPasswordRecoveryMaterial(url)) {
          setError('Der Link zum Zurücksetzen ist ungültig oder abgelaufen. Fordere einen neuen Link an.');
        }
        return;
      }
      const fingerprint = passwordRecoveryRequestFingerprint(recovery);
      if (processedRecoveryLinksRef.current.has(fingerprint)) {
        setError('Dieser Link zum Zurücksetzen wurde bereits verarbeitet. Fordere bei Bedarf einen neuen Link an.');
        return;
      }
      let activeSession = sessionRef.current;
      if (!activeSession) {
        const { data: currentSessionData, error: currentSessionError } = await supabase.auth
          .getSession();
        if (!isMounted) return;
        if (currentSessionError) {
          setError('Der Link zum Zurücksetzen konnte nicht sicher geprüft werden. Versuche es später erneut.');
          return;
        }
        activeSession = currentSessionData.session;
        if (activeSession) {
          sessionRef.current = activeSession;
          setSession(activeSession);
        }
      }
      if (activeSession?.user.id) {
        setError('Melde dich zuerst ab, bevor du einen Link zum Zurücksetzen verwendest.');
        return;
      }
      processedRecoveryLinksRef.current.add(fingerprint);
      try {
        if (recovery.kind === 'pkce') {
          const { data: exchangeData, error: exchangeError } = await supabase.auth
            .exchangeCodeForSession(recovery.code);
          if (exchangeError) throw exchangeError;
          if (!exchangeData.session) throw new Error('Recovery session missing');
          if (isMounted) {
            sessionRef.current = exchangeData.session;
            setSession(exchangeData.session);
          }
        } else {
          const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
            access_token: recovery.accessToken,
            refresh_token: recovery.refreshToken,
          });
          if (sessionError) throw sessionError;
          if (!sessionData.session) throw new Error('Recovery session missing');
          if (isMounted) {
            sessionRef.current = sessionData.session;
            setSession(sessionData.session);
          }
        }

        if (isMounted) setPasswordRecoveryPending(true);
      } catch {
        if (isMounted) {
          setError('Der Link zum Zurücksetzen ist ungültig oder abgelaufen. Fordere einen neuen Link an.');
        }
      }
    };
    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      void handleAuthUrl(url);
    });

    const restore = async () => {
      safeDebug('[BOOT] Auth-Wiederherstellung gestartet.');

      // Phase 1 – nur lokale Daten. Jeder Schritt settelt garantiert
      // (Timeout + Fallback), danach ist der App-Start freigegeben.
      try {
        const storedProfile = await settleBootStep('Lokales Profil laden', readLocalProfile(), null);
        if (isMounted) setLocalProfile(storedProfile);
        safeDebug('[BOOT] Lokales Profil wiederhergestellt.');
      } finally {
        if (isMounted) {
          setHydrated(true);
          setPendingAction(null);
        }
      }

      // Phase 2 – Hintergrund: bestehende Supabase-Session und Auth-Deep-Links.
      // Fehler, Timeouts oder fehlende Konfiguration lassen den Gastmodus unberührt.
      if (supabase) {
        const sessionResult = await settleBootStep(
          'Supabase-Session wiederherstellen',
          supabase.auth.getSession(),
          null,
        );
        if (!isMounted) return;
        if (sessionResult && !sessionResult.error && sessionResult.data.session) {
          sessionRef.current = sessionResult.data.session;
          setSession(sessionResult.data.session);
        }
        safeDebug('[BOOT] Online-Sitzung wiederhergestellt.');
      }

      const initialUrl = await settleBootStep('Start-URL lesen', Linking.getInitialURL(), null);
      if (!isMounted) return;
      await handleAuthUrl(initialUrl);
    };

    void restore();

    return () => {
      isMounted = false;
      authSubscription?.unsubscribe();
      linkSubscription.remove();
    };
  }, []);

  const clearFeedback = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const configurationFailure = useCallback((): AuthActionResult => {
    const message = 'Online-Konten sind derzeit nicht verfügbar.';
    setError(message);
    setNotice(null);
    return { ok: false, message };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthActionResult> => {
    if (!supabase) return configurationFailure();

    setPendingAction('sign-in');
    setError(null);
    setNotice(null);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) throw signInError;

      if (!data.session) {
        const message = 'Die Anmeldung hat keine gültige Sitzung zurückgegeben. Bitte versuche es erneut.';
        setError(message);
        return { ok: false, message };
      }

      sessionRef.current = data.session;
      setSession(data.session);
      const message = 'Du bist jetzt angemeldet.';
      setNotice(message);
      return { ok: true, message, sessionCreated: true };
    } catch (signInError) {
      const message = translateAuthError(signInError);
      setError(message);
      return { ok: false, message };
    } finally {
      setPendingAction(null);
    }
  }, [configurationFailure]);

  const signUp = useCallback(async (input: SignUpInput): Promise<AuthActionResult> => {
    if (!supabase) return configurationFailure();

    if (!input.communityRulesAccepted) {
      const message = 'Bitte stimme den Nutzungsbedingungen und Community-Regeln ausdrücklich zu.';
      setError(message);
      return { ok: false, message };
    }

    setPendingAction('sign-up');
    setError(null);
    setNotice(null);

    try {
      const resolvedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: input.email.trim().toLowerCase(),
        password: input.password,
        options: {
          data: {
            display_name: input.displayName.trim(),
            username: input.username.trim().toLowerCase(),
            time_zone: resolvedTimeZone,
            community_rules_version: '2026-08-02',
            community_rules_accepted_at: new Date().toISOString(),
          },
        },
      });
      if (signUpError) throw signUpError;

      sessionRef.current = data.session;
      setSession(data.session);
      const sessionCreated = Boolean(data.session);
      const message = sessionCreated
        ? 'Dein Konto wurde erstellt und du bist angemeldet.'
        : SIGN_UP_CONFIRMATION_MESSAGE;
      setNotice(message);
      return { ok: true, message, sessionCreated };
    } catch (signUpError) {
      if (['email_exists', 'user_already_exists'].includes(errorCode(signUpError) ?? '')) {
        setNotice(SIGN_UP_CONFIRMATION_MESSAGE);
        return { ok: true, message: SIGN_UP_CONFIRMATION_MESSAGE, sessionCreated: false };
      }
      const message = translateAuthError(signUpError);
      setError(message);
      return { ok: false, message };
    } finally {
      setPendingAction(null);
    }
  }, [configurationFailure]);

  const sendPasswordReset = useCallback(async (email: string): Promise<AuthActionResult> => {
    if (!supabase) return configurationFailure();

    setPendingAction('reset-password');
    setError(null);
    setNotice(null);

    try {
      // PASSWORD_RECOVERY_REDIRECT_URL is derived from the operator domain in
      // config/release-config.cjs. In a production build it is always the
      // verified HTTPS App Link; the private scheme only survives in
      // development and preview builds, which the release gate enforces.
      safeDebug(`[AUTH] Recovery-Callback: ${PASSWORD_RECOVERY_REDIRECT_KIND}`);
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: PASSWORD_RECOVERY_REDIRECT_URL },
      );
      if (resetError) throw resetError;

      const message = 'Falls ein Konto besteht, erhältst du gleich eine E-Mail zum Zurücksetzen.';
      setNotice(message);
      return { ok: true, message };
    } catch {
      // Keep the observable response identical for known and unknown accounts.
      // Dashboard-side Auth limits remain authoritative for abuse prevention.
      const message = 'Falls ein Konto besteht, erhältst du gleich eine E-Mail zum Zurücksetzen.';
      setNotice(message);
      return { ok: true, message };
    } finally {
      setPendingAction(null);
    }
  }, [configurationFailure]);

  const updatePassword = useCallback(async (password: string): Promise<AuthActionResult> => {
    if (!supabase) return configurationFailure();

    setPendingAction('update-password');
    setError(null);
    setNotice(null);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      setPasswordRecoveryPending(false);
      const message = 'Dein neues Passwort wurde gespeichert.';
      setNotice(message);
      return { ok: true, message };
    } catch (updateError) {
      const message = translateAuthError(updateError);
      setError(message);
      return { ok: false, message };
    } finally {
      setPendingAction(null);
    }
  }, [configurationFailure]);

  const signOut = useCallback(async (): Promise<AuthActionResult> => {
    if (!supabase) return configurationFailure();

    setPendingAction('sign-out');
    setError(null);
    setNotice(null);

    try {
      const { error: globalSignOutError } = await supabase.auth.signOut();
      let onlyLocal = false;
      if (globalSignOutError) {
        const { error: localSignOutError } = await supabase.auth.signOut({ scope: 'local' });
        if (localSignOutError) throw localSignOutError;
        onlyLocal = true;
      }

      sessionRef.current = null;
      setSession(null);
      setPasswordRecoveryPending(false);
      const message = onlyLocal
        ? 'Du wurdest auf diesem Gerät abgemeldet. Andere Sitzungen konnten nicht beendet werden.'
        : 'Du wurdest abgemeldet.';
      setNotice(message);
      return { ok: true, message };
    } catch (signOutError) {
      const message = translateAuthError(signOutError);
      setError(message);
      return { ok: false, message };
    } finally {
      setPendingAction(null);
    }
  }, [configurationFailure]);

  const signOutAndClearDeviceData = useCallback(async (): Promise<AuthActionResult> => {
    if (!supabase) return configurationFailure();
    const accountId = session?.user.id;
    if (!accountId) {
      const message = 'Auf diesem Gerät ist kein Online-Konto angemeldet.';
      setError(message);
      return { ok: false, message };
    }

    setPendingAction('sign-out-clear-device');
    setError(null);
    setNotice(null);
    try {
      const { error: globalSignOutError } = await supabase.auth.signOut();
      if (globalSignOutError) {
        const { error: localSignOutError } = await supabase.auth.signOut({ scope: 'local' });
        if (localSignOutError) throw localSignOutError;
      }
      try {
        await supabase.removeAllChannels();
      } catch {
        // The account-scoped storage wipe below remains authoritative locally.
      }
      const browserStorage = typeof globalThis.localStorage === 'undefined'
        ? null
        : globalThis.localStorage;
      const failedKeys = clearAccountLocalData(browserStorage, accountId);
      sessionRef.current = null;
      setSession(null);
      setPasswordRecoveryPending(false);
      const message = failedKeys.length > 0
        ? 'Du wurdest abgemeldet. Einige Kontodaten konnten auf diesem Gerät nicht vollständig entfernt werden.'
        : 'Du wurdest abgemeldet und die lokalen Daten dieses Kontos wurden von diesem Gerät entfernt.';
      if (failedKeys.length > 0) setError(message);
      else setNotice(message);
      return { ok: failedKeys.length === 0, message };
    } catch (signOutError) {
      const message = translateAuthError(signOutError);
      setError(message);
      return { ok: false, message };
    } finally {
      setPendingAction(null);
    }
  }, [configurationFailure, session]);

  const deleteAccount = useCallback(async (password: string): Promise<AuthActionResult> => {
    if (!supabase) return configurationFailure();
    const activeSession = session;
    if (!activeSession?.access_token || !activeSession.user.id || !activeSession.user.email) {
      const message = 'Für die Kontolöschung musst du mit einem Online-Konto angemeldet sein.';
      setError(message);
      setNotice(null);
      return { ok: false, message };
    }

    setPendingAction('delete-account');
    setError(null);
    setNotice(null);

    try {
      const { data: reauthenticated, error: reauthenticationError } = await supabase.auth
        .signInWithPassword({ email: activeSession.user.email, password });
      if (reauthenticationError || !reauthenticated.session) {
        const message = 'Die Identitätsbestätigung ist fehlgeschlagen. Prüfe dein Passwort.';
        setError(message);
        return { ok: false, message };
      }
      if (reauthenticated.session.user.id !== activeSession.user.id) {
        await supabase.auth.setSession({
          access_token: activeSession.access_token,
          refresh_token: activeSession.refresh_token,
        });
        const message = 'Die Identitätsbestätigung konnte nicht sicher abgeschlossen werden.';
        setError(message);
        return { ok: false, message };
      }
      sessionRef.current = reauthenticated.session;
      setSession(reauthenticated.session);
      await requestOnlineAccountDeletion(supabase, reauthenticated.session.access_token);

      const browserStorage = typeof globalThis.localStorage === 'undefined'
        ? null
        : globalThis.localStorage;
      const failedKeys = clearAccountLocalData(browserStorage, activeSession.user.id);
      let localCleanupIncomplete = failedKeys.length > 0;

      try {
        await authStorage.removeItem(LOCAL_PROFILE_STORAGE_KEY);
      } catch {
        localCleanupIncomplete = true;
      }
      try {
        await supabase.removeAllChannels();
      } catch {
        // Repository disposal repeats channel cleanup when the provider remounts.
      }
      try {
        const { error: localSignOutError } = await supabase.auth.signOut({ scope: 'local' });
        if (localSignOutError) throw localSignOutError;
      } catch {
        // The server-side user no longer exists. Local React state is still
        // cleared below; Supabase's local sign-out is a best-effort storage wipe.
        localCleanupIncomplete = true;
      }

      sessionRef.current = null;
      setSession(null);
      setLocalProfile(null);
      setPasswordRecoveryPending(false);
      const message = localCleanupIncomplete
        ? 'Dein Online-Konto wurde gelöscht. Einige lokale Anmeldedaten konnten nicht bestätigt bereinigt werden; lösche bei Bedarf die App-Daten in den Geräteeinstellungen.'
        : 'Dein Online-Konto und die zugehörigen Daten wurden dauerhaft gelöscht. Du nutzt Lernzeit jetzt als Gast.';
      setNotice(message);
      return { ok: true, message };
    } catch (deletionError) {
      const candidate = errorMessage(deletionError);
      const message = candidate?.startsWith('Deine Anmeldung ist abgelaufen')
        || candidate?.startsWith('Das Online-Konto konnte')
        || candidate?.startsWith('Für die Kontolöschung fehlt')
        || candidate?.startsWith('Bitte bestätige deine Identität')
        ? candidate
        : 'Das Online-Konto konnte nicht gelöscht werden. Bitte versuche es später erneut.';
      setError(message);
      return { ok: false, message };
    } finally {
      setPendingAction(null);
    }
  }, [configurationFailure, session]);

  const saveLocalProfile = useCallback(async (input: LocalProfileInput): Promise<AuthActionResult> => {
    const validationMessage =
      displayNameError(input.displayName) ??
      usernameError(input.username) ??
      avatarUriError(input.avatarUri ?? '');
    if (validationMessage) {
      setError(validationMessage);
      setNotice(null);
      return { ok: false, message: validationMessage };
    }

    setPendingAction('save-local-profile');
    setError(null);
    setNotice(null);

    try {
      const now = new Date().toISOString();
      const profile: LocalProfile = {
        schemaVersion: 1,
        displayName: input.displayName.trim(),
        username: input.username.trim().toLowerCase(),
        avatarUri: input.avatarUri?.trim() || undefined,
        createdAt: localProfile?.createdAt ?? now,
        updatedAt: now,
      };

      await authStorage.setItem(LOCAL_PROFILE_STORAGE_KEY, JSON.stringify(profile));
      setLocalProfile(profile);
      const message = 'Dein lokales Profil wurde auf diesem Gerät gespeichert.';
      setNotice(message);
      return { ok: true, message };
    } catch {
      const message = 'Das lokale Profil konnte nicht gespeichert werden.';
      setError(message);
      return { ok: false, message };
    } finally {
      setPendingAction(null);
    }
  }, [localProfile]);

  const removeLocalProfile = useCallback(async (): Promise<AuthActionResult> => {
    setPendingAction('remove-local-profile');
    setError(null);
    setNotice(null);

    try {
      await authStorage.removeItem(LOCAL_PROFILE_STORAGE_KEY);
      setLocalProfile(null);
      const message = 'Das lokale Profil wurde von diesem Gerät entfernt.';
      setNotice(message);
      return { ok: true, message };
    } catch {
      const message = 'Das lokale Profil konnte nicht entfernt werden.';
      setError(message);
      return { ok: false, message };
    } finally {
      setPendingAction(null);
    }
  }, []);

  const value = useMemo<AuthStoreValue>(() => {
    const activeMode: ActiveAuthMode = session ? 'supabase' : localProfile ? 'local' : 'none';

    return {
      hydrated,
      loading: pendingAction !== null,
      pendingAction,
      session,
      user: session?.user ?? null,
      localProfile,
      passwordRecoveryPending,
      activeMode,
      error,
      notice,
      configuration: supabaseConfiguration,
      signIn,
      signUp,
      sendPasswordReset,
      updatePassword,
      signOut,
      signOutAndClearDeviceData,
      deleteAccount,
      saveLocalProfile,
      removeLocalProfile,
      clearFeedback,
    };
  }, [
    clearFeedback,
    error,
    hydrated,
    localProfile,
    notice,
    pendingAction,
    passwordRecoveryPending,
    removeLocalProfile,
    saveLocalProfile,
    sendPasswordReset,
    session,
    signIn,
    signOut,
    signOutAndClearDeviceData,
    deleteAccount,
    signUp,
    updatePassword,
  ]);

  return <AuthStoreContext value={value}>{children}</AuthStoreContext>;
}

export function useAuthStore(): AuthStoreValue {
  const context = use(AuthStoreContext);
  if (!context) throw new Error('useAuthStore must be used inside AuthStoreProvider');
  return context;
}
