import { describe, expect, it } from 'vitest';
import { PIDS, DTC_DESCRIPTIONS, decodeDtcs, decodeMil, dtcFromBytes, hex2, normalizeLines, parseMode01, pidDef, supportedFromMask } from './pids';

describe('PID formulas (SAE J1979)', () => {
  const d = (pid: number, bytes: number[]) => pidDef(pid)!.decode(bytes);
  it('engine speed: ((A*256)+B)/4', () => {
    expect(d(0x0c, [0x1a, 0xf8])).toBe(1726); // 6904/4
    expect(d(0x0c, [0, 0])).toBe(0);
    expect(d(0x0c, [0xff, 0xff])).toBe(16383.75);
  });
  it('vehicle speed is A km/h', () => expect(d(0x0d, [120])).toBe(120));
  it('temperatures are A-40 °C', () => {
    expect(d(0x05, [0x7b])).toBe(83);
    expect(d(0x05, [0])).toBe(-40);
    expect(d(0x0f, [0x46])).toBe(30);
    expect(d(0x46, [0x3c])).toBe(20);
  });
  it('percentages are A*100/255', () => {
    expect(d(0x11, [255])).toBe(100);
    expect(d(0x04, [0])).toBe(0);
    expect(d(0x2f, [128])).toBeCloseTo(50.2, 1);
  });
  it('control-module voltage is ((A*256)+B)/1000', () => expect(d(0x42, [0x38, 0x4a])).toBeCloseTo(14.41, 2));
  it('has unique pids and every key once', () => {
    expect(new Set(PIDS.map((p) => p.pid)).size).toBe(PIDS.length);
    expect(new Set(PIDS.map((p) => p.key)).size).toBe(PIDS.length);
  });
});

describe('reply parsing', () => {
  it('finds the data bytes for a pid', () => {
    expect(parseMode01(['410C1AF8'], 0x0c)).toEqual([0x1a, 0xf8]);
    expect(parseMode01(['41 0C 1A F8'], 0x0c)).toEqual([0x1a, 0xf8]); // spaces on
    expect(parseMode01(['41 0d 78'], 0x0d)).toEqual([0x78]); // lowercase
  });
  it('ignores replies for other pids and picks the right ECU line', () => {
    expect(parseMode01(['410D78'], 0x0c)).toBeNull();
    expect(parseMode01(['410D10', '410D78'], 0x0d)).toEqual([0x10]); // first responder
    expect(parseMode01(['4100BE3EA813', '410C1AF8'], 0x0c)).toEqual([0x1a, 0xf8]);
  });
  it('strips multi-frame prefixes and the length line', () => {
    expect(normalizeLines(['00B', '0: 43 02 01 33', '1: 04 20 00 00'])).toEqual(['43020133', '04200000']);
  });
  it('formats hex', () => expect(hex2(5)).toBe('05'));
});

describe('supported-PID bitmaps', () => {
  it('PID 0100 reply BE3EA813 → known supported set', () => {
    // BE=1011 1110 → 01,03,04,05,06,07 ; 3E=0011 1110 → 0B,0C,0D,0E,0F ; A8=1010 1000 → 11,13,15 ; 13=0001 0011 → 1C,1F,20
    expect(supportedFromMask(0x00, [0xbe, 0x3e, 0xa8, 0x13])).toEqual([0x01, 0x03, 0x04, 0x05, 0x06, 0x07, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x11, 0x13, 0x15, 0x1c, 0x1f, 0x20]);
  });
  it('offsets by the base for the 0120 / 0140 pages', () => {
    expect(supportedFromMask(0x20, [0x80, 0, 0, 0])).toEqual([0x21]);
    expect(supportedFromMask(0x40, [0x00, 0x00, 0x00, 0x01])).toEqual([0x60]);
  });
  it('tolerates a short reply', () => expect(supportedFromMask(0, [0x80])).toEqual([1]));
});

describe('check-engine lamp (PID 01)', () => {
  it('reads the lamp and the code count', () => {
    expect(decodeMil([0x82, 0x07, 0xe5, 0x00])).toEqual({ on: true, count: 2 });
    expect(decodeMil([0x00])).toEqual({ on: false, count: 0 });
    expect(decodeMil([0x7f])).toEqual({ on: false, count: 127 });
  });
});

describe('fault codes', () => {
  it('turns bytes into codes with the right letter/digits', () => {
    expect(dtcFromBytes(0x01, 0x33)).toBe('P0133');
    expect(dtcFromBytes(0x04, 0x20)).toBe('P0420');
    expect(dtcFromBytes(0x43, 0x00)).toBe('C0300');
    expect(dtcFromBytes(0x81, 0x00)).toBe('B0100');
    expect(dtcFromBytes(0xc1, 0x23)).toBe('U0123');
    expect(dtcFromBytes(0x11, 0x71)).toBe('P1171'); // manufacturer-specific digit
    expect(dtcFromBytes(0x00, 0x00)).toBeNull(); // padding
  });
  it('CAN: count byte then pairs, ignoring padding', () => {
    expect(decodeDtcs(['43020133 0420 0000'.replace(/ /g, '')], '43', true)).toEqual(['P0133', 'P0420']);
    expect(decodeDtcs(['4300'], '43', true)).toEqual([]);
    expect(decodeDtcs(['NO DATA'], '43', true)).toEqual([]);
  });
  it('CAN: reassembles a multi-frame reply', () => {
    const lines = ['00B', '0: 43 04 01 33', '1: 04 20 03 00', '2: 02 01 00 00'];
    expect(decodeDtcs(lines, '43', true)).toEqual(['P0133', 'P0420', 'P0300', 'P0201']);
  });
  it('CAN: honours the count even if padding follows', () => {
    expect(decodeDtcs(['4301 0133 0420 0000'.replace(/ /g, '')], '43', true)).toEqual(['P0133']);
  });
  it('J1850/ISO: no count byte, 3 codes per line, several ECUs', () => {
    expect(decodeDtcs(['43 01 33 04 20 00 00', '43 03 00 00 00 00 00'], '43', false)).toEqual(['P0133', 'P0420', 'P0300']);
  });
  it('CAN: two ECUs each get their own reply (not glued together)', () => {
    expect(decodeDtcs(['43010133', '43010420'], '43', true)).toEqual(['P0133', 'P0420']);
  });
  it('pending codes use mode 47', () => {
    expect(decodeDtcs(['47010171'], '47', true)).toEqual(['P0171']);
    expect(decodeDtcs(['43010171'], '47', true)).toEqual([]);
  });
  it('de-duplicates codes reported by several ECUs', () => {
    expect(decodeDtcs(['43 01 33 00 00 00 00', '43 01 33 00 00 00 00'], '43', false)).toEqual(['P0133']);
  });
  it('describes only generic codes', () => {
    expect(DTC_DESCRIPTIONS.P0420).toMatch(/Catalyst/);
    expect(DTC_DESCRIPTIONS.P1171).toBeUndefined();
  });
});
