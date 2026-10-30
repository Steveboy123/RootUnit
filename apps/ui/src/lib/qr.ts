import qrcode from 'qrcode-generator';

export interface Qr {
  /** Modules per side (without the quiet zone). */
  size: number;
  /** One SVG path covering every dark module, in module units. */
  path: string;
}

/** The quiet zone a scanner needs around the code, in modules (the QR standard asks for 4). */
export const QUIET_ZONE = 4;

/**
 * Encode `text` as a grid of modules (true = dark). Type number 0 picks the smallest size that fits and error
 * correction is 'L', which keeps the long sign-in addresses (300–450 characters) at a size a phone can read
 * from a small screen. Returns null when the text is too long for any QR code.
 */
export function qrModules(text: string): boolean[][] | null {
  try {
    const qr = qrcode(0, 'L');
    qr.addData(text, 'Byte');
    qr.make();
    const size = qr.getModuleCount();
    const rows: boolean[][] = [];
    for (let y = 0; y < size; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < size; x++) row.push(qr.isDark(y, x));
      rows.push(row);
    }
    return rows;
  } catch {
    return null;
  }
}

export function makeQr(text: string): Qr | null {
  const rows = qrModules(text);
  return rows && { size: rows.length, path: modulesToPath(rows) };
}

/** Horizontal runs of dark modules → "M x y h n v1 h-n z" rectangles (far shorter than one square per module). */
export function modulesToPath(rows: boolean[][]): string {
  const out: string[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end]) end++;
      out.push(`M${x} ${y}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  });
  return out.join('');
}
