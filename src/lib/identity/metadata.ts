export type IdentityMetadata = {
  version: number;

  curve: string;

  derivation: string;

  createdAt: number;
};

export const CURRENT_IDENTITY_VERSION = 1;

export function createIdentityMetadata():
  IdentityMetadata {

  return {
    version: CURRENT_IDENTITY_VERSION,

    curve: 'P-256',

    derivation: 'mesh/identity/v1',

    createdAt: Date.now()
  };
}