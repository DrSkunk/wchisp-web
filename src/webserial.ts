import { frameSerialRequest, parseSerialResponse, readLe16 } from './protocol.js';
import { Transport } from './transport.js';

export type WchBaudrate = 115200 | 1000000 | 2000000 | number;
export type WchWebSerialOptions = { baudRate?: WchBaudrate; dataBits?: 7 | 8; stopBits?: 1 | 2; parity?: 'none' | 'even' | 'odd'; bufferSize?: number; flowControl?: 'none' | 'hardware' };

type SerialReader = { read(): Promise<{ value?: Uint8Array; done: boolean }>; releaseLock(): void; cancel?(): Promise<void> };
type SerialWriter = { write(data: Uint8Array): Promise<void>; releaseLock(): void };
type SerialPortLike = {
  readable?: ReadableStream<Uint8Array> | null;
  writable?: WritableStream<Uint8Array> | null;
  open(options: WchWebSerialOptions & { baudRate: number }): Promise<void>;
  close(): Promise<void>;
};

declare global {
  interface Navigator {
    serial?: { requestPort(options?: unknown): Promise<SerialPortLike>; getPorts(): Promise<SerialPortLike[]> };
  }
}

export class WebSerialTransport implements Transport {
  private reader?: SerialReader;
  private writer?: SerialWriter;
  private pending = new Uint8Array(0);

  private constructor(private port: SerialPortLike, private options: Required<WchWebSerialOptions & { baudRate: number }>) {}

  static async request(options: WchWebSerialOptions = {}): Promise<WebSerialTransport> {
    const serial = navigator.serial;
    if (!serial) throw new Error('Web Serial is not available in this browser');
    const port = await serial.requestPort();
    return WebSerialTransport.openPort(port, options);
  }

  static async openPaired(options: WchWebSerialOptions = {}): Promise<WebSerialTransport[]> {
    const serial = navigator.serial;
    if (!serial) throw new Error('Web Serial is not available in this browser');
    return Promise.all((await serial.getPorts()).map(port => WebSerialTransport.openPort(port, options)));
  }

  static async openPort(port: SerialPortLike, options: WchWebSerialOptions = {}): Promise<WebSerialTransport> {
    const normalized = {
      baudRate: Number(options.baudRate ?? 115200),
      dataBits: options.dataBits ?? 8,
      stopBits: options.stopBits ?? 1,
      parity: options.parity ?? 'none',
      bufferSize: options.bufferSize ?? 255,
      flowControl: options.flowControl ?? 'none',
    } satisfies Required<WchWebSerialOptions & { baudRate: number }>;
    const t = new WebSerialTransport(port, normalized);
    await t.open();
    return t;
  }

  async open(): Promise<void> {
    await this.port.open(this.options);
    if (!this.port.readable || !this.port.writable) throw new Error('Serial port is not readable/writable');
    this.reader = this.port.readable.getReader() as unknown as SerialReader;
    this.writer = this.port.writable.getWriter() as unknown as SerialWriter;
  }

  async sendRaw(raw: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('Serial writer is not open');
    await this.writer.write(frameSerialRequest(raw));
  }

  async recvRaw(timeoutMs = 1000): Promise<Uint8Array> {
    await this.readUntil(6, timeoutMs);
    const start = this.findHeader();
    if (start < 0) throw new Error('Serial response header not found');
    if (start > 0) this.pending = this.pending.slice(start);
    await this.readUntil(6, timeoutMs);
    const len = readLe16(this.pending, 4);
    const frameLen = 2 + 4 + len + 1;
    await this.readUntil(frameLen, timeoutMs);
    const frame = this.pending.slice(0, frameLen);
    this.pending = this.pending.slice(frameLen);
    return parseSerialResponse(frame);
  }

  async close(): Promise<void> {
    try { await this.reader?.cancel?.(); } catch {}
    try { this.reader?.releaseLock(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    try { await this.port.close(); } catch {}
  }

  private async readUntil(n: number, timeoutMs: number): Promise<void> {
    if (!this.reader) throw new Error('Serial reader is not open');
    const deadline = Date.now() + timeoutMs;
    while (this.pending.length < n) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`Timed out waiting for serial response (${this.pending.length}/${n} bytes)`);
      const res = await withTimeout(this.reader.read(), left);
      if (res.done) throw new Error('Serial stream closed');
      if (res.value?.length) this.pending = concat(this.pending, res.value) as Uint8Array<ArrayBuffer>;
    }
  }

  private findHeader(): number {
    for (let i = 0; i + 1 < this.pending.length; i++) if (this.pending[i] === 0x55 && this.pending[i + 1] === 0xaa) return i;
    return -1;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
