/** Boot Studio: validated settings, durable JSON, and a file:// compatible bootstrap.
 * The boot HTML must work before the HTTP server exists, so it reads boot-config.js
 * directly from disk; the server also stores JSON under data/ for software updates.
 */
import { mkdir, readFile, rename, writeFile, copyFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { BOOT_CHOICES, BOOT_DEFAULTS, type BootConfig } from '@headunit/shared';

export { BOOT_CHOICES, BOOT_DEFAULTS, type BootConfig };

const choices: Partial<Record<keyof BootConfig, readonly string[]>> = BOOT_CHOICES;
const limits: Partial<Record<keyof BootConfig, readonly [number, number]>> = {
  positionX: [0,100], positionY:[0,100],size:[10,90],opacity:[0,100],glow:[0,100],motionSpeed:[0,100],
  titleSize:[14,55],dim:[0,90],transitionMs:[0,1200],
};
export function sanitizeBoot(value: unknown): BootConfig {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
  const output: Record<string,unknown> = {...BOOT_DEFAULTS};
  for (const key of Object.keys(BOOT_DEFAULTS) as Array<keyof BootConfig>) {
    const value = input[key];
    if (value === undefined) continue;
    const def = BOOT_DEFAULTS[key];
    if (typeof def === 'boolean') { if (typeof value === 'boolean') output[key] = value; continue; }
    if (typeof def === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        const [lo,hi] = limits[key] ?? [0,100]; output[key]=Math.round(Math.min(hi,Math.max(lo,value)));
      }
      continue;
    }
    if (typeof value !== 'string') continue;
    if (key === 'title' || key === 'subtitle' || key === 'readyText') {
      // No HTML ever inserted in the boot page; limit width for touch displays.
      output[key] = value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,key === 'title' ? 38 : 72);
    } else if (key === 'bgColor' || key === 'bgColor2' || key === 'accent' || key === 'accent2') {
      if (/^#[a-fA-F0-9]{6}$/.test(value)) output[key]=value;
    } else if (choices[key]?.includes(value)) output[key]=value;
  }
  return output as BootConfig;
}
export function configScript(config:BootConfig) {
  // The bootstrap is javascript because file:// fetch() of JSON is blocked by Chromium.
  return `window.HEADUNIT_BOOT_CONFIG=${JSON.stringify(config).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};\n`;
}
const types: Record<string,string> = {'.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
const extensionOf = (data:Buffer):string | null => {
  if (data.length >= 8 && data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return '.png';
  if (data.length >= 4 && data[0]===0xff && data[1]===0xd8 && data[2]===0xff) return '.jpg';
  if (data.length >= 12 && data.toString('ascii',0,4)==='RIFF' && data.toString('ascii',8,12)==='WEBP') return '.webp';
  return null;
};
async function atomicWrite(path:string,body:string|Buffer) {
  const tmp = path+`.tmp-${process.pid}`;
  try { await mkdir(join(path,'..'),{recursive:true}); await writeFile(tmp,body); await rename(tmp,path); }
  catch(e) { await import('node:fs/promises').then(fs=>fs.rm(tmp,{force:true})).catch(()=>{}); throw e; }
}
export function createBootStudio(dataDir:string,projectDir:string) {
  const root = join(projectDir,'deploy','boot');
  const jsonPath = join(dataDir,'boot-studio.json');
  const jsPath = join(root,'boot-config.js');
  const assetDir = join(dataDir,'boot-assets');
  const webAssets = join(root,'art');
  async function config(): Promise<BootConfig> {
    try { return sanitizeBoot(JSON.parse(await readFile(jsonPath,'utf8'))); }
    catch { return sanitizeBoot({}); }
  }
  async function prepare():Promise<void> {
    // Whenever a software update replaces source files, restore the latest saved
    // boot theme/custom art before opening the HTTP socket.
    await mkdir(webAssets,{recursive:true});
    const saved=await config();
    await atomicWrite(jsPath,configScript(saved));
    for (const slot of ['mascot','background'] as const) {
      for (const ext of ['.png','.jpg','.webp']) {
        try { await copyFile(join(assetDir,slot+ext),join(webAssets,slot+ext)); } catch { /* no uploaded image */ }
      }
    }
  }
  async function save(value:unknown):Promise<BootConfig> {
    const next=sanitizeBoot(value);
    await atomicWrite(jsonPath,JSON.stringify(next,null,2)+'\n');
    await atomicWrite(jsPath,configScript(next));
    return next;
  }
  async function upload(req:IncomingMessage,slot:string):Promise<{image:string}> {
    if(slot!=='mascot' && slot!=='background') throw new Error('Choose mascot or background.');
    const bytes:Buffer[]=[];let size=0;
    for await (const chunk of req) {
      const b=Buffer.from(chunk as Uint8Array);size+=b.length;
      if(size>6*1024*1024) throw new Error('Image exceeds 6 MB.');
      bytes.push(b);
    }
    const data=Buffer.concat(bytes);const ext=extensionOf(data);
    if (!ext || data.length < 32) throw new Error('Upload a PNG, JPEG or WebP picture.');
    await mkdir(assetDir,{recursive:true}); await mkdir(webAssets,{recursive:true});
    for(const other of ['.png','.jpg','.webp']) {
      if(other===ext) continue;
      const fs=await import('node:fs/promises');
      await fs.rm(join(assetDir,slot+other),{force:true}).catch(()=>{});
      await fs.rm(join(webAssets,slot+other),{force:true}).catch(()=>{});
    }
    await atomicWrite(join(assetDir,slot+ext),data);
    await atomicWrite(join(webAssets,slot+ext),data);
    return { image:`${slot}${ext}` };
  }
  async function asset(name:string):Promise<{bytes:Buffer;mime:string}|null> {
    if (!/^(original|transparent|armored)\.webp$|^(mascot|background)\.(png|webp|jpg)$/.test(name) || basename(name)!==name) return null;
    const ext=name.slice(name.lastIndexOf('.'));
    try {
      const file=join(webAssets,name);
      if((await stat(file)).size>7*1024*1024) return null;
      return {bytes:await readFile(file),mime:types[ext]!};
    } catch {return null;}
  }
  return {config,save,upload,asset,prepare,root};
}
