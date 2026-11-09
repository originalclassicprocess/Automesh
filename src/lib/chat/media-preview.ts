import type { FileOffer } from './file-transfer';

export type InlineMedia = { kind: 'image' | 'audio' | 'video'; mime: string };

// Deliberately exclude active formats such as SVG and HTML from inline previews.
const mimeTypes: Record<string, InlineMedia> = {
  'image/jpeg': { kind: 'image', mime: 'image/jpeg' },
  'image/png': { kind: 'image', mime: 'image/png' },
  'image/gif': { kind: 'image', mime: 'image/gif' },
  'image/webp': { kind: 'image', mime: 'image/webp' },
  'image/avif': { kind: 'image', mime: 'image/avif' },
  'audio/mpeg': { kind: 'audio', mime: 'audio/mpeg' },
  'audio/mp3': { kind: 'audio', mime: 'audio/mpeg' },
  'audio/wav': { kind: 'audio', mime: 'audio/wav' },
  'audio/x-wav': { kind: 'audio', mime: 'audio/wav' },
  'audio/ogg': { kind: 'audio', mime: 'audio/ogg' },
  'audio/webm': { kind: 'audio', mime: 'audio/webm' },
  'audio/mp4': { kind: 'audio', mime: 'audio/mp4' },
  'audio/aac': { kind: 'audio', mime: 'audio/aac' },
  'audio/flac': { kind: 'audio', mime: 'audio/flac' },
  'video/mp4': { kind: 'video', mime: 'video/mp4' },
  'video/webm': { kind: 'video', mime: 'video/webm' },
  'video/ogg': { kind: 'video', mime: 'video/ogg' },
};

const extensions: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', mp3: 'audio/mpeg', wav: 'audio/wav',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4',
  aac: 'audio/aac', flac: 'audio/flac', mp4: 'video/mp4', m4v: 'video/mp4',
  webm: 'video/webm', ogv: 'video/ogg',
};

export function inlineMediaFor(offer: FileOffer): InlineMedia | null {
  if (offer.size === 0) return null;
  if (/\.(svg|svgz|html?|xhtml|xml)$/i.test(offer.name)) return null;
  const declared = offer.mime.toLowerCase().trim();
  if (mimeTypes[declared]) return mimeTypes[declared];
  if (declared && declared !== 'application/octet-stream') return null;
  const extension = offer.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return extension ? mimeTypes[extensions[extension]] ?? null : null;
}
