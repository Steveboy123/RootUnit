import { Transform, type TransformCallback } from 'node:stream';

/** Extract the title from an ICY metadata block: "StreamTitle='Artist - Song';StreamUrl='';" */
export function parseStreamTitle(block: string): string | undefined {
  const m = /StreamTitle='([\s\S]*?)'\s*(?:;|$)/.exec(block.replace(/\0+$/, ''));
  const title = m?.[1]?.trim();
  return title ? title.slice(0, 200) : undefined;
}

/**
 * Removes Shoutcast/Icecast in-band metadata from an audio stream.
 *
 * When a client sends `Icy-MetaData: 1`, the server inserts a metadata block after every
 * `metaint` bytes of audio: one length byte (×16 = block size) then that many bytes of text.
 * This must be stripped before the audio reaches a player, and it must cope with blocks
 * split across arbitrary chunk boundaries.
 */
export class IcyDemux extends Transform {
  private audioLeft: number;
  private mode: 'audio' | 'len' | 'meta' = 'audio';
  private metaLeft = 0;
  private meta: Buffer[] = [];

  constructor(
    private readonly metaint: number,
    private readonly onTitle: (title: string | undefined) => void,
  ) {
    super();
    if (!Number.isInteger(metaint) || metaint <= 0) throw new Error('metaint must be a positive integer');
    this.audioLeft = metaint;
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    let i = 0;
    while (i < chunk.length) {
      if (this.mode === 'audio') {
        const n = Math.min(this.audioLeft, chunk.length - i);
        this.push(chunk.subarray(i, i + n));
        i += n;
        this.audioLeft -= n;
        if (this.audioLeft === 0) this.mode = 'len';
      } else if (this.mode === 'len') {
        this.metaLeft = chunk[i++]! * 16;
        this.meta = [];
        if (this.metaLeft === 0) {
          this.mode = 'audio';
          this.audioLeft = this.metaint;
        } else {
          this.mode = 'meta';
        }
      } else {
        const n = Math.min(this.metaLeft, chunk.length - i);
        this.meta.push(chunk.subarray(i, i + n));
        i += n;
        this.metaLeft -= n;
        if (this.metaLeft === 0) {
          this.onTitle(parseStreamTitle(Buffer.concat(this.meta).toString('utf8')));
          this.mode = 'audio';
          this.audioLeft = this.metaint;
        }
      }
    }
    cb();
  }
}
