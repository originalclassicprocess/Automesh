import { describe, expect, it } from 'vitest';
import { ATTACHMENT_PROTOCOL, attachmentLimits, validateAttachment, validAttachmentChunk, validAttachmentRequest } from './attachment-protocol.js';
import { COURIER_PROTOCOL, courierId, validateCourierJob } from './courier-protocol.js';
import { encodeAccountId } from '../addressing/bech32m.js';

const id = 'a'.repeat(32), uuid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const address = encodeAccountId(new Uint8Array(20).fill(1));
const target = encodeAccountId(new Uint8Array(20).fill(2));
const attachment = { ...attachmentLimits(), id, size: 0, chunks: 1, bytes: 16, digest: 'b'.repeat(64) };
delete (attachment as Partial<typeof attachment>).maxFileBytes;
const request = { body: { protocol: ATTACHMENT_PROTOCOL, id, index: 0, requestId: id, expiresAt: Date.now() + 60000 },
  publicKey: '04' + 'a'.repeat(128), signature: 'b'.repeat(128) };
const chunk = { id, requestId: id, index: 0, cipher: 'a'.repeat(22) };
// Plain JSON, not exotic JS getters/proxies: this previously made RegExp.test
// throw by shadowing inherited string coercion, or coerced arrays into valid IDs.
const invalid: unknown[] = [null, undefined, 42, {}, [], [id], { toString: null }, { toString: {}, valueOf: null }];

describe('hostile transport field types', () => {
  it('rejects malformed file request fields without coercion or exceptions', () => {
    expect(validAttachmentRequest(request)).toBe(true);
    for (const value of invalid) {
      expect(validAttachmentRequest(value)).toBe(false);
      for (const field of ['id', 'requestId']) expect(validAttachmentRequest({ ...request, body: { ...request.body, [field]: value } })).toBe(false);
      for (const field of ['publicKey', 'signature']) expect(validAttachmentRequest({ ...request, [field]: value })).toBe(false);
    }
  });
  it('rejects malformed chunks without exceptions and still accepts valid frames', () => {
    expect(validAttachmentChunk(chunk)).toBe(true);
    for (const value of invalid) {
      expect(validAttachmentChunk(value)).toBe(false);
      for (const field of ['id', 'requestId', 'cipher']) expect(validAttachmentChunk({ ...chunk, [field]: value })).toBe(false);
    }
  });
  it('rejects malformed attachment metadata with the protocol error, not TypeError', () => {
    expect(validateAttachment(attachment)).toEqual(attachment);
    for (const value of invalid) for (const field of ['id', 'digest'])
      expect(() => validateAttachment({ ...attachment, [field]: value })).toThrow('invalid_attachment');
  });
  it('accepts only string courier IDs and typed signature fields', () => {
    const job = { body: { protocol: COURIER_PROTOCOL, id: uuid, courier: address, from: address, to: target,
      expiresAt: Date.now() + 60000, packet: 'abcd' }, publicKey: request.publicKey, signature: request.signature };
    expect(validateCourierJob(job, address)).toEqual(job);
    expect(courierId(uuid)).toBe(true);
    for (const value of [...invalid, [uuid]]) {
      expect(courierId(value)).toBe(false);
      expect(() => validateCourierJob({ ...job, body: { ...job.body, id: value } }, address)).toThrow('invalid_courier_job');
      for (const field of ['publicKey', 'signature']) expect(() => validateCourierJob({ ...job, [field]: value }, address)).toThrow('invalid_courier_job');
    }
  });
});
