import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProjectionState } from '@headunit/shared';
import { aaView, AndroidAutoView } from './AndroidAuto';
const state=(over:Partial<ProjectionState>={}):ProjectionState=>({provider:'external',mode:'ondemand',running:false,status:'idle',...over});
const text=(html:string)=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
const render=(p:ProjectionState,usb?:{connected:boolean;phones:{label:string;port:string}[];receiverConfigured:boolean;detail:string;mode:string})=>
 text(renderToStaticMarkup(<AndroidAutoView p={p} cmd={()=>{}} usb={usb}/>));
describe('wired Android Auto projection',()=>{
 it('maps native receiver states',()=>{
  expect(aaView(state())).toBe('ready');
  expect(aaView(state({status:'starting'}))).toBe('starting');
  expect(aaView(state({status:'active'}))).toBe('running');
  expect(aaView(state({status:'error'}))).toBe('error');
  expect(aaView(state({mode:'resident',running:false}))).toBe('booting');
 });
 it('does not ask for ADB, developer mode or a phone hotspot',()=>{
  const output=render(state(),{mode:'usb-wired',connected:true,phones:[{label:'Samsung',port:'1-1'}],receiverConfigured:false,detail:'Receiver missing'});
  expect(output).toContain('Android Auto · Wired USB');
  expect(output).toContain('Samsung');
  expect(output).toContain('Receiver missing');
  expect(output).not.toContain('Pair once');
  expect(output).not.toContain('Wireless debugging');
 });
 it('explains how to install a wired native receiver',()=>{
  expect(render(state())).toContain('install-livi-wired.sh');
  expect(render(state())).toContain('PROJECTION_COMMAND');
 });
 it('offers return to dashboard from active session',()=>{
  expect(render(state({status:'active'}))).toContain('Back to dashboard');
 });
 it('lets you start only when both the phone and the receiver are there',()=>{
  const usb=(connected:boolean,receiverConfigured:boolean)=>({mode:'usb-wired',connected,phones:connected?[{label:'Pixel',port:'1-2'}]:[],receiverConfigured,detail:''});
  const startButton=(html:string)=>/<button[^>]*>(?:(?!<\/button>).)*Start USB Android Auto/s.exec(html)?.[0] ?? '';
  const html=(u:ReturnType<typeof usb>)=>renderToStaticMarkup(<AndroidAutoView p={state()} cmd={()=>{}} usb={u}/>);
  expect(startButton(html(usb(true,true)))).not.toContain('disabled');
  expect(startButton(html(usb(true,false)))).toContain('disabled');
  expect(startButton(html(usb(false,true)))).toContain('disabled');
  expect(startButton(html(usb(false,false)))).toContain('disabled');
  expect(text(html(usb(true,true)))).toContain('Ready to start');
  expect(text(html(usb(true,true)))).toContain('USB device detected');
  expect(text(html(usb(false,false)))).not.toContain('USB device detected');
 });
 it('shows the receiver’s own message when it failed, with a way to dismiss it',()=>{
  const out=render(state({status:'error',detail:'Receiver crashed (exit 3)'}));
  expect(out).toContain('Receiver crashed (exit 3)');
  expect(out).toContain('Dismiss');
 });
});
