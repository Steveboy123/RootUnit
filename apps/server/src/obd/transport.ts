import { createConnection, type Socket } from 'node:net';

/** A raw byte pipe to an ELM327: a Bluetooth serial port, a USB serial port, or a Wi-Fi adapter's TCP socket. */
export interface Transport {
  open(): Promise<void>;
  write(data: string): void;
  onData(cb: (chunk: string) => void): void;
  /** Called once if the link drops (adapter unplugged / Bluetooth lost). */
  onClose(cb: (err?: Error) => void): void;
  close(): Promise<void>;
}

/** Wi-Fi ELM327 adapters (and the emulator) speak the same protocol over TCP, e.g. tcp://192.168.0.10:35000. */
export class TcpTransport implements Transport {
  private socket: Socket | null = null;
  private dataCb: (c: string) => void = () => {};
  private closeCb: (e?: Error) => void = () => {};
  private closed = false;

  constructor(
    private host: string,
    private port: number,
    private connectTimeoutMs = 5000,
  ) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = createConnection({ host: this.host, port: this.port });
      this.socket = s;
      const timer = setTimeout(() => s.destroy(new Error(`Timed out connecting to ${this.host}:${this.port}`)), this.connectTimeoutMs);
      s.once('connect', () => {
        clearTimeout(timer);
        s.setNoDelay(true);
        resolve();
      });
      s.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      s.on('data', (b) => this.dataCb(b.toString('latin1')));
      s.on('close', () => {
        if (!this.closed) this.closeCb();
      });
      s.on('error', (e) => {
        if (!this.closed) this.closeCb(e);
      });
    });
  }
  write(data: string) {
    this.socket?.write(data, 'latin1');
  }
  onData(cb: (c: string) => void) {
    this.dataCb = cb;
  }
  onClose(cb: (e?: Error) => void) {
    this.closeCb = cb;
  }
  async close() {
    this.closed = true;
    this.socket?.destroy();
  }
}

/** serialport's messages repeat the path and prefix "Error:"; keep just the reason. */
const tidy = (msg: string, path: string) => msg.replace(/^Error:\s*/i, '').replace(new RegExp(`,?\\s*cannot open ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');

export interface SerialOptions {
  path: string;
  baudRate: number;
}

/**
 * A serial port: /dev/rfcomm0 for a paired Bluetooth adapter on the Pi, COM5 for Windows' Bluetooth
 * virtual port, /dev/ttyUSB0 for a USB cable. `serialport` is an optional dependency, loaded only when
 * needed, so TCP/serial support does not require an unnecessary native binary.
 */
export class SerialTransport implements Transport {
  // Minimal structural type so this file compiles even where the optional package isn't installed.
  private port: {
    open(cb: (e?: Error | null) => void): void;
    write(d: string): void;
    close(cb?: () => void): void;
    on(ev: string, cb: (...a: never[]) => void): void;
    isOpen: boolean;
  } | null = null;
  private dataCb: (c: string) => void = () => {};
  private closeCb: (e?: Error) => void = () => {};
  private closed = false;

  constructor(private opts: SerialOptions) {}

  async open(): Promise<void> {
    let SerialPort: new (o: { path: string; baudRate: number; autoOpen: boolean }) => NonNullable<SerialTransport['port']>;
    try {
      ({ SerialPort } = (await import('serialport')) as unknown as { SerialPort: typeof SerialPort });
    } catch {
      throw new Error('The optional "serialport" package is not installed — run `npm install` (or use a tcp:// Wi-Fi adapter)');
    }
    const port = new SerialPort({ path: this.opts.path, baudRate: this.opts.baudRate, autoOpen: false });
    this.port = port;
    port.on('data', ((b: Buffer) => this.dataCb(b.toString('latin1'))) as never);
    port.on('close', (() => !this.closed && this.closeCb()) as never);
    port.on('error', ((e: Error) => !this.closed && this.closeCb(e)) as never);
    await new Promise<void>((resolve, reject) => port.open((e) => (e ? reject(new Error(`Can't open ${this.opts.path}: ${tidy(e.message, this.opts.path)}`)) : resolve())));
  }
  write(data: string) {
    this.port?.write(data);
  }
  onData(cb: (c: string) => void) {
    this.dataCb = cb;
  }
  onClose(cb: (e?: Error) => void) {
    this.closeCb = cb;
  }
  async close() {
    this.closed = true;
    const p = this.port;
    if (p?.isOpen) await new Promise<void>((r) => p.close(() => r()));
  }
}

/** "tcp://host:port" → TCP; anything else is a serial device path. */
export function createTransport(spec: string, baudRate: number): Transport {
  const m = /^tcp:\/\/([^:/]+):(\d{1,5})$/i.exec(spec.trim());
  if (m) return new TcpTransport(m[1]!, Number(m[2]));
  return new SerialTransport({ path: spec.trim(), baudRate });
}
