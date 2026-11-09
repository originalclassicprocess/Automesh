export interface Identity {
  publicKey: Uint8Array;
}

export interface IdentityProvider {
  create(): Promise<Identity>;
  fromSeed(seed: Uint8Array): Promise<Identity>;
  sign(data: Uint8Array): Promise<Uint8Array>;
  verify(data: Uint8Array, sig: Uint8Array): Promise<boolean>;
  getPublicKeyBytes(): Promise<Uint8Array>;
  dispose?(): void;
}
