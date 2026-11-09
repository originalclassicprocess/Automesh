// Application memory bounds, not Meshtastic board storage quotas.
export const RADIO_PENDING_LIMIT = 64;
export const RADIO_FRAME_GAP_MS = 3000;
export const RADIO_ACK_TIMEOUT_MS = 5 * 60000;
// Optimise the tested LongFast preset; retain the previous conservative guard
// for other, potentially much slower modem presets. Firmware airtime rules stay on.
export const radioFrameGap = (preset: number) => preset === 0 ? RADIO_FRAME_GAP_MS : 10000;
