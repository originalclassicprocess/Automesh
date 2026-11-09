export interface TransportMessage {
  // Кому (crypto address получателя)
  to: string;

  // От кого (crypto address отправителя)
  from: string;

  // Зашифрованный payload — транспорт не знает что внутри
  payload: Uint8Array;

  // Подпись отправителя
  signature: Uint8Array;

  // Unix timestamp ms
  timestamp: number;

  // Уникальный ID сообщения (для дедупликации в меш)
  messageId: string;

  // TTL для меш routing — сколько хопов осталось
  // Уменьшается на 1 на каждом хопе, при 0 — не пересылать
  ttl: number;
}
