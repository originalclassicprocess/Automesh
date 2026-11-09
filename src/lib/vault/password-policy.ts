export const MIN_NEW_PASSWORD_LENGTH = 10;
export const MAX_NEW_PASSWORD_LENGTH = 256;
export const GENERATED_PASSWORD_LENGTH = 24;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Count Unicode code points, not UTF-16 halves. Never trim or normalize passwords.
export function passwordPolicyError(password: string): string | null {
  const length = Array.from(password).length;
  if (length < MIN_NEW_PASSWORD_LENGTH) return 'Пароль: минимум 10 символов.';
  if (length > MAX_NEW_PASSWORD_LENGTH) return 'Пароль: максимум 256 символов.';
  if (!password.trim()) return 'Пароль не должен состоять только из пробелов.';
  return null;
}

export function generatePassword(): string {
  const bytes = new Uint8Array(GENERATED_PASSWORD_LENGTH);
  // 64 equally likely characters: 256 byte values divide evenly, no modulo bias.
  // Reject whole candidates, never force a digit into a predictable position.
  try {
    for (let attempt = 0; attempt < 32; attempt++) {
      crypto.getRandomValues(bytes);
      const candidate = Array.from(bytes, byte => ALPHABET[byte & 63]).join('');
      if (/[A-Za-z]/.test(candidate) && /[0-9]/.test(candidate)) return candidate;
    }
    throw new Error('password_randomness_failure');
  }
  finally { bytes.fill(0); }
}
