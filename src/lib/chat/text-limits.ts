export const MAX_CHAT_TEXT_BYTES = 64 * 1024;
export const MAX_FIRST_REQUEST_BYTES = 4 * 1024;

export function textFitsLimit(text: string, firstRequest: boolean): boolean {
  return new TextEncoder().encode(text).byteLength <=
    (firstRequest ? MAX_FIRST_REQUEST_BYTES : MAX_CHAT_TEXT_BYTES);
}
