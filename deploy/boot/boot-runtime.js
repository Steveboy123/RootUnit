/* This code runs BOTH for the real file:// kiosk loader and the Settings live-preview iframe. */
(function(){'use strict';
  var stage=document.getElementById('stage'),mascot=document.getElementById('mascot'),status=document.getElementById('status');
  var title=document.getElementById('boot-title'), wallpaper=document.getElementById('wallpaper'),note=document.getElementById('timeout');
  var preview=location.pathname.indexOf('/api/boot-studio/preview')!==-1;
  var presets={neon:{bg:'#08040f',bg2:'#310c2f',accent:'#ff2a93',accent2:'#56d8ff'},glass:{bg:'#030b17',bg2:'#12385a',accent:'#74ddff',accent2:'#cf8bff'},matrix:{bg:'#010b05',bg2:'#063e24',accent:'#44ff88',accent2:'#18dcc7'},sunset:{bg:'#15070c',bg2:'#663019',accent:'#ff9a46',accent2:'#ff438e'},minimal:{bg:'#08090c',bg2:'#24272e',accent:'#eeeeee',accent2:'#9899a9'},
    hyperdrive:{bg:'#02040c',bg2:'#0b1f4a',accent:'#38e7ff',accent2:'#8b5cff'},vapor:{bg:'#12052e',bg2:'#4a0f5c',accent:'#ff2bd6',accent2:'#3ce8ff'},blueprint:{bg:'#061a33',bg2:'#0a2a5e',accent:'#7fe3ff',accent2:'#ffffff'},
    ember:{bg:'#0d0504',bg2:'#4a1608',accent:'#fb923c',accent2:'#ffd166'},plague:{bg:'#050206',bg2:'#3a0a2a',accent:'#ff2a93',accent2:'#c218ff'}};
  /* Every choice Boot Studio offers (packages/shared/src/boot.ts); bootStudio.test.ts keeps these lists and loading.html in step with it. */
  var BG=['solid','gradient','aurora','grid','image','stars','warp','mesh','synthsun'];
  var MOTION=['none','float','pulse','tilt','orbit','hologram','glitch','breathe','spin3d'];
  var LOADER=['bar','ring','dots','scanner','none','pulse','wave','segments','orbit','heartbeat'];
  var FONT=['wide','clean','mono','neon','glitch','outline','future'];
  var TRANSITION=['none','fade','zoom','slide','iris','warp','shutter'];
  function clamp(x,a,b){return Math.max(a,Math.min(b,Number(x)||0))}
  function imagePath(name,slot){
    if(slot==='mascot') return name==='custom'?'art/mascot.png':['original','transparent','armored'].includes(name)?'art/'+name+'.webp':'art/armored.webp';
    return 'art/background.png';
  }
  function apply(c){
    if(!c||typeof c!=='object')return;
    var p=c.preset==='custom'?null:presets[c.preset], primary=p?p.accent:c.accent,secondary=p?p.accent2:c.accent2;
    var hex=function(v,def){return /^#[0-9a-f]{6}$/i.test(v)?v:def};
    stage.style.setProperty('--bg',hex(p?p.bg:c.bgColor,'#08040f'));
    stage.style.setProperty('--bg2',hex(p?p.bg2:c.bgColor2,'#310c2f'));
    stage.style.setProperty('--accent',hex(primary,'#ff2a93'));
    stage.style.setProperty('--accent2',hex(secondary,'#56d8ff'));
    stage.style.setProperty('--glow',String(clamp(c.glow,0,100)/100));
    stage.style.setProperty('--posx',clamp(c.positionX,0,100)+'%');stage.style.setProperty('--posy',clamp(c.positionY,0,100)+'%');
    stage.style.setProperty('--size',clamp(c.size,10,90)+'vw');stage.style.setProperty('--opacity',String(clamp(c.opacity,0,100)/100));
    stage.style.setProperty('--mirror',c.mirror===true?'-1':'1');stage.style.setProperty('--speed',(7-clamp(c.motionSpeed,0,100)*.055).toFixed(2)+'s');
    stage.style.setProperty('--title-size',clamp(c.titleSize,14,55)+'px');stage.style.setProperty('--fade',String(clamp(c.dim,0,90)/100));
    stage.dataset.bg=BG.includes(c.bg)?c.bg:'aurora';
    stage.dataset.motion=MOTION.includes(c.motion)?c.motion:'float';
    stage.dataset.loader=LOADER.includes(c.loader)?c.loader:'bar';
    stage.dataset.font=FONT.includes(c.textStyle)?c.textStyle:'wide';
    stage.dataset.transition=TRANSITION.includes(c.transition)?c.transition:'fade';
    title.dataset.text=typeof c.title==='string'?c.title.slice(0,38):'HEAD UNIT';
    stage.dataset.transitionMs=clamp(c.transitionMs,0,1200);
    stage.classList.toggle('hide-mascot',c.showMascot===false);
    stage.classList.toggle('no-status',c.showStatus===false);
    stage.classList.toggle('no-particles',c.particles===false);
    title.textContent=typeof c.title==='string'?c.title.slice(0,38):'HEAD UNIT';
    status.textContent=typeof c.subtitle==='string'?c.subtitle.slice(0,72):'Starting system';
    stage.dataset.readyText=typeof c.readyText==='string'?c.readyText.slice(0,72):'Opening head unit';
    mascot.src=imagePath(c.image,'mascot');
    // Custom images may be JPEG/WebP. The loader picks the first available extension.
    function fallbackImg(el,stem,exts){var i=0;el.onerror=function(){if(++i<exts.length)el.src='art/'+stem+exts[i]};el.src='art/'+stem+exts[0]}
    if(c.image==='custom')fallbackImg(mascot,'mascot',['.png','.jpg','.webp']);
    if(c.bg==='image' || c.backgroundImage){
      var exts=['.png','.jpg','.webp'], ix=0,tryImage=new Image();
      tryImage.onload=function(){wallpaper.style.backgroundImage='url("'+tryImage.src+'")'};
      tryImage.onerror=function(){if(++ix<exts.length){tryImage.src='art/background'+exts[ix]}else{wallpaper.style.backgroundImage='none'}};
      tryImage.src='art/background'+exts[0];
    }
    window.__bootTheme=c;
  }
  apply(window.HEADUNIT_BOOT_CONFIG||{});
  if(preview){window.addEventListener('message',function(event){if(event.origin!==location.origin)return;if(event.data&&event.data.type==='headunit-boot-preview')apply(event.data.config)});return}
  var start=Date.now(),tick=0,target='http://127.0.0.1:8787/?kiosk=1';
  function poll(){
    tick++;if(tick>5)status.textContent='Loading dashboard';
    if(Date.now()-start>60000)note.hidden=false;
    var image=new Image(),settled=false;
    var timeout=setTimeout(function(){if(!settled){settled=true;retry()}},2200);
    function retry(){setTimeout(poll,850)}
    image.onload=function(){if(settled)return;settled=true;clearTimeout(timeout);status.textContent=stage.dataset.readyText;
      var wait=Number(stage.dataset.transitionMs)||0;
      if(stage.dataset.transition==='none'||wait===0)location.replace(target);
      else {stage.style.transitionDuration=wait+'ms';stage.style.setProperty('--leave',wait+'ms');stage.classList.add('is-leaving');setTimeout(function(){location.replace(target)},wait)};
    };
    image.onerror=function(){if(settled)return;settled=true;clearTimeout(timeout);retry()};
    image.src='http://127.0.0.1:8787/api/kiosk-ready.svg?d='+Date.now();
  }
  poll();
})();
