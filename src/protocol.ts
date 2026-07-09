export const MAX_PACKET_SIZE = 64;
export const SECTOR_SIZE = 1024;
export const CODE_CHUNK_SIZE = 56;
export const EEPROM_READ_CHUNK_SIZE = 0x3a;

export const CFG_MASK_RDPR_USER_DATA_WPR = 0x07;
export const CFG_MASK_BTVER = 0x08;
export const CFG_MASK_UID = 0x10;
export const CFG_MASK_ALL = 0x1f;

export const CMD = {
  IDENTIFY: 0xa1,
  ISP_END: 0xa2,
  ISP_KEY: 0xa3,
  ERASE: 0xa4,
  PROGRAM: 0xa5,
  VERIFY: 0xa6,
  READ_CONFIG: 0xa7,
  WRITE_CONFIG: 0xa8,
  DATA_ERASE: 0xa9,
  DATA_PROGRAM: 0xaa,
  DATA_READ: 0xab,
  WRITE_OTP: 0xc3,
  READ_OTP: 0xc4,
  SET_BAUD: 0xc5,
} as const;

export type CommandByte = (typeof CMD)[keyof typeof CMD];

export type Response =
  | { ok: true; command: number; status: number; payload: Uint8Array; raw: Uint8Array }
  | { ok: false; command: number; status: number; code: number; payload: Uint8Array; raw: Uint8Array };

export function le16(n: number): number[] {
  assertUint(n, 0xffff, 'u16');
  return [n & 0xff, (n >>> 8) & 0xff];
}

export function le32(n: number): number[] {
  assertUint(n, 0xffffffff, 'u32');
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

export function readLe16(buf: Uint8Array, off: number): number {
  requireLength(buf, off + 2, 'u16');
  return buf[off] | (buf[off + 1] << 8);
}

export function readLe32(buf: Uint8Array, off: number): number {
  requireLength(buf, off + 4, 'u32');
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

export function commandIdentify(deviceId = 0, deviceType = 0): Uint8Array {
  return concatBytes(Uint8Array.from([CMD.IDENTIFY, 0x12, 0x00, deviceId & 0xff, deviceType & 0xff]), ascii('MCU ISP & WCH.CN'));
}

export function commandIspEnd(reason = 1): Uint8Array {
  return Uint8Array.from([CMD.ISP_END, 0x01, 0x00, reason & 0xff]);
}

export function commandIspKey(seed: Uint8Array | number = 0x1e): Uint8Array {
  const key = typeof seed === 'number' ? new Uint8Array(seed) : seed;
  return concatBytes(Uint8Array.from([CMD.ISP_KEY, key.length & 0xff, 0x00]), key);
}

export function commandErase(sectors: number): Uint8Array {
  return Uint8Array.from([CMD.ERASE, 0x04, 0x00, ...le32(sectors)]);
}

export function commandReadConfig(mask = CFG_MASK_ALL): Uint8Array {
  return Uint8Array.from([CMD.READ_CONFIG, 0x02, 0x00, mask & 0xff, 0x00]);
}

export function commandWriteConfig(mask: number, data: Uint8Array): Uint8Array {
  const len = 1 + data.length;
  return concatBytes(Uint8Array.from([CMD.WRITE_CONFIG, ...le16(len), mask & 0xff, 0x00]), data);
}

export function commandProgram(address: number, data: Uint8Array, padding = randomByte()): Uint8Array {
  return commandAddressData(CMD.PROGRAM, address, data, padding);
}

export function commandVerify(address: number, data: Uint8Array, padding = randomByte()): Uint8Array {
  return commandAddressData(CMD.VERIFY, address, data, padding);
}

export function commandDataProgram(address: number, data: Uint8Array, padding = randomByte()): Uint8Array {
  return commandAddressData(CMD.DATA_PROGRAM, address, data, padding);
}

export function commandDataRead(address: number, len: number): Uint8Array {
  return Uint8Array.from([CMD.DATA_READ, 0x06, 0x00, ...le32(address), ...le16(len)]);
}

export function commandDataErase(sectors: number): Uint8Array {
  return Uint8Array.from([CMD.DATA_ERASE, 0x05, 0x00, 0, 0, 0, 0, sectors & 0xff]);
}

export function commandSetBaud(baudrate: number): Uint8Array {
  return Uint8Array.from([CMD.SET_BAUD, 0x04, 0x00, ...le32(baudrate)]);
}

export function parseResponse(raw: Uint8Array): Response {
  requireLength(raw, 4, 'response header');
  const command = raw[0];
  const status = raw[1];
  const len = readLe16(raw, 2);
  const payload = raw.slice(4);
  if (payload.length !== len) {
    throw new Error(`Invalid response length: expected ${len}, got ${payload.length}`);
  }
  const ok = status === 0x00 || status === 0x82;
  return ok ? { ok: true, command, status, payload, raw } : { ok: false, command, status, code: status, payload, raw };
}

export function frameSerialRequest(raw: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.from([0x57, 0xab]), raw, Uint8Array.from([checksum8(raw)]));
}

export function parseSerialResponse(frame: Uint8Array): Uint8Array {
  requireLength(frame, 7, 'serial response');
  if (frame[0] !== 0x55 || frame[1] !== 0xaa) {
    throw new Error(`Response has invalid serial header ${hex(frame.slice(0, 2))}`);
  }
  const raw = frame.slice(2, frame.length - 1);
  const expected = checksum8(raw);
  const actual = frame[frame.length - 1];
  if (expected !== actual) {
    throw new Error(`Response has incorrect checksum ${hexByte(actual)} != ${hexByte(expected)}`);
  }
  const len = readLe16(raw, 2);
  if (raw.length !== 4 + len) {
    throw new Error(`Invalid serial payload length: expected ${4 + len}, got ${raw.length}`);
  }
  return raw;
}

export function xorWithKey(raw: Uint8Array, key: Uint8Array | number[]): Uint8Array {
  if (key.length !== 8) throw new Error(`XOR key must be 8 bytes, got ${key.length}`);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] ^ key[i % 8];
  return out;
}

export function makeXorKey(chipUid: Uint8Array, chipId: number): Uint8Array {
  const sum = checksum8(chipUid);
  const key = new Uint8Array(8).fill(sum);
  key[7] = (key[7] + (chipId & 0xff)) & 0xff;
  return key;
}

export function checksum8(data: Uint8Array | number[]): number {
  let sum = 0;
  for (const b of data) sum = (sum + b) & 0xff;
  return sum;
}

export function ispKeyChecksum(chipUid: Uint8Array, chipId: number): number {
  return checksum8(makeXorKey(chipUid, chipId));
}

export function padToSector(input: Uint8Array, fill = 0x00): Uint8Array {
  const rem = input.length % SECTOR_SIZE;
  if (rem === 0) return input;
  const out = new Uint8Array(input.length + SECTOR_SIZE - rem);
  out.fill(fill & 0xff);
  out.set(input);
  return out;
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export function hex(data: Uint8Array | number[]): string {
  return Array.from(data, hexByte).join('');
}

export function hexByte(n: number): string {
  return (n & 0xff).toString(16).padStart(2, '0');
}

function commandAddressData(command: number, address: number, data: Uint8Array, padding: number): Uint8Array {
  const len = 4 + 1 + data.length;
  return concatBytes(Uint8Array.from([command & 0xff, ...le16(len), ...le32(address), padding & 0xff]), data);
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(Array.from(text, c => c.charCodeAt(0) & 0xff));
}

function randomByte(): number {
  const a = new Uint8Array(1);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(a);
  else a[0] = Math.floor(Math.random() * 256);
  return a[0];
}

function requireLength(buf: Uint8Array, min: number, what: string): void {
  if (buf.length < min) throw new Error(`Short ${what}: expected at least ${min}, got ${buf.length}`);
}

function assertUint(n: number, max: number, what: string): void {
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`Expected ${what}, got ${n}`);
}
