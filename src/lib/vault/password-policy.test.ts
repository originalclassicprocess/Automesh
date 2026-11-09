import { describe, expect, it, vi } from 'vitest';
import { generatePassword, passwordPolicyError } from './password-policy';
import { passwordStrength } from './password-strength';

describe('new password policy and local generation', () => {
  it('requires 10 Unicode code points, does not trim and bounds new passwords', () => {
    expect(passwordPolicyError('123456789')).not.toBeNull();
    expect(passwordPolicyError('1234567890')).toBeNull();
    expect(passwordPolicyError('😀'.repeat(5))).not.toBeNull();
    expect(passwordPolicyError('😀'.repeat(10))).toBeNull();
    expect(passwordPolicyError(' '.repeat(20))).not.toBeNull();
    expect(passwordPolicyError(' abcdefgh ')).toBeNull();
    expect(passwordPolicyError('a'.repeat(257))).not.toBeNull();
  });
  it('generates exactly 24 characters from cryptographic randomness and clears the byte buffer', () => {
    let bytes: Uint8Array | undefined;
    const random = vi.spyOn(crypto, 'getRandomValues').mockImplementation(array => {
      bytes = array as Uint8Array; bytes.set(Array.from({ length: 24 }, (_, i) => i * 7)); return array;
    });
    try {
      const value = generatePassword();
      expect(value).toHaveLength(24); expect(value).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(value).toMatch(/[0-9]/); expect(value).toMatch(/[A-Za-z]/);
      expect(random).toHaveBeenCalledTimes(1); expect(bytes!.every(byte => byte === 0)).toBe(true);
      expect(passwordPolicyError(value)).toBeNull();
    } finally { random.mockRestore(); }
  });
  it('fails closed when secure randomness is unavailable', () => {
    const random = vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => { throw new Error('unavailable'); });
    try { expect(() => generatePassword()).toThrow('unavailable'); } finally { random.mockRestore(); }
  });
  it('rejects candidates without letters or digits rather than forcing a predictable digit position', () => {
    const random = vi.spyOn(crypto, 'getRandomValues')
      .mockImplementationOnce(array => { (array as Uint8Array).fill(0); return array; })
      .mockImplementationOnce(array => { (array as Uint8Array).fill(52); return array; })
      .mockImplementationOnce(array => { (array as Uint8Array).fill(0); (array as Uint8Array)[7] = 52; return array; });
    try {
      const value = generatePassword();
      expect(random).toHaveBeenCalledTimes(3);
      expect(value).toBe('AAAAAAA0AAAAAAAAAAAAAAAA');
    } finally { random.mockRestore(); }
  });
  it('bounds candidate retries and wipes the buffer if randomness produces no acceptable candidate', () => {
    let bytes: Uint8Array | undefined;
    const random = vi.spyOn(crypto, 'getRandomValues').mockImplementation(array => {
      bytes = array as Uint8Array; bytes.fill(1); return array;
    });
    try {
      expect(() => generatePassword()).toThrow('password_randomness_failure');
      expect(random).toHaveBeenCalledTimes(32); expect(bytes!.every(byte => byte === 0)).toBe(true);
    } finally { random.mockRestore(); }
  });
  it('recognizes common passwords, repetition and sequences rather than counting character classes', async () => {
    for (const value of ['Password123!', '12345678901234567890', 'a'.repeat(24)])
      expect((await passwordStrength(value)).score).toBeLessThan(3);
    expect((await passwordStrength('f7T_Ub9-cR4pN2X_vH8sLm3Q')).score).toBe(4);
  });
  it('uses the nickname as guessing context without retaining it in a shared dictionary', async () => {
    const value = 'CobaltHarborWorks';
    expect((await passwordStrength(value, value)).score).toBeLessThan(2);
    expect((await passwordStrength(value)).score).toBeGreaterThan(1);
  });
  it('switches feedback language without changing password scoring',async()=>{
    const ru=await passwordStrength('password','','ru'),en=await passwordStrength('password','','en');
    expect(en.score).toBe(ru.score);expect(en.warning+en.suggestions.join(' ')).not.toMatch(/[А-Яа-яЁё]/);
    expect(ru.warning+ru.suggestions.join(' ')).toMatch(/[А-Яа-яЁё]/);
  });
  it('clears estimator scoring state after both successful and failed checks', async () => {
    const { ZxcvbnFactory } = await import('@zxcvbn-ts/core');
    const original = ZxcvbnFactory.prototype.check;
    const check = vi.spyOn(ZxcvbnFactory.prototype, 'check');
    try {
      await passwordStrength('public-test-password');
      expect(check).toHaveBeenLastCalledWith('', []);
      check.mockImplementationOnce(function (this: InstanceType<typeof ZxcvbnFactory>, password, inputs) {
        original.call(this, password, inputs);
        throw new Error('test_estimation_failure');
      });
      await expect(passwordStrength('public-test-password')).rejects.toThrow('test_estimation_failure');
      expect(check).toHaveBeenLastCalledWith('', []);
    } finally { check.mockRestore(); }
  });
});
