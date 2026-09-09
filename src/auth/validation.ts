const UNSAFE_TEXT_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_PASSWORD_BYTES = 72;
const MAX_AVATAR_URI_LENGTH = 4096;

function containsUnsafeTextControl(value: string): boolean {
  return UNSAFE_TEXT_CONTROLS.test(value);
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}

export function emailError(value: string): string | undefined {
  const email = value.trim();

  if (!email) return 'Bitte gib deine E-Mail-Adresse ein.';
  if (email.length > MAX_EMAIL_LENGTH) return 'Die E-Mail-Adresse ist zu lang.';
  if (containsUnsafeTextControl(value)) {
    return 'Die E-Mail-Adresse enthält nicht erlaubte Steuerzeichen.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Bitte gib eine gültige E-Mail-Adresse ein.';
  }

  return undefined;
}

export function passwordError(value: string, requireStrength = false): string | undefined {
  if (!value) return 'Bitte gib dein Passwort ein.';
  if (utf8ByteLength(value) > MAX_PASSWORD_BYTES) {
    return 'Das Passwort darf höchstens 72 UTF-8-Bytes lang sein.';
  }
  if (requireStrength && value.length < 10) {
    return 'Das Passwort muss mindestens 10 Zeichen lang sein.';
  }

  return undefined;
}

export function displayNameError(value: string): string | undefined {
  const displayName = value.trim();

  if (displayName.length < 2) return 'Der Anzeigename muss mindestens 2 Zeichen haben.';
  if (displayName.length > 50) return 'Der Anzeigename darf höchstens 50 Zeichen haben.';
  if (containsUnsafeTextControl(value)) {
    return 'Der Anzeigename enthält nicht erlaubte Steuer- oder Richtungszeichen.';
  }
  return undefined;
}

export function usernameError(value: string): string | undefined {
  const username = value.trim();

  if (username.length < 3) return 'Der Benutzername muss mindestens 3 Zeichen haben.';
  if (username.length > 30) return 'Der Benutzername darf höchstens 30 Zeichen haben.';
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return 'Verwende nur Kleinbuchstaben, Zahlen, Punkt, Unterstrich oder Bindestrich.';
  }

  return undefined;
}

export function avatarUriError(value: string): string | undefined {
  const uri = value.trim();
  if (!uri) return undefined;
  if (uri.length > MAX_AVATAR_URI_LENGTH) return 'Der Bildlink ist zu lang.';
  if (containsUnsafeTextControl(value)) return 'Der Bildlink enthält nicht erlaubte Steuerzeichen.';

  try {
    const parsedUrl = new URL(uri);
    const supportedProtocols = new Set([
      'https:',
      'http:',
      'file:',
      'content:',
      'ph:',
      'assets-library:',
      'blob:',
      'data:',
    ]);
    if (!supportedProtocols.has(parsedUrl.protocol)) {
      return 'Bitte wähle eine Bilddatei aus oder verwende einen vollständigen Bildlink.';
    }
    if (parsedUrl.username || parsedUrl.password || parsedUrl.hash) {
      return 'Der Bildlink darf keine Zugangsdaten oder Fragmente enthalten.';
    }
  } catch {
    return 'Bitte wähle eine gültige Bilddatei aus.';
  }

  return undefined;
}
