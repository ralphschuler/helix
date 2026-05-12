import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function randomSecretPart(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

export function randomUuidV7LikeId(now: Date = new Date()): string {
  const bytes = randomBytes(16);
  let timestampMillis = BigInt(now.getTime());

  for (let index = 5; index >= 0; index -= 1) {
    bytes.writeUInt8(Number(timestampMillis & 0xffn), index);
    timestampMillis >>= 8n;
  }

  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);

  const hex = bytes.toString('hex');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function parseDottedSecret(
  presentedSecret: string,
  expectedPrefixStart: string,
): { readonly publicPrefix: string; readonly fullSecret: string } | null {
  const parts = presentedSecret.split('.');

  if (parts.length !== 2) {
    return null;
  }

  const [publicPrefix, secretPart] = parts;

  if (
    publicPrefix === undefined ||
    secretPart === undefined ||
    !publicPrefix.startsWith(expectedPrefixStart) ||
    secretPart.length === 0
  ) {
    return null;
  }

  return {
    publicPrefix,
    fullSecret: presentedSecret,
  };
}
