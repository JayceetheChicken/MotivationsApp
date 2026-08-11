import {
  avatarUriError,
  displayNameError,
  emailError,
  passwordError,
  usernameError,
} from '@/auth/validation';

describe('password validation', () => {
  it('requires at least ten characters for new passwords', () => {
    expect(passwordError('123456789', true)).toBe(
      'Das Passwort muss mindestens 10 Zeichen lang sein.',
    );
    expect(passwordError('1234567890', true)).toBeUndefined();
  });

  it('does not apply the creation rule while validating an existing login secret', () => {
    expect(passwordError('short', false)).toBeUndefined();
  });

  it('enforces the Supabase Auth 72-byte password ceiling', () => {
    const lock = '\u{1F512}';
    expect(passwordError('a'.repeat(72))).toBeUndefined();
    expect(passwordError('a'.repeat(73))).toMatch(/72 UTF-8-Bytes/);
    expect(passwordError(lock.repeat(18))).toBeUndefined();
    expect(passwordError(lock.repeat(19))).toMatch(/72 UTF-8-Bytes/);
  });
});

describe('auth input bounds', () => {
  it('accepts ordinary international display names and bounded account fields', () => {
    expect(displayNameError('Mia Müller')).toBeUndefined();
    expect(displayNameError('لينا علي')).toBeUndefined();
    expect(emailError('person@example.org')).toBeUndefined();
    expect(usernameError('mia_2026')).toBeUndefined();
  });

  it.each([
    'Mia\u0000Admin',
    'Mia\nAdmin',
    'Mia\u202EAdmin',
    'Mia\u2066Admin',
  ])('rejects control or bidi formatting characters in a display name', (value) => {
    expect(displayNameError(value)).toMatch(/Steuer- oder Richtungszeichen/);
  });

  it('bounds email input and rejects invisible direction controls', () => {
    expect(emailError(`${'a'.repeat(245)}@example.org`)).toMatch(/zu lang/);
    expect(emailError('person\u202E@example.org')).toMatch(/Steuerzeichen/);
  });

  it('accepts picker URI schemes but bounds and canonicalizes their security-sensitive parts', () => {
    expect(avatarUriError('file:///cache/avatar.jpg')).toBeUndefined();
    expect(avatarUriError('content://media/images/42')).toBeUndefined();
    expect(avatarUriError('https://images.example/avatar.jpg')).toBeUndefined();
    expect(avatarUriError(`https://images.example/${'a'.repeat(4096)}`)).toMatch(/zu lang/);
    expect(avatarUriError('https://user:password@images.example/avatar.jpg')).toMatch(/Zugangsdaten/);
    expect(avatarUriError('file:///cache/avatar.jpg#other')).toMatch(/Fragmente/);
    expect(avatarUriError('file:///cache/avatar.jpg\n')).toMatch(/Steuerzeichen/);
  });
});
