import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { JsonStore } from './store';
interface DashcamConfig { camera: string; armed: boolean; maxGb: number; parkingEvents: boolean }
const defaults:DashcamConfig = {camera:'/dev/video0',armed:false,maxGb:2,parkingEvents:false};
export class DashcamCenter {
  settings:DashcamConfig={...defaults}; private child:ChildProcess|null=null;
  private events:Array<{at:string;kind:string;clip?:string}>=[];
  private retention?:ReturnType<typeof setInterval>; private eventStop?:ReturnType<typeof setTimeout>;
  private isEventRecording=false; private busy=false;
  private pendingEvent: {log:{at:string;kind:string;clip?:string};before:Set<string>}|null=null;
  private clipsDir:string; private protectDir:string;
  constructor(private store:JsonStore, root:string) {
    this.clipsDir=resolve(root,'dashcam','clips'); this.protectDir=resolve(root,'dashcam','events');
  }
  async start() {
    await Promise.all([mkdir(this.clipsDir,{recursive:true}),mkdir(this.protectDir,{recursive:true})]);
    const value=await this.store.read('dashcam-config.json') as Partial<DashcamConfig>|null;
    if(value){
      if(typeof value.camera==='string' && /^\/dev\/video\d{1,2}$/.test(value.camera)) this.settings.camera=value.camera;
      if(typeof value.maxGb==='number') this.settings.maxGb=Math.max(.25,Math.min(32,value.maxGb));
      this.settings.parkingEvents=!!value.parkingEvents;
      // Driving recording never auto-starts until power/battery installation is confirmed.
    }
    const history=await this.store.read('dashcam-events.json');
    if(Array.isArray(history)) this.events=history.slice(-80).filter(v=>v && typeof v.kind==='string');
    this.retention=setInterval(()=>{void this.prune();},30000);
  }
  private cameras() {
    try{return readdirSync('/dev').filter(s=>/^video\d+$/.test(s)).map(s=>`/dev/${s}`);}catch{return [] as string[];}
  }
  async state() {
    const clips=await this.listClips();
    return {settings:this.settings,recording:!!this.child,cameras:this.cameras(),
      clips:clips.slice(0,40),events:this.events.slice(-30).reverse(),directory:this.clipsDir,
      detail:this.child?'Recording in 2-minute segments':
        existsSync(this.settings.camera)?'Camera detected; recording stopped':'No camera detected. Connect a V4L2 USB UVC camera.'};
  }
  private async listClips() {
    const entries=await readdir(this.clipsDir).catch(()=>[] as string[]);
    return entries.filter(s=>/^dash-\d{8}-\d{6}\.mkv$/.test(s)).sort().reverse();
  }
  async action(action:string,body:Record<string,unknown>={}) {
    if(action==='config') {
      if(typeof body.camera==='string') {
        if(!/^\/dev\/video\d{1,2}$/.test(body.camera)) throw Error('Select /dev/video0, /dev/video1 or another local video device.');
        if(this.child) throw Error('Stop recording before changing cameras.');
        this.settings.camera=body.camera;
      }
      if(typeof body.maxGb==='number') this.settings.maxGb=Math.max(.25,Math.min(32,body.maxGb));
      if(typeof body.parkingEvents==='boolean') this.settings.parkingEvents=body.parkingEvents;
      await this.store.writeOrThrow('dashcam-config.json',this.settings);
    } else if(action==='start') await this.record();
    else if(action==='stop') this.stopRecording();
    else if(action==='protect') await this.protect('manual');
    else throw Error('Unknown dashcam command.');
    return this.state();
  }
  private async record() {
    if(this.child) return;
    if(!existsSync(this.settings.camera)) throw Error('Camera unavailable: '+this.settings.camera);
    // ffmpeg is passed fixed argv, no shell, and only a /dev/videoNN input is accepted.
    const outfile=join(this.clipsDir,'dash-%Y%m%d-%H%M%S.mkv');
    const args=['-hide_banner','-loglevel','warning','-f','v4l2','-framerate','15','-video_size','1280x720',
      '-i',this.settings.camera,'-an','-c:v','libx264','-preset','ultrafast','-crf','28',
      '-f','segment','-segment_time','120','-reset_timestamps','1','-strftime','1',outfile];
    const proc=spawn('ffmpeg',args,{stdio:['ignore','ignore','pipe']});
    this.child=proc;
    proc.stderr?.on('data',d=>console.error('[dashcam]',String(d).slice(0,800)));
    proc.on('error',e=>console.error('[dashcam] ffmpeg unavailable:',e.message));
    proc.on('exit',()=>{
      if(this.child===proc)this.child=null;
      const pending=this.pendingEvent;this.pendingEvent=null;this.isEventRecording=false;
      if(pending) void this.preserveEventCapture(pending);
    });
  }
  private stopRecording(){clearTimeout(this.eventStop);this.eventStop=undefined;
    if(this.child){const proc=this.child;this.child=null;proc.kill('SIGINT');
      const kill=setTimeout(()=>{if(proc.exitCode===null)proc.kill('SIGTERM');},4000);kill.unref();}
    this.isEventRecording=false;
  }
  /** Runs when the parking-triggered ffmpeg process exits, after MKV is finalized. */
  private async preserveEventCapture(pending:{log:{at:string;kind:string;clip?:string};before:Set<string>}) {
    try {
      const candidate=(await this.listClips()).find(f=>!pending.before.has(f));
      if (!candidate) return;
      const dest=`event-${Date.now()}-${pending.log.kind}.mkv`;
      const {copyFile}=await import('node:fs/promises');
      await copyFile(join(this.clipsDir,candidate),join(this.protectDir,dest));
      pending.log.clip=dest;
      await this.store.writeOrThrow('dashcam-events.json',this.events);
    } catch (e) {console.error('[dashcam] could not protect sensor event footage:',e);}
  }
  async protect(kind:string) {
    if(!['manual','motion','impact','door','alarm'].includes(kind)) throw Error('Unknown event kind.');
    if(this.busy) throw Error('Already preserving a clip.'); this.busy=true;
    try {
      let clip: string|undefined;
      const files=await this.listClips();
      // Previous finalized clip is safer than the segment that ffmpeg is still writing.
      const source=files.find((s,i)=>this.child?i>=1:true);
      if(source) {
        const dest=`event-${Date.now()}-${kind}.mkv`;
        const {copyFile}=await import('node:fs/promises');
        await copyFile(join(this.clipsDir,source),join(this.protectDir,dest));
        clip=dest;
      }
      const log={at:new Date().toISOString(),kind,clip};
      this.events.push(log);this.events=this.events.slice(-80);
      await this.store.writeOrThrow('dashcam-events.json',this.events);
      if(kind!=='manual' && this.settings.parkingEvents && !this.child){
        this.pendingEvent={log,before:new Set(files)};
        await this.record();this.isEventRecording=true;
        this.eventStop=setTimeout(()=>{if(this.isEventRecording)this.stopRecording();},90000);
      }
      return {ok:true,clip:clip??null,detail:clip?'Saved previous complete segment':'Event saved; no finalized video segment available yet.'};
    } finally {this.busy=false;}
  }
  private async prune(){
    if(this.busy) return;
    try {
      const files=(await this.listClips()).reverse();let total=0;
      for(const f of files) {const file=join(this.clipsDir,f);const size=statSync(file).size;total+=size;}
      const bytes=this.settings.maxGb*1024**3;
      for(const f of files) {
        if(total<=bytes)break;
        // Never remove the actively-written newest segment.
        if(this.child && f===files.at(-1))continue;
        const file=join(this.clipsDir,f),size=statSync(file).size;
        await rm(file,{force:true});total-=size;
      }
    }catch(e){console.error('[dashcam] retention:',e);}
  }
  stop(){clearInterval(this.retention);this.stopRecording();}
}
