/* Tiny WebAudio bleeps — no assets needed */
window.DT = window.DT || {};
DT.audio = (function(){
  let ctx=null, on=true;
  function ac(){ if(!ctx){ try{ ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } if(ctx&&ctx.state==='suspended') ctx.resume(); return ctx; }
  function beep(f, t, dur, type, vol){
    if(!on) return; const c=ac(); if(!c) return;
    const o=c.createOscillator(), g=c.createGain();
    o.type=type||'square'; o.frequency.value=f; g.gain.value=vol||0.05;
    o.connect(g); g.connect(c.destination);
    const now=c.currentTime+t;
    g.gain.setValueAtTime(vol||0.05, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now+dur);
    o.start(now); o.stop(now+dur+0.02);
  }
  return {
    click(){ beep(660,0,0.08,'square',0.04); },
    cash(){ beep(880,0,0.1,'square',0.05); beep(1320,0.09,0.15,'square',0.05); },
    done(){ beep(520,0,0.12,'triangle',0.07); beep(780,0.1,0.15,'triangle',0.07); },
    news(){ beep(440,0,0.2,'sine',0.08); },
    fanfare(q){ const base=q>=7?[523,659,784,1046]:q>=5?[523,659,784]:[400,350,300];
      base.forEach((f,i)=>beep(f,i*0.12,0.2,'triangle',0.08)); },
    toggle(){ on=!on; return on; }, get enabled(){return on;}
  };
})();
/* Main: boot, game loop, wiring */
(function(){
  const $=id=>document.getElementById(id);
  let S=null, shownOver=false, lastHud=0;

  window.addEventListener('DOMContentLoaded', boot);
  function boot(){
    // canvas first (attract mode behind boot screen)
    DT.iso.init($('iso'), ()=>S);
    const saved=DT.sim.load();
    if(saved&&saved.started) $('btn-continue').classList.remove('hidden');
    let diff='normal';
    document.querySelectorAll('.diff').forEach(d=>d.onclick=()=>{
      document.querySelectorAll('.diff').forEach(x=>x.classList.remove('selected'));
      d.classList.add('selected'); diff=d.dataset.diff; DT.audio.click();
    });
    $('btn-start').onclick=()=>{ DT.audio.click(); startGame(diff, $('studio-name').value||'Pixel Forge'); };
    $('btn-continue').onclick=()=>{ DT.audio.click(); S=saved; afterLoad(); };
    // top buttons
    $('btn-speed').onclick=()=>{ if(!S)return; DT.audio.click();
      if(S.paused){S.paused=false;} else if(S.speed===1)S.speed=2; else if(S.speed===2)S.speed=4; else {S.paused=true;S.speed=1;}
      DT.ui.refresh(); };
    $('btn-sound').onclick=e=>{ const on=DT.audio.toggle(); e.currentTarget.textContent=on?'🔊':'🔇'; };
    $('btn-menu').onclick=()=>DT.ui.menuModal();
    $('zoom-in').onclick=()=>DT.iso.zoomBy(1.2);
    $('zoom-out').onclick=()=>DT.iso.zoomBy(1/1.2);
    $('btn-center').onclick=()=>DT.iso.center();
    // boot visible; still run loop with null state (attract)
    requestAnimationFrame(loop);
    setInterval(hudTick, 400);
  }

  function startGame(diff, name){
    S=DT.sim.fresh(diff); S.studio=(name||'Pixel Forge').slice(0,24);
    afterLoad();
    DT.ui.toast(`🎉 Welcome to ${S.studio}! Develop your first game!`,'gold');
    showHint('Tap 🕹️ Develop to make your first game!');
  }
  function afterLoad(){
    $('boot').classList.add('hidden');
    DT.ui.bind(S);
    DT.ui.refresh();
    // ensure applicants exist for hiring
    if(!S.applicants||!S.applicants.length) DT.sim.refreshApplicants(S);
    DT.sim.save(S);
    shownOver=false;
  }

  // hint bubble
  let hintT=null;
  function showHint(msg){ const h=$('hint-bubble'); h.textContent=msg; h.classList.remove('hidden');
    clearTimeout(hintT); hintT=setTimeout(()=>h.classList.add('hidden'), 6000); }

  // main loop: weeks advance
  let last=performance.now(), acc=0;
  const WEEK_MS=2600;
  function loop(now){
    const dt=Math.min(100, now-last); last=now;
    if(S&&S.started&&!S.gameOver&&!S.paused){
      acc+=dt*S.speed;
      S.lastDelta*=0.995; if(Math.abs(S.lastDelta)<50) S.lastDelta=0;
      while(acc>=WEEK_MS){ acc-=WEEK_MS; DT.sim.weekTick(S);
        if(S.gameOver&&!shownOver){ shownOver=true; DT.ui.gameOverModal(); }
      }
    }
    // canvas time-based anims run in iso.js
    requestAnimationFrame(loop);
  }
  function hudTick(){ if(S&&S.started){ DT.ui.refresh();
      // sales toast line
      const st=$('sales-toast');
      if(S.news){ st.textContent=S.news; st.classList.remove('hidden'); }
      else if(S.activeSales.length){ const t=S.activeSales[0];
        st.innerHTML=`💿 <b>${t.name}</b> selling… ${DT.sim.fmt(t.unitsLeft)} left`; st.classList.remove('hidden'); }
      else st.classList.add('hidden');
    } }
})();
