// ============================================================
// MeshAutonomy — Transport Layer
// ============================================================
// Принцип: каждый транспорт реализует этот интерфейс.
// Верхние слои (chat, message) не знают про транспорт вообще.
// ============================================================

// ------------------------------------------------------------
// Capabilities — что умеет этот транспорт
// ------------------------------------------------------------

export type BandwidthTier = 'high' | 'medium' | 'low' | 'very_low';
export type LatencyTier = 'realtime' | 'seconds' | 'minutes';
export type TransportType = 'webrtc' | 'lan' | 'bluetooth' | 'lora' | 'unknown';

export interface TransportCapabilities {
  type: TransportType;

  // Пропускная способность
  bandwidth: BandwidthTier;

  // Латентность
  latency: LatencyTier;

  // Максимальный размер одного сообщения в байтах
  // Complete envelope limit, not the size of an entire chunked attachment.
  maxMessageBytes: number;

  // Поддержка передачи файлов
  supportsFiles: boolean;

  // Поддержка голосовых/видео звонков
  supportsCalls: boolean;

  // Работает без интернета
  worksOffline: boolean;

  // Примерная дальность в метрах (null = неограничено)
  rangeMeters: number | null;
}

// WebRTC/LAN presets are active; Bluetooth/LoRa entries are reserved estimates.
export const TRANSPORT_CAPABILITIES: Record<TransportType, TransportCapabilities> = {
  webrtc: {
    type: 'webrtc',
    bandwidth: 'high',
    latency: 'realtime',
    maxMessageBytes: 256 * 1024,      // 256 KB
    supportsFiles: true,
    supportsCalls: true, // Voice via a separate authenticated CallController PC.
    worksOffline: false,
    rangeMeters: null,
  },
  lan: {
    type: 'lan',
    bandwidth: 'high',
    latency: 'realtime',
    maxMessageBytes: 256 * 1024,      // 256 KB
    supportsFiles: true,
    supportsCalls: true, // Voice in an available local network; not radio calling.
    worksOffline: true,
    rangeMeters: null,                // зависит от роутера
  },
  bluetooth: {
    type: 'bluetooth',
    bandwidth: 'low',
    latency: 'seconds',
    maxMessageBytes: 512,             // 512 bytes
    supportsFiles: false,
    supportsCalls: false,
    worksOffline: true,
    rangeMeters: 100,
  },
  lora: {
    type: 'lora',
    bandwidth: 'very_low',
    latency: 'minutes',
    maxMessageBytes: 1024,            // Reserved complete-envelope budget, NOT the RF packet MTU.
    supportsFiles: false,
    supportsCalls: false,
    worksOffline: true,
    rangeMeters: null,                // Hardware/environment dependent; no fixed range promise.
  },
  unknown: {
    type: 'unknown',
    bandwidth: 'low',
    latency: 'seconds',
    maxMessageBytes: 512,
    supportsFiles: false,
    supportsCalls: false,
    worksOffline: false,
    rangeMeters: null,
  },
};

// ------------------------------------------------------------
// Status — текущее состояние транспорта
// ------------------------------------------------------------

export type TransportStatus =
  | 'idle'          // не инициализирован
  | 'discovering'   // ищет пиров (QR, mDNS, LoRa scan)
  | 'connecting'    // handshake в процессе
  | 'connected'     // соединение активно
  | 'degraded'      // соединение есть но нестабильно
  | 'reconnecting'  // потеряли соединение, пытаемся восстановить
  | 'offline'       // недоступен
  | 'error';        // критическая ошибка

// ------------------------------------------------------------
// Peer — удалённый участник
// ------------------------------------------------------------

export interface Peer {
  // Криптографический адрес = hash(publicKey)
  // Это и есть identity пира, не меняется между сессиями
  address: string;

  // Через какой транспорт сейчас доступен
  transport: TransportType;

  // Когда последний раз видели
  lastSeen: number; // unix timestamp ms
}

// ------------------------------------------------------------
// Message — то что реально передаётся между пирами
// ------------------------------------------------------------

export type { TransportMessage } from '$lib/message/types';
import type { TransportMessage } from '$lib/message/types';

export interface TransportRegistrationIdentity {
  publicKey: Uint8Array;
  sign(data: Uint8Array): Promise<Uint8Array>;
}

// ------------------------------------------------------------
// Transport — основной интерфейс
// ------------------------------------------------------------

export interface Transport {
  // Что умеет этот транспорт
  readonly capabilities: TransportCapabilities;

  // Текущий статус
  getStatus(): TransportStatus;

  // Инициализация транспорта
  // peerAddress — наш собственный crypto address
  init(peerAddress: string, identity?: TransportRegistrationIdentity): Promise<void>;

  // Подключиться к конкретному пиру
  connect(peer: Peer): Promise<void>;

  // Отключиться
  disconnect(): Promise<void>;

  // Отправить сообщение
  // Current chat requires reliable, ordered delivery per peer. Future radio adapters
  // must provide framing/reassembly and ordering, not just implement this shape.
  send(message: TransportMessage): Promise<void>;

  // Подписаться на входящие сообщения
  onMessage(cb: (message: TransportMessage) => void): void;

  // Подписаться на изменения статуса
  onStatusChange(cb: (status: TransportStatus) => void): void;

  // Подписаться на появление/исчезновение пиров
  onPeerChange(cb: (peer: Peer, event: 'joined' | 'left') => void): void;

  // Обнаружение доступных пиров
  // Для WebRTC — через signaling
  // Для LAN — через QR или mDNS
  // Для LoRa — широковещательный запрос
  discover(): Promise<Peer[]>;

  // Проверка доступности транспорта на этом устройстве
  // Например: LoRa недоступна если нет bridge
  isAvailable(): Promise<boolean>;
}

