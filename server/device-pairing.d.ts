export function createDevicePairingRelay(options: { origin: string; now?: () => number; capacity?: number }): {
  handle(request: unknown, response: unknown, pathname: string): Promise<boolean>;
  close(): void;
};
