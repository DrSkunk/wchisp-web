import { parseResponse, Response } from './protocol.js';

export interface Transport {
  sendRaw(raw: Uint8Array): Promise<void>;
  recvRaw(timeoutMs?: number): Promise<Uint8Array>;
  close?(): Promise<void> | void;
}

export async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function transfer(transport: Transport, request: Uint8Array, timeoutMs = 1000): Promise<Response> {
  await transport.sendRaw(request);
  await delay(0);
  const raw = await transport.recvRaw(timeoutMs);
  if (raw[0] !== request[0]) {
    throw new Error(`Response command type mismatch: requested 0x${request[0].toString(16)}, got 0x${raw[0]?.toString(16)}`);
  }
  return parseResponse(raw);
}

export function assertOk(response: Response, label: string): asserts response is Extract<Response, { ok: true }> {
  if (!response.ok) throw new Error(`${label} failed with status 0x${response.code.toString(16)}`);
}
