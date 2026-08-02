import { passwordError } from '@/auth/validation';

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
});
