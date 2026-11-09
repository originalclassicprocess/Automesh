// Synthetic SDP for unit tests only; not used by the application.
export const testSdp = (byte = 'AA') => `v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fingerprint:sha-256 ${Array(32).fill(byte).join(':')}\r\n`;
