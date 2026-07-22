export function emailError(value: string): string | undefined {
  const email = value.trim();

  if (!email) return 'Bitte gib deine E-Mail-Adresse ein.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Bitte gib eine gültige E-Mail-Adresse ein.';
  }

  return undefined;
}

export function passwordError(value: string, requireStrength = false): string | undefined {
  if (!value) return 'Bitte gib dein Passwort ein.';
  if (requireStrength && value.length < 8) {
    return 'Das Passwort muss mindestens 8 Zeichen lang sein.';
  }

  return undefined;
}

export function displayNameError(value: string): string | undefined {
  const displayName = value.trim();

  if (displayName.length < 2) return 'Der Anzeigename muss mindestens 2 Zeichen haben.';
  if (displayName.length > 50) return 'Der Anzeigename darf höchstens 50 Zeichen haben.';
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
  } catch {
    return 'Bitte wähle eine gültige Bilddatei aus.';
  }

  return undefined;
}
