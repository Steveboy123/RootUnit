import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// Detect a USB-phone candidate without requiring USB debugging/ADB or collecting device identifiers.
const phoneVendors = new Set(['04e8','18d1','22b8','2a70','2717','12d1','0bb4','0fce','1004','2d95','2a45','19d2']);
export function usbPhoneStatus(receiverConfigured: boolean) {
  const dir = '/sys/bus/usb/devices';
  const phones: Array<{ label: string; port: string }> = [];
  if (existsSync(dir)) for (const name of readdirSync(dir)) {
    const folder = join(dir,name);
    try {
      const vendor = readFileSync(join(folder,'idVendor'),'utf8').trim().toLowerCase();
      if (!phoneVendors.has(vendor)) continue;
      const product = readFileSync(join(folder,'product'),'utf8').trim().slice(0,90);
      // USB interfaces have colon in the name; we only need the parent USB device.
      if (name.includes(':')) continue;
      phones.push({label:product || 'Android phone',port:name});
    } catch { /* non-device directory */ }
  }
  return {mode:'usb-wired', connected:phones.length>0, phones, receiverConfigured,
    detail: !receiverConfigured ? 'Wired-capable Android Auto receiver not configured. ADB is disabled.' :
      phones.length ? 'USB phone detected. Ready to start the configured wired receiver.' : 'Connect your phone with a data-capable USB cable.'};
}
