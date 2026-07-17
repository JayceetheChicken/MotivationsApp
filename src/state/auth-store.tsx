import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import {
  createContext,
  type PropsWithChildren,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { authStorage } from '@/auth/storage';
import { isPasswordRecoveryUrl } from '@/auth/navigation';
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

const LOCAL_PROFILE_STORAGE_KEY = 'lernzeit.local-profile.v1';
const BOOT_STEP_TIMEOUT_MS = 4000;

/**
 * Boot steps must always settle: a hanging or failing step resolves to its
 * fallback so the app can continue as a guest instead of blocking startup.
 */
async function settleBootStep<T>(label: string, promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await withTimeout(promise, BOOT_STEP_TIMEOUT_MS, label);
  } catch (error) {
    console.warn(`[BOOT] ${label} übersprungen – die App startet als Gast weiter.`, error);
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
    typeof candidate.username === 'string' &&
    candidate.username.trim().length >= 3 &&
    (candidate.avatarUri === undefined || typeof candidate.avatarUri === 'string') &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
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
    email_exists: 'Für diese E-Mail-Adresse besteht bereits ein Konto.',
    email_not_confirmed: 'Bestätige zuerst deine E-Mail-Adresse.',
    invalid_credentials: 'E-Mail-Adresse oder Passwort ist nicht korrekt.',
    over_email_send_rate_limit: 'Zu viele E-Mails in kurzer Zeit. Bitte versuche es später erneut.',
    over_request_rate_limit: 'Zu viele Anfragen in kurzer Zeit. Bitte warte einen Moment.',
    signup_disabled: 'Neue Registrierungen sind für dieses Projekt derzeit deaktiviert.',
    user_already_exists: 'Für diese E-Mail-Adresse besteht bereits ein Konto.',
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
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') setPasswordRecoveryPending(true);
    }).data.subscription;

    const handleAuthUrl = async (url: string | null) => {
      if (!url || !supabase || !isMounted) return;
      try {
        const parsedUrl = new URL(url);
        const fragment = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));
        const isRecovery = isPasswordRecoveryUrl(url);
        const code = parsedUrl.searchParams.get('code');

        if (code) {
          const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          if (isMounted) setSession(exchangeData.session);
        } else {
          const accessToken = fragment.get('access_token');
          const refreshToken = fragment.get('refresh_token');
          if (accessToken && refreshToken) {
            const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (sessionError) throw sessionError;
            if (isMounted) setSession(sessionData.session);
          }
        }

        if (isRecovery && isMounted) setPasswordRecoveryPending(true);
      } catch (linkError) {
        if (isMounted) setError(translateAuthError(linkError));
      }
    };
    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      void handleAuthUrl(url);
    });

    const restore = async () => {
      console.log('[BOOT] Auth restore started');

      // Phase 1 – nur lokale Daten. Jeder Schritt settelt garantiert
      // (Timeout + Fallback), danach ist der App-Start freigegeben.
      try {
        const storedProfile = await settleBootStep('Lokales Profil laden', readLocalProfile(), null);
        if (isMounted) setLocalProfile(storedProfile);
        console.log('[BOOT] Local profile restored');
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
          setSession(sessionResult.data.session);
        }
        console.log('[BOOT] Supabase session restored');
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

    setPendingAction('sign-up');
    setError(null);
    setNotice(null);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: input.email.trim().toLowerCase(),
        password: input.password,
        options: {
          data: {
            display_name: input.displayName.trim(),
            username: input.username.trim().toLowerCase(),
          },
        },
      });
      if (signUpError) throw signUpError;

      setSession(data.session);
      const sessionCreated = Boolean(data.session);
      const message = sessionCreated
        ? 'Dein Konto wurde erstellt und du bist angemeldet.'
        : 'Dein Konto wurde angelegt. Prüfe dein E-Mail-Postfach und bestätige deine Adresse.';
      setNotice(message);
      return { ok: true, message, sessionCreated };
    } catch (signUpError) {
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
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: Linking.createURL('/update-password') },
      );
      if (resetError) throw resetError;

      const message = 'Falls ein Konto besteht, erhältst du gleich eine E-Mail zum Zurücksetzen.';
      setNotice(message);
      return { ok: true, message };
    } catch (resetError) {
      const message = translateAuthError(resetError);
      setError(message);
      return { ok: false, message };
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
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;

      setSession(null);
      setPasswordRecoveryPending(false);
      const message = 'Du wurdest abgemeldet.';
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
