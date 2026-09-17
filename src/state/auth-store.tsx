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
import { ONLINE_BACKEND_REQUIRED } from '@/auth/backend-policy';
import { clearAccountLocalData } from '@/auth/account-local-cleanup';
import { authStorage } from '@/auth/storage';
import { EMAIL_CONFIRMATION_REDIRECT_URL, isEmailCallbackRoute, parseEmailCallback } from '@/auth/email-callback';
import {
  hasPasswordRecoveryMaterial,
  parsePasswordRecoveryUrl,
  PASSWORD_RECOVERY_AVAILABLE,
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
import { cleanupStaleAccountDataExports } from '@/lib/account-data-export';
import { withTimeout } from '@/lib/with-timeout';
import { safeDebug, safeWarning } from '@/lib/safe-logger';

const LOCAL_PROFILE_STORAGE_KEY = 'lernzeit.local-profile.v1';
const PASSWORD_RECOVERY_CAPABILITY_KEY = 'lernzeit.password-recovery-capability.v1';
const PASSWORD_RECOVERY_CAPABILITY_MAX_AGE_SECONDS = 15 * 60;
const SIGN_UP_CONFIRMATION_MESSAGE =
  'Falls die Angaben verwendet werden können, erhältst du gleich eine E-Mail zur Bestätigung.';
const BOOT_STEP_TIMEOUT_MS = 4000;

interface PasswordRecoveryCapability {
  schemaVersion: 1;
  userId: string;
  linkFingerprint: string;
  createdAtEpochSeconds: number;
  expiresAtEpochSeconds: number;
}

function createPasswordRecoveryCapability(
  session: Session,
  linkFingerprint: string,
  nowEpochSeconds = Math.floor(Date.now() / 1000),
): PasswordRecoveryCapability {
  const sessionExpiry = typeof session.expires_at === 'number'
    ? session.expires_at
    : nowEpochSeconds + PASSWORD_RECOVERY_CAPABILITY_MAX_AGE_SECONDS;
  return {
    schemaVersion: 1,
    userId: session.user.id,
    linkFingerprint,
    createdAtEpochSeconds: nowEpochSeconds,
    expiresAtEpochSeconds: Math.min(
      sessionExpiry,
      nowEpochSeconds + PASSWORD_RECOVERY_CAPABILITY_MAX_AGE_SECONDS,
    ),
  };
}

function parsePasswordRecoveryCapability(
  rawValue: string | null,
  session: Session,
  nowEpochSeconds = Math.floor(Date.now() / 1000),
): PasswordRecoveryCapability | null {
  if (!rawValue) return null;
  try {
    const candidate = JSON.parse(rawValue) as Partial<PasswordRecoveryCapability>;
    const createdAt = candidate.createdAtEpochSeconds;
    const expiresAt = candidate.expiresAtEpochSeconds;
    if (
      candidate.schemaVersion !== 1
      || candidate.userId !== session.user.id
      || typeof candidate.linkFingerprint !== 'string'
      || !/^pkce:[0-9a-f]{8}:[1-9][0-9]{0,5}$/.test(candidate.linkFingerprint)
      || typeof createdAt !== 'number'
      || !Number.isSafeInteger(createdAt)
      || typeof expiresAt !== 'number'
      || !Number.isSafeInteger(expiresAt)
    ) return null;
    if (
      createdAt > nowEpochSeconds + 60
      || nowEpochSeconds > expiresAt
      || expiresAt <= createdAt
      || expiresAt - createdAt > PASSWORD_RECOVERY_CAPABILITY_MAX_AGE_SECONDS
      || (typeof session.expires_at === 'number' && expiresAt > session.expires_at)
    ) return null;
    return {
      schemaVersion: 1,
      userId: candidate.userId,
      linkFingerprint: candidate.linkFingerprint,
      createdAtEpochSeconds: createdAt,
      expiresAtEpochSeconds: expiresAt,
    };
  } catch {
    return null;
  }
}

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
  emailCallbackPending: boolean;
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
    displayNameError(candidate.displayName) === undefined &&
    typeof candidate.username === 'string' &&
    usernameError(candidate.username) === undefined &&
    (candidate.avatarUri === undefined || (
      typeof candidate.avatarUri === 'string'
      && avatarUriError(candidate.avatarUri) === undefined
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
  const processedEmailLinksRef = useRef(new Set<string>());
  const [emailCallbackPending, setEmailCallbackPending] = useState(false);
  const passwordRecoveryCapabilityRef = useRef<PasswordRecoveryCapability | null>(null);
  const passwordRecoveryExpiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passwordRecoveryStorageGenerationRef = useRef(0);
  const [localProfile, setLocalProfile] = useState<LocalProfile | null>(null);
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<AuthPendingAction | null>('restore');
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const clearPasswordRecoveryCapability = useCallback(async () => {
    passwordRecoveryStorageGenerationRef.current += 1;
    if (passwordRecoveryExpiryTimerRef.current) {
      clearTimeout(passwordRecoveryExpiryTimerRef.current);
      passwordRecoveryExpiryTimerRef.current = null;
    }
    passwordRecoveryCapabilityRef.current = null;
    setPasswordRecoveryPending(false);
    try {
      await authStorage.removeItem(PASSWORD_RECOVERY_CAPABILITY_KEY);
    } catch {
      safeWarning('Die lokale Passwort-Reset-Berechtigung konnte nicht sicher entfernt werden.');
    }
  }, []);

  const activatePasswordRecoveryCapability = useCallback((capability: PasswordRecoveryCapability) => {
    if (passwordRecoveryExpiryTimerRef.current) {
      clearTimeout(passwordRecoveryExpiryTimerRef.current);
    }
    passwordRecoveryCapabilityRef.current = capability;
    setPasswordRecoveryPending(true);
    const remainingMs = Math.max(0, capability.expiresAtEpochSeconds * 1000 - Date.now());
    passwordRecoveryExpiryTimerRef.current = setTimeout(() => {
      void clearPasswordRecoveryCapability();
    }, remainingMs);
  }, [clearPasswordRecoveryCapability]);

  useEffect(() => {
    let isMounted = true;
    const authSubscription = supabase?.auth.onAuthStateChange((event, nextSession) => {
      if (!isMounted) return;
      sessionRef.current = nextSession;
      setSession(nextSession);
      const capability = passwordRecoveryCapabilityRef.current;
      if (
        event === 'SIGNED_OUT'
        || !nextSession
        || (capability && capability.userId !== nextSession.user.id)
      ) void clearPasswordRecoveryCapability();
    }).data.subscription;

    const handleAuthUrl = async (url: string | null) => {
      if (!url || !supabase || !isMounted) return;
      if (isEmailCallbackRoute(url)) {
        setEmailCallbackPending(true);
        setError(null);
        setNotice(null);
        try {
          const request = parseEmailCallback(url);
          if (!request) throw new Error('Invalid confirmation callback');
          const fingerprint = passwordRecoveryRequestFingerprint({ kind: 'pkce', code: request.code });
          if (processedEmailLinksRef.current.has(fingerprint)) return;
          const { data: current, error: currentError } = await supabase.auth.getSession();
          if (currentError) throw currentError;
          if (!isMounted) return;
          if (current.session || sessionRef.current) {
            setNotice('Du bist bereits angemeldet. Für ein anderes Konto melde dich zuerst ab.');
            return;
          }
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(
            request.code, request.flowId ? { flowId: request.flowId } : undefined,
          );
          if (exchangeError || !data.session) throw exchangeError ?? new Error('Session missing');
          if (!isMounted) return;
          sessionRef.current = data.session;
          setSession(data.session);
          await clearPasswordRecoveryCapability();
          processedEmailLinksRef.current.add(fingerprint);
          setNotice('Deine E-Mail-Adresse ist bestätigt. Du bist angemeldet.');
        } catch {
          if (isMounted) setError('Der Bestätigungslink konnte nicht zur Anmeldung verwendet werden. Wenn deine E-Mail bereits bestätigt ist, melde dich mit deinem Passwort an. Öffne neue Bestätigungslinks auf dem Gerät, auf dem du dich registriert hast.');
        } finally {
          if (isMounted) setEmailCallbackPending(false);
        }
        return;
      }
      const recovery = parsePasswordRecoveryUrl(url);
      if (!recovery) {
        if (hasPasswordRecoveryMaterial(url)) {
          setError('Der Link zum Zurücksetzen ist ungültig oder abgelaufen. Fordere einen neuen Link an.');
        }
        return;
      }
      const fingerprint = passwordRecoveryRequestFingerprint(recovery);
      if (processedRecoveryLinksRef.current.has(fingerprint)) {
        const capability = passwordRecoveryCapabilityRef.current;
        const activeSession = sessionRef.current;
        const liveCapability = capability && activeSession
          ? parsePasswordRecoveryCapability(JSON.stringify(capability), activeSession)
          : null;
        if (liveCapability?.linkFingerprint === fingerprint) {
          activatePasswordRecoveryCapability(liveCapability);
          return;
        }
        await clearPasswordRecoveryCapability();
        setError('Dieser Link zum Zurücksetzen ist abgelaufen. Fordere einen neuen Link an.');
        return;
      }
      // Reserve before the first await. The queue below serialises distinct
      // callbacks; this reservation additionally makes exact replays explicit.
      // Failed/preflight attempts release it so a transient network failure can
      // safely retry the same one-time PKCE code.
      processedRecoveryLinksRef.current.add(fingerprint);
      try {
        let activeSession = sessionRef.current;
        if (!activeSession) {
          const { data: currentSessionData, error: currentSessionError } = await supabase.auth
            .getSession();
          if (!isMounted) {
            processedRecoveryLinksRef.current.delete(fingerprint);
            return;
          }
          if (currentSessionError) {
            processedRecoveryLinksRef.current.delete(fingerprint);
            setError('Der Link zum Zurücksetzen konnte nicht sicher geprüft werden. Versuche es später erneut.');
            return;
          }
          activeSession = currentSessionData.session;
          if (activeSession) {
            sessionRef.current = activeSession;
            setSession(activeSession);
          }
        }
        if (activeSession?.user.id || sessionRef.current?.user.id) {
          processedRecoveryLinksRef.current.delete(fingerprint);
          setError('Melde dich zuerst ab, bevor du einen Link zum Zurücksetzen verwendest.');
          return;
        }

        const { data: exchangeData, error: exchangeError } = await supabase.auth
          .exchangeCodeForSession(recovery.code, recovery.flowId ? { flowId: recovery.flowId } : undefined);
        if (exchangeError) throw exchangeError;
        if (!exchangeData.session) throw new Error('Recovery session missing');
        if (!isMounted) {
          processedRecoveryLinksRef.current.delete(fingerprint);
          return;
        }
        sessionRef.current = exchangeData.session;
        setSession(exchangeData.session);

        const capability = createPasswordRecoveryCapability(exchangeData.session, fingerprint);
        const storageGeneration = passwordRecoveryStorageGenerationRef.current + 1;
        passwordRecoveryStorageGenerationRef.current = storageGeneration;
        let capabilityStored = false;
        try {
          await authStorage.setItem(
            PASSWORD_RECOVERY_CAPABILITY_KEY,
            JSON.stringify(capability),
          );
          capabilityStored = true;
        } catch {
          safeWarning('Die Passwort-Reset-Berechtigung konnte nicht dauerhaft gespeichert werden.');
        }
        if (
          !isMounted
          || passwordRecoveryStorageGenerationRef.current !== storageGeneration
        ) {
          if (capabilityStored) {
            try {
              await authStorage.removeItem(PASSWORD_RECOVERY_CAPABILITY_KEY);
            } catch {
              safeWarning('Die lokale Passwort-Reset-Berechtigung konnte nicht sicher entfernt werden.');
            }
          }
          return;
        }
        activatePasswordRecoveryCapability(capability);
      } catch {
        processedRecoveryLinksRef.current.delete(fingerprint);
        if (isMounted) {
          setError('Der Link zum Zurücksetzen ist ungültig oder abgelaufen. Fordere einen neuen Link an.');
        }
      }
    };
    let recoveryQueue: Promise<void> = Promise.resolve();
    const enqueueAuthUrl = (url: string | null): Promise<void> => {
      if (isEmailCallbackRoute(url)) setEmailCallbackPending(true);
      const current = recoveryQueue.then(() => handleAuthUrl(url));
      recoveryQueue = current.catch(() => undefined);
      return current;
    };
    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      void enqueueAuthUrl(url);
    });

    const restore = async () => {
      safeDebug('[BOOT] Auth-Wiederherstellung gestartet.');

      // A process kill during the system share sheet can leave a plaintext
      // account export in cache. Retry its narrowly scoped removal on every
      // start, even if the user never opens the export action again.
      try {
        cleanupStaleAccountDataExports();
      } catch {
        safeWarning('[BOOT] Eine alte temporäre Exportdatei konnte nicht entfernt werden.');
      }

      // Phase 1 – nur lokale Daten. Jeder Schritt settelt garantiert
      // (Timeout + Fallback), danach ist der App-Start freigegeben.
      try {
        const storedProfile = ONLINE_BACKEND_REQUIRED
          ? null
          : await settleBootStep('Lokales Profil laden', readLocalProfile(), null);
        if (isMounted) setLocalProfile(storedProfile);
        safeDebug('[BOOT] Lokales Profil wiederhergestellt.');
      } finally {
        if (isMounted && !ONLINE_BACKEND_REQUIRED) {
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
          const rawCapability = await settleBootStep(
            'Passwort-Reset-Berechtigung laden',
            authStorage.getItem(PASSWORD_RECOVERY_CAPABILITY_KEY),
            null,
          );
          const capability = parsePasswordRecoveryCapability(
            rawCapability,
            sessionResult.data.session,
          );
          if (capability) {
            processedRecoveryLinksRef.current.add(capability.linkFingerprint);
            activatePasswordRecoveryCapability(capability);
          } else if (rawCapability) {
            await clearPasswordRecoveryCapability();
          }
        }
        safeDebug('[BOOT] Online-Sitzung wiederhergestellt.');
      }

      const initialUrl = await settleBootStep('Start-URL lesen', Linking.getInitialURL(), null);
      if (!isMounted) return;
      await enqueueAuthUrl(initialUrl);
      if (isMounted && ONLINE_BACKEND_REQUIRED) {
        setHydrated(true);
        setPendingAction(null);
      }
    };

    void restore();

    return () => {
      isMounted = false;
      passwordRecoveryStorageGenerationRef.current += 1;
      if (passwordRecoveryExpiryTimerRef.current) {
        clearTimeout(passwordRecoveryExpiryTimerRef.current);
        passwordRecoveryExpiryTimerRef.current = null;
      }
      authSubscription?.unsubscribe();
      linkSubscription.remove();
    };
  }, [activatePasswordRecoveryCapability, clearPasswordRecoveryCapability]);

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
      await clearPasswordRecoveryCapability();
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
  }, [clearPasswordRecoveryCapability, configurationFailure]);

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
          emailRedirectTo: EMAIL_CONFIRMATION_REDIRECT_URL,
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
      await clearPasswordRecoveryCapability();
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
  }, [clearPasswordRecoveryCapability, configurationFailure]);

  const sendPasswordReset = useCallback(async (email: string): Promise<AuthActionResult> => {
    if (!supabase) return configurationFailure();
    // Manifest and bundle disagree about the recovery transport. Sending a mail
    // whose callback the app will then refuse - or worse, whose transport the
    // manifest routes somewhere else - is not something to attempt.
    if (!PASSWORD_RECOVERY_AVAILABLE) {
      const message = 'Das Zurücksetzen des Passworts ist in dieser App-Version nicht verfügbar.';
      setError(message);
      setNotice(null);
      return { ok: false, message };
    }

    setPendingAction('reset-password');
    setError(null);
    setNotice(null);

    try {
      // PASSWORD_RECOVERY_REDIRECT_URL comes from config/auth-build.cjs, the
      // same module app.config.js uses for the intent filters. In a production
      // build it is always the verified HTTPS App Link: the private scheme only
      // survives in development and preview builds, because
      // collectRecoveryReleaseIssues turns that fallback into a release blocker.
      //
      // Deliberately not logged. The value is harmless ("https-app-link" or
      // "custom-scheme"), but logging anything read from a PASSWORD_* constant
      // trips CodeQL's clear-text-logging rule, and a debug breadcrumb is not
      // worth an exception. The resolved callback is visible in the release
      // gate output, in `expo config` (extra.passwordRecoveryRedirect) and in
      // the export scan instead.
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
    const activeSession = sessionRef.current;
    const capability = activeSession && passwordRecoveryCapabilityRef.current
      ? parsePasswordRecoveryCapability(
        JSON.stringify(passwordRecoveryCapabilityRef.current),
        activeSession,
      )
      : null;
    if (!passwordRecoveryPending || !activeSession?.user.id || !capability) {
      await clearPasswordRecoveryCapability();
      const message = 'Öffne zuerst den aktuellen Link aus deiner Reset-E-Mail auf diesem Gerät.';
      setError(message);
      setNotice(null);
      return { ok: false, message };
    }

    setPendingAction('update-password');
    setError(null);
    setNotice(null);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      await clearPasswordRecoveryCapability();
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
  }, [clearPasswordRecoveryCapability, configurationFailure, passwordRecoveryPending]);

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
      await clearPasswordRecoveryCapability();
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
  }, [clearPasswordRecoveryCapability, configurationFailure]);

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
      await clearPasswordRecoveryCapability();
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
  }, [clearPasswordRecoveryCapability, configurationFailure, session]);

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
        const { data: restoredData, error: restoreError } = await supabase.auth.setSession({
          access_token: activeSession.access_token,
          refresh_token: activeSession.refresh_token,
        });
        if (restoreError || restoredData.session?.user.id !== activeSession.user.id) {
          try {
            await supabase.removeAllChannels();
          } catch {
            // In-memory auth state is cleared below even if channel cleanup fails.
          }
          try {
            await supabase.auth.signOut({ scope: 'local' });
          } catch {
            // The mismatched session must never remain authoritative in React.
          }
          sessionRef.current = null;
          setSession(null);
          await clearPasswordRecoveryCapability();
        } else {
          sessionRef.current = restoredData.session;
          setSession(restoredData.session);
        }
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
      await clearPasswordRecoveryCapability();
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
  }, [clearPasswordRecoveryCapability, configurationFailure, session]);

  const saveLocalProfile = useCallback(async (input: LocalProfileInput): Promise<AuthActionResult> => {
    if (ONLINE_BACKEND_REQUIRED) {
      return { ok: false, message: 'Diese App-Version benötigt ein Online-Konto.' };
    }
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
      emailCallbackPending,
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
    emailCallbackPending,
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
