import type { Identity, IdentityProvider } from './identity';
import { buildP256PKCS8 } from './pkcs8';

const curve = { name: 'ECDSA', namedCurve: 'P-256' };
const signatureAlgorithm = { name: 'ECDSA', hash: 'SHA-256' };
const curveOrder = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const toBuffer = (data: Uint8Array) => data.slice().buffer as ArrayBuffer;

export class WebCryptoIdentity implements IdentityProvider {
  private keyPair: CryptoKeyPair | null = null;
  private generation = 0;

  // Releases references; JavaScript cannot promise physical memory zeroization.
  dispose(): void {
    this.generation++;
    this.keyPair = null;
  }

  private requirePair(): CryptoKeyPair {
    if (!this.keyPair) throw new Error('identity_not_initialized');
    return this.keyPair;
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation) throw new Error('identity_disposed');
  }

  async create(): Promise<Identity> {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    try { return await this.fromSeed(seed); }
    finally { seed.fill(0); }
  }

  async fromSeed(seed: Uint8Array): Promise<Identity> {
    if (seed.length !== 32) throw new Error('identity_seed_must_be_32_bytes');
    this.dispose();
    const generation = this.generation;
    let scalar = seed.slice();
    let pkcs8: Uint8Array | undefined;
    let input: ArrayBuffer | undefined;
    try {
      // Preserve derivation for valid P-256 scalars; rehash exceptional values.
      while (true) {
        let value = 0n;
        for (const byte of scalar) value = (value << 8n) | BigInt(byte);
        if (value > 0n && value < curveOrder) break;
        const hashInput = toBuffer(scalar);
        try {
          const next = new Uint8Array(await crypto.subtle.digest('SHA-256', hashInput));
          scalar.fill(0);
          scalar = next;
        } finally { new Uint8Array(hashInput).fill(0); }
        this.assertCurrent(generation);
      }
      pkcs8 = buildP256PKCS8(scalar);
      input = toBuffer(pkcs8);
      const privateKey = await crypto.subtle.importKey('pkcs8', input, curve, false, ['sign']);
      this.assertCurrent(generation);

      // The fixed Apple-compatible builder ends with the 65-byte public point.
      // Do not export a private JWK/PKCS#8 merely to obtain the public key.
      const publicBytes = pkcs8.slice(-65);
      const publicKey = await crypto.subtle.importKey('raw', toBuffer(publicBytes), curve, true, ['verify']);
      this.assertCurrent(generation);
      this.keyPair = { privateKey, publicKey };
      return { publicKey: publicBytes };
    } finally {
      scalar.fill(0);
      pkcs8?.fill(0);
      if (input) new Uint8Array(input).fill(0);
    }
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    const pair = this.requirePair();
    const generation = this.generation;
    const signature = await crypto.subtle.sign(signatureAlgorithm, pair.privateKey, toBuffer(data));
    this.assertCurrent(generation);
    return new Uint8Array(signature);
  }

  async verify(data: Uint8Array, signature: Uint8Array): Promise<boolean> {
    return crypto.subtle.verify(signatureAlgorithm, this.requirePair().publicKey, toBuffer(signature), toBuffer(data));
  }

  async verifyWithPublicKey(publicKeyBytes: Uint8Array, data: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const publicKey = await crypto.subtle.importKey('raw', toBuffer(publicKeyBytes), curve, false, ['verify']);
    return crypto.subtle.verify(signatureAlgorithm, publicKey, toBuffer(signature), toBuffer(data));
  }

  async getPublicKeyBytes(): Promise<Uint8Array> {
    const generation = this.generation;
    const bytes = await crypto.subtle.exportKey('raw', this.requirePair().publicKey);
    this.assertCurrent(generation);
    return new Uint8Array(bytes);
  }
}
