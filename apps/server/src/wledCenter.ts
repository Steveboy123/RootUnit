import { spawn, type ChildProcess } from 'node:child_process';
import { createSocket } from 'node:dgram';
import type { JsonStore } from './store';
export interface WledSettings { host: string; mode: 'manual'|'esp-audio'|'pi-audio'; brightness: number; color: string; enabled: boolean }
const defaults: WledSettings = {host:'', mode:'manual',brightness:100,color:'#30a5ff',enabled:false};
const addressOk = (host: string) => {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const [a=0,b=0,c=0,d=0]=match.slice(1).map(Number);
  return [a,b,c,d].every(v => v>=0 && v<=255) && d>0 && d<255 && (
    a===10 || (a===172 && b>=16 && b<=31) || (a===192 && b===168));
};
export class WledCenter {
  config: WledSettings={...defaults}; private audio?: ChildProcess;
  private udp = createSocket('udp4'); private reading=Buffer.alloc(0); private brightness=0; private ledCount=30;
  private effectsCache:{host:string;at:number;items:string[]}|null=null;
  constructor(private store: JsonStore) {}
  async start() {
    const saved = await this.store.read('wled-center.json') as Partial<WledSettings> | null;
    if (saved && typeof saved.host==='string' && (!saved.host || addressOk(saved.host))) {
      this.config={...defaults,...saved};
      // Do not turn on real-time transmission on boot unexpectedly.
      if (this.config.mode==='pi-audio') this.config.mode='manual';
    }
  }
  private async call(body?: object) {
    if (!addressOk(this.config.host)) throw new Error('Enter your ESP WLED IPv4 address on your private Wi-Fi (10.x, 172.16–31.x or 192.168.x).');
    const r = await fetch(`http://${this.config.host}/json/${body?'state':'si'}`,{
      method:body?'POST':'GET', headers:body?{'content-type':'application/json'}:undefined,
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(1800),redirect:'error'});
    if (!r.ok) throw new Error('ESP returned '+r.status);
    return r.json();
  }
  async state() {
    if (!this.config.host) return {settings:this.config,connected:false,detail:'Enter your ESP32 WLED IP address.'};
    try {
      const data=await this.call() as {info?:{name?:string;leds?:{count?:number}};state?:unknown};
      this.ledCount=Math.min(80,Math.max(1,data.info?.leds?.count??30));
      const effects=await this.effectNames();
      return {settings:this.config,connected:true,device:data.info?.name??'WLED',leds:data.info?.leds?.count??null,
        deviceState:data.state,effects,detail:'WLED connected',audioCapture:!!this.audio};
    } catch(e) {return {settings:this.config,connected:false,detail:(e as Error).message,audioCapture:!!this.audio};}
  }
  private async effectNames():Promise<string[]> {
    if (this.effectsCache?.host===this.config.host && Date.now()-this.effectsCache.at<60000) return this.effectsCache.items;
    try {
      const response=await fetch(`http://${this.config.host}/json/eff`,{signal:AbortSignal.timeout(1800),redirect:'error'});
      if(!response.ok)return [];
      const value=await response.json();
      const items=Array.isArray(value)?value.filter((v):v is string=>typeof v==='string').slice(0,256):[];
      this.effectsCache={host:this.config.host,at:Date.now(),items};return items;
    }catch{return [];}
  }
  async update(patch: Partial<WledSettings> & {effect?:number; preset?:number}) {
    if (patch.host !== undefined && (!patch.host || addressOk(patch.host))) {
      if (patch.host !== this.config.host) this.stopAudio();
      this.config.host=patch.host;
    } else if (patch.host !== undefined) throw new Error('Enter a private IPv4 address, not a hostname or internet URL.');
    if (patch.brightness!==undefined) this.config.brightness=Math.round(Math.max(1,Math.min(255,Number(patch.brightness)||1)));
    if (patch.color!==undefined && /^#[0-9a-fA-F]{6}$/.test(patch.color)) this.config.color=patch.color;
    if (patch.enabled!==undefined) this.config.enabled=!!patch.enabled;
    if (patch.mode!==undefined && ['manual','esp-audio','pi-audio'].includes(patch.mode)) this.config.mode=patch.mode;
    await this.store.writeOrThrow('wled-center.json',this.config);
    this.stopAudio();
    if (this.config.host) {
      const payload:Record<string,unknown>={on:this.config.enabled,bri:this.config.brightness};
      if (this.config.mode==='manual') payload.seg=[{col:[[parseInt(this.config.color.slice(1,3),16),parseInt(this.config.color.slice(3,5),16),parseInt(this.config.color.slice(5,7),16)]]}];
      if (patch.effect!==undefined && Number.isInteger(patch.effect) && patch.effect>=0 && patch.effect<=255) payload.seg=[{fx:patch.effect}];
      if (patch.preset!==undefined && Number.isInteger(patch.preset) && patch.preset>=1 && patch.preset<=250) payload.ps=patch.preset;
      await this.call(payload);
      if (this.config.enabled && this.config.mode==='pi-audio') this.startAudio();
    }
    return this.state();
  }
  private startAudio() {
    // PipeWire/PulseAudio monitor. If Pulse's CLI is unavailable, mode remains configured,
    // but UI reports audioCapture=false; user can switch to ESP microphone mode instead.
    this.reading=Buffer.alloc(0);
    const child=spawn('parec',['--device=@DEFAULT_MONITOR@','--raw','--rate=8000','--channels=1','--format=s16le'],{stdio:['ignore','pipe','pipe']});
    this.audio=child;
    let last=0;
    child.stdout?.on('data',(chunk:Buffer)=>{
      this.reading=Buffer.concat([this.reading,chunk]);
      if(this.reading.length<1600) return;
      if(this.reading.length>16000) this.reading=this.reading.subarray(-1600);
      const samples=this.reading.subarray(0,1600); this.reading=this.reading.subarray(1600);
      let sum=0;
      for(let i=0;i+1<samples.length;i+=2) {const s=samples.readInt16LE(i)/32768;sum+=s*s;}
      const rms=Math.sqrt(sum/(samples.length/2));
      this.brightness=this.brightness*0.7+Math.min(1,rms*9)*0.3;
      if(Date.now()-last<95) return;last=Date.now();
      const count=Math.min(80,this.ledCount), packet=Buffer.alloc(2+count*3);
      packet[0]=2;packet[1]=3; // WLED realtime UDP DRGB; timeout 3 seconds
      for(let i=0;i<count;i++) {
        const wave=(Math.sin(i*0.48+last/160)+1)/2;
        const gain=Math.min(1,0.05+this.brightness*(0.5+wave));
        packet[i*3+2]=Math.round(0x30*gain);
        packet[i*3+3]=Math.round(0xa5*gain);
        packet[i*3+4]=Math.round(0xff*gain);
      }
      this.udp.send(packet,21324,this.config.host,()=>{});
    });
    child.once('error',()=>{if(this.audio===child)this.audio=undefined;});
    child.once('exit',()=>{if(this.audio===child)this.audio=undefined;});
    child.stderr?.on('data',()=>{});
  }
  private stopAudio() {this.audio?.kill('SIGTERM');this.audio=undefined;}
  stop() {this.stopAudio();this.udp.close();}
}
