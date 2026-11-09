// Test-only portable stand-in; never imported by the shipped node entry.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
export function testProtector() {
  const key = randomBytes(32);
  return {
    protection: 'test-only-aes-gcm',
    async protect(bytes, purpose) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(purpose));
      return Buffer.concat([iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]).toString('base64');
    },
    async unprotect(value, purpose) {
      const raw = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      cipher.setAAD(Buffer.from(purpose)); cipher.setAuthTag(raw.subarray(-16));
      return Buffer.concat([cipher.update(raw.subarray(12, -16)), cipher.final()]);
    },
  };
}
