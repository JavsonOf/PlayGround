/* UI layer: HUD, bottom sheet tabs, dev wizard, modals, toasts */
window.DT = window.DT || {};
DT.ui = (function(){
  let S = null; // state ref
  const $ = id=>document.getElementById(id);
  const el = (tag, cls, html)=>{ const d=document.createElement(tag); if(cls)d.className=cls; if(html!=null)d.innerHTML=html; return d; };
  const esc = s=>String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let sheetTab='develop';
  const pick=a=>a[Math.floor(Math.random()*a.length)];

  function bind(state){ S=state;
    document.querySelectorAll('#actionbar .act').forEach(b=>b.onclick=()=>openSheet(b.dataset.tab));
    $('sheet-close').onclick=closeSheet;
    $('sheet-handle').onclick=closeSheet;
    $('modal-close').onclick=closeModal;
    $('modal-veil').addEventListener('click', e=>{ if(e.target.id==='modal-veil') closeModal(); });
  }
  function refresh(){
    if(!S) return;
    $('hud-money').textContent='$'+DT.sim.fmt(S.cash);
    $('hud-money').style.color = S.cash<10000 ? '#ff8a9a' : '';
    $('hud-fans').textContent=fmtNum(S.fans);
    $('hud-rp').textContent=Math.floor(S.rp);
    $('hud-hype').textContent=Math.round(S.hype);
    $('hud-date').textContent=`Y${S.year} M${S.month} W${S.week}`;
    $('hud-delta').textContent = S.lastDelta!==0 ? (S.lastDelta>0?'+':'')+DT.sim.fmt(S.lastDelta) : '';
    $('hud-delta').className = S.lastDelta<0?'neg':'';
    const off=DT.OFFICES[S.officeIdx];
    $('office-name').textContent=`${off.icon} ${S.studio} — ${off.name}`;
    $('staff-count').textContent=`👥 ${S.staff.length}/${off.slots}`;
    $('speed-label').textContent = S.paused?'❚❚':(S.speed===1?'1×':S.speed===2?'2×':'4×');
    $('hud-speed-dot').className='dot'+(S.paused?' paused':S.speed>1?' fast':'');
    // project banner
    const pb=$('project-banner');
    if(S.project){ pb.classList.remove('hidden');
      $('pb-name').textContent=`🎮 ${S.project.name}`;
      $('pb-stage').textContent={concept:'💭 Concept',dev:'⚙️ Developing',polish:'🐞 Polishing'}[S.project.phase]||'';
      $('pb-fill').style.width=Math.round(S.project.progress)+'%';
      $('pb-pct').textContent=Math.round(S.project.progress)+'%';
      $('pb-bugs').textContent=S.project.phase==='dev'||S.project.phase==='polish'?`🐞 ${Math.round(S.project.bugs)} bugs`:'';
    } else if(S.activeSales.length){ pb.classList.remove('hidden');
      const t=S.activeSales[0];
      $('pb-name').textContent=`💿 ${t.name} on sale`;
      $('pb-stage').textContent=`${t.weeksLeft} wks left`;
      $('pb-fill').style.width=Math.round(100*(1-t.weeksLeft/t.totalWeeks))+'%';
      $('pb-pct').textContent=DT.sim.fmt(t.unitsLeft)+' units left';
      $('pb-bugs').textContent=`⭐ ${t.avg.toFixed(1)}`;
    } else pb.classList.add('hidden');
    if(!$('sheet').classList.contains('closed')) renderSheet();
  }
  const fmtNum=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':''+Math.floor(n);

  /* ---------- sheet ---------- */
  function openSheet(tab){ sheetTab=tab||sheetTab;
    $('sheet').classList.remove('closed');
    document.querySelectorAll('#actionbar .act').forEach(b=>b.classList.toggle('active',b.dataset.tab===sheetTab));
    renderSheet();
  }
  function closeSheet(){ $('sheet').classList.add('closed');
    document.querySelectorAll('#actionbar .act').forEach(b=>b.classList.remove('active')); }
  function isOpen(){ return !$('sheet').classList.contains('closed'); }

  function renderSheet(){
    const body=$('sheet-body'); body.innerHTML='';
    $('sheet-title').textContent={develop:'🕹️ Develop',staff:'🧑‍💻 Staff',research:'🔬 Research',market:'📣 Marketing',office:'🏢 Office'}[sheetTab];
    if(sheetTab==='develop') tabDevelop(body);
    if(sheetTab==='staff') tabStaff(body);
    if(sheetTab==='research') tabResearch(body);
    if(sheetTab==='market') tabMarket(body);
    if(sheetTab==='office') tabOffice(body);
  }

  function tabDevelop(body){
    if(S.project){
      const p=S.project;
      body.appendChild(card(`<h3>🎮 ${esc(p.name)}</h3>
        <div class="kv"><span>Topic / Genre</span><b>${ico('topic',p.topic)} ${esc(p.topic)} · ${ico('genre',p.genre)} ${esc(p.genre)}</b></div>
        <div class="kv"><span>Platform / Size</span><b>${ico('plat',p.platform)} ${esc(p.platform)} · ${esc(p.sizeId)}</b></div>
        <div class="kv"><span>Phase</span><b>${esc(p.phase)} — ${Math.round(p.progress)}%</b></div>
        <div class="bar g"><i style="width:${Math.round(p.progress)}%"></i></div>
        <div class="kv"><span>Design pts</span><b>${Math.round(p.designPts)} / ${Math.round(p.designTarget)}</b></div>
        <div class="kv"><span>Tech pts</span><b>${Math.round(p.techPts)} / ${Math.round(p.techTarget)}</b></div>
        <div class="kv"><span>Bugs</span><b>🐞 ${Math.round(p.bugs)}</b></div>
        <p>Your team is crunching in the isometric office above. Tap staff to inspect them!</p>`));
      const b=el('button','btn danger big','🗑️ Cancel project (sunk cost!)');
      b.onclick=()=>{ if(confirm('Cancel '+p.name+'? Money is lost.')){ S.project=null; DT.sim.save(S); refresh(); } };
      body.appendChild(b);
      if(S.history[0]) body.appendChild(historyCard());
      return;
    }
    const c=el('div','card');
    c.innerHTML=`<h3>🚀 New game</h3><p>Pick wisely: genre × topic combos score higher. Bigger games need more staff.</p>`;
    const btn=el('button','btn primary big','＋ Develop new game'); btn.onclick=devWizard;
    c.appendChild(btn);
    const c2=el('button','btn big','💼 Contract work (quick cash)'); c2.style.marginTop='8px';
    c2.onclick=()=>{ DT.sim.contract(S); refresh(); };
    c.appendChild(c2);
    body.appendChild(c);
    if(S.activeSales.length){
      const s=el('div','card'); s.innerHTML='<h3>💿 On the shelves</h3>';
      for(const t of S.activeSales) s.innerHTML+=`<div class="kv"><span>💿 ${esc(t.name)}</span><b>${DT.sim.fmt(t.unitsLeft)} left · ${t.weeksLeft}wk</b></div>`;
      body.appendChild(s);
    }
    if(S.history.length) body.appendChild(historyCard());
    else body.appendChild(card('<h3>📦 No games yet</h3><p>Ship your first Small game on PC or G64. Keep Design/Tech sliders near the genre ideal!</p>'));
  }
  function historyCard(){
    const d=el('div','card'); d.innerHTML='<h3>🏆 Release history</h3>';
    for(const h of S.history.slice(0,6)){
      d.innerHTML+=`<div class="review"><div class="mag">💿</div><div class="grow"><b>${esc(h.name)}</b><br/><small style="color:var(--dim)">${esc(h.when)} · ${esc(h.genre)}/${esc(h.topic)} · ${esc(h.platform)} · ${DT.sim.fmt(h.units)} units · $${DT.sim.fmt(h.gross)}</small></div><div class="score">${h.avg.toFixed(1)}</div></div>`;
    }
    return d;
  }
  const ico=(k,v)=>({topic:(DT.TOPICS.find(t=>t.id===v)||{}).icon||'🎲',genre:(DT.GENRES.find(t=>t.id===v)||{}).icon||'🎲',plat:(DT.PLATFORMS.find(t=>t.id===v)||{}).icon||'🖥️'}[k]||'');

  function tabStaff(body){
    const off=DT.OFFICES[S.officeIdx];
    body.appendChild(card(`<h3>👥 Team (${S.staff.length}/${off.slots})</h3><p>Salaries are paid weekly. Train staff to raise Design/Tech. Tired staff (low mood) work slower — send them on vacation!</p>`));
    S.staff.forEach((st,i)=>{
      const d=el('div','card');
      d.innerHTML=`<div class="row"><div style="font-size:30px">${st.role==='design'?'🎨':st.role==='artist'?'🖌️':st.role==='qa'?'🐞':'🧑‍💻'}</div>
        <div class="grow"><b>${esc(st.name)}</b> <span class="pill">Lv ${st.level}</span>${st.vacation>0?'<span class="pill hot">🏖️ '+st.vacation+'w</span>':''}${st.training?'<span class="pill good">🎓 '+esc(st.training)+'</span>':''}
        <br/><small style="color:var(--dim)">$${DT.sim.fmt(st.salary)}/mo · 😊 ${Math.round(st.mood)} · ⚡ ${st.speed}</small>
        <div class="kv"><span>🎨 Design ${st.design}</span></div><div class="bar"><i style="width:${st.design}%"></i></div>
        <div class="kv"><span>💻 Tech ${st.tech}</span></div><div class="bar y"><i style="width:${st.tech}%"></i></div></div></div>`;
      const row=el('div','row wrap'); row.style.marginTop='8px';
      const mk=(label,fn)=>{const b=el('button','btn small',label); b.onclick=fn; return b;};
      const tr=el('select'); tr.innerHTML=`<option value="">🎓 Train…</option><option value="design">🎨 Design</option><option value="tech">💻 Tech</option><option value="speed">⚡ Speed</option>`;
      tr.value=st.training||'';
      tr.onchange=()=>{ st.training=tr.value||null; DT.sim.save(S); refresh(); };
      tr.style.cssText='min-height:40px;border-radius:10px;background:#12172b;color:#fff;border:1px solid var(--line)';
      row.appendChild(tr);
      row.appendChild(mk(st.vacation>0?'🏖️ On break':'🏖️ Vacation',()=>{ st.vacation=st.vacation>0?0:2; st.training=null; DT.sim.save(S); refresh(); }));
      if(i>0) row.appendChild(mk('👋 Fire',()=>{ DT.sim.fire(S,i); refresh(); }));
      d.appendChild(row); body.appendChild(d);
    });
    const h=el('div','card'); h.innerHTML='<h3>📋 Applicants</h3><p>Hiring costs a signing fee. Better staff appears as your reputation grows.</p>';
    S.applicants.forEach((c,i)=>{
      const r=el('div','review');
      r.innerHTML=`<div class="mag">🧑‍💻</div><div class="grow"><b>${esc(c.name)}</b> <span class="pill">${esc(c.role)}</span><br/><small style="color:var(--dim)">🎨${c.design} 💻${c.tech} ⚡${c.speed} · Lv${c.level} · fee $${DT.sim.fmt(c.fee)} · $${DT.sim.fmt(c.salary)}/mo</small></div>`;
      const b=el('button','btn small primary','Hire'); b.onclick=()=>{ DT.sim.hire(S,i); refresh(); };
      r.appendChild(b); h.appendChild(r);
    });
    body.appendChild(h);
  }

  function tabResearch(body){
    body.appendChild(card(`<h3>🔬 Research (${Math.floor(S.rp)} RP)</h3><p>RP is earned every week by your team just by working. Unlock topics, engines and marketing.</p>`));
    // topics
    const t=el('div','card'); t.innerHTML='<h3>📚 Topics</h3>';
    for(const topic of DT.TOPICS){
      if(S.unlockedTopics.includes(topic.id)){ t.innerHTML+=`<span class="pill good">${topic.icon} ${topic.name}</span>`; continue; }
      const row=el('div','review');
      row.innerHTML=`<div class="mag">${topic.icon}</div><div class="grow"><b>${topic.name}</b><br/><small style="color:var(--dim)">${topic.rp} RP</small></div>`;
      const b=el('button','btn small','Unlock'); b.onclick=()=>{ DT.sim.research(S,'topic:'+topic.id); refresh(); };
      row.appendChild(b); t.appendChild(row);
    }
    body.appendChild(t);
    const r=el('div','card'); r.innerHTML='<h3>🧪 Lab</h3>';
    for(const res of DT.RESEARCH){
      if(S.researchDone.includes(res.id)){ r.innerHTML+=`<div class="kv"><span>${res.icon} ${res.name}</span><b>✅</b></div>`; continue; }
      const row=el('div','review');
      row.innerHTML=`<div class="mag">${res.icon}</div><div class="grow"><b>${res.name}</b><br/><small style="color:var(--dim)">${res.desc} · ${res.cost} RP</small></div>`;
      const b=el('button','btn small','Study'); b.onclick=()=>{ DT.sim.research(S,res.id); refresh(); };
      row.appendChild(b); r.appendChild(row);
    }
    body.appendChild(r);
  }

  function tabMarket(body){
    body.appendChild(card(`<h3>📣 Marketing</h3><p>Hype (🔥 ${Math.round(S.hype)}) boosts launch sales. Fans (⭐ ${fmtNum(S.fans)}) buy everything you ship.</p>`));
    for(const m of DT.MARKETING){
      const locked = m.need && !S.researchDone.includes(m.need);
      const d=el('div','card');
      d.innerHTML=`<h3>${m.icon} ${m.name} ${locked?'<span class="pill bad">needs research</span>':''}</h3><p>${m.desc} — +${m.hype} hype, $${DT.sim.fmt(m.cost)}${S.marketingCD>0?' · ⏳ cooldown':''}</p>`;
      const b=el('button','btn primary big',`${m.icon} Run — $${DT.sim.fmt(m.cost)}`);
      b.disabled=locked||S.marketingCD>0; b.onclick=()=>{ DT.sim.campaign(S,m.id); refresh(); };
      d.appendChild(b); body.appendChild(d);
    }
  }

  function tabOffice(body){
    body.appendChild(card(`<h3>🏢 Offices</h3><p>More desks = bigger games. Rent is monthly.</p>`));
    DT.OFFICES.forEach((o,i)=>{
      const cur=i===S.officeIdx, locked=i>S.officeIdx;
      const d=el('div','card');
      d.innerHTML=`<h3>${o.icon} ${o.name} ${cur?'<span class="pill good">HQ</span>':''}</h3>
        <p>${o.desc} · 🪑 ${o.slots} desks · rent $${DT.sim.fmt(o.rent)}/mo${o.moveCost?' · move $'+DT.sim.fmt(o.moveCost):''}</p>`;
      if(!cur&&locked){ const b=el('button','btn primary big',`Move — $${DT.sim.fmt(o.moveCost)}`); b.onclick=()=>{DT.sim.moveOffice(S,i);refresh();}; d.appendChild(b); }
      body.appendChild(d);
    });
    const l=el('div','card'); l.innerHTML='<h3>📒 Ledger</h3>';
    l.innerHTML+=`<table class="ledger">${S.ledger.slice(0,12).map(e=>`<tr><td>${esc(e.t)}<br/>${esc(e.txt)}</td><td>${e.amt>=0?'+':''}$${DT.sim.fmt(e.amt)}</td></tr>`).join('')||'<tr><td>No entries yet</td><td></td></tr>'}</table>`;
    body.appendChild(l);
    const danger=el('div','card');
    danger.innerHTML='<h3>⚙️ Save</h3>';
    const row=el('div','row');
    const b1=el('button','btn small','💾 Save'); b1.onclick=()=>{DT.sim.save(S); toast('Saved!','good');};
    const b2=el('button','btn small danger','🗑️ New game'); b2.onclick=()=>{ if(confirm('Restart? Save will be wiped.')){ DT.sim.wipe(); location.reload(); } };
    row.appendChild(b1); row.appendChild(b2); danger.appendChild(row); body.appendChild(danger);
  }

  function card(html){ return el('div','card',html); }

  /* ---------- dev wizard ---------- */
  function devWizard(){
    const wiz={ step:0, name:randName(), topic:S.unlockedTopics[0], genre:'rpg', platform:'pc', size:'small', sliders:{design:50,tech:50} };
    wizModal(wiz);
  }
  const randName=()=>`${pick(DT.GAME_NAME_A)} ${pick(DT.GAME_NAME_B)}`;
  function wizModal(w){
    const availPlats=DT.PLATFORMS.filter(p=>S.year>=p.fromY&&S.year<=p.toY);
    if(!availPlats.find(p=>p.id===w.platform)) w.platform=availPlats[0]?availPlats[0].id:'pc';
    let html='';
    if(w.step===0) html=`<div class="card"><h3>1/4 · Name & size</h3>
      <label style="font-size:13px;color:var(--dim)">Game title</label>
      <div class="row"><input id="w-name" value="${esc(w.name)}" maxlength="28"/><button class="btn small" id="w-rand">🎲</button></div>
      <div class="grid2" style="margin-top:8px">${DT.SIZES.map(s=>{
        const need = s.id==='medium'&&S.staff.length<2 || s.id==='large'&&(S.staff.length<4||!S.researchDone.includes('graphics3d')) || s.id==='aaa'&&(S.staff.length<6||!S.researchDone.includes('aaa'));
        return `<div class="pick ${w.size===s.id?'selected':''}" data-size="${s.id}"><b>${s.icon} ${s.name}</b><small>$${DT.sim.fmt(s.cost)}+ · ${s.weeks}w · ${s.needStaff}+ staff<br/>${s.desc}</small>${need?'<br/><small style="color:#ff8a9a">⚠️ requirements not met</small>':''}</div>`;}).join('')}</div></div>`;
    if(w.step===1) html=`<div class="card"><h3>2/4 · Topic & genre</h3><p>Some combos are magic: <span class="pill hot">RPG×Fantasy</span><span class="pill hot">Strategy×History</span><span class="pill hot">Sim×Sports</span> — experiment!</p>
      <b style="font-size:13px">Topic</b><div class="row wrap" style="margin:6px 0">${S.unlockedTopics.map(t=>{const d=DT.TOPICS.find(x=>x.id===t);return `<div class="pick ${w.topic===t?'selected':''}" data-topic="${t}" style="flex:1;min-width:100px;text-align:center"><b>${d.icon} ${d.name}</b></div>`;}).join('')}</div>
      <b style="font-size:13px">Genre (ideal D/T mix)</b><div class="grid2" style="margin-top:6px">${DT.GENRES.map(g=>`<div class="pick ${w.genre===g.id?'selected':''}" data-genre="${g.id}"><b>${g.icon} ${g.name}</b><small>${g.desc}<br/>🎨${g.design} / 💻${g.tech}</small></div>`).join('')}</div></div>`;
    if(w.step===2) html=`<div class="card"><h3>3/4 · Platform</h3>
      ${availPlats.map(p=>{const share=DT.sim.platformShare(p,S.year);return `<div class="pick ${w.platform===p.id?'selected':''}" data-plat="${p.id}" style="margin-bottom:6px"><b>${p.icon} ${p.name}</b> <span class="pill ${share>40?'hot':''}">${Math.round(share)}% market</span><small>License $${DT.sim.fmt(p.license)} · 👥 ${p.audience}${S.year>p.toY-1?' · ⚠️ fading!':''}</small></div>`;}).join('')}</div>`;
    if(w.step===3){ const g=DT.GENRES.find(x=>x.id===w.genre);
      html=`<div class="card"><h3>4/4 · Focus sliders</h3><p>Match the genre ideal: 🎨 ${g.design} / 💻 ${g.tech}. Total effort is fixed — slide wisely.</p>
      <label>🎨 Design focus: <b id="w-dv">${w.sliders.design}</b></label><input type="range" id="w-d" min="10" max="90" value="${w.sliders.design}"/>
      <label>💻 Tech focus: <b id="w-tv">${w.sliders.tech}</b></label><input type="range" id="w-t" min="10" max="90" value="${w.sliders.tech}"/>
      <div class="kv"><span>Est. cost</span><b id="w-cost"></b></div><div class="kv"><span>Combo hint</span><b id="w-combo"></b></div></div>`; }
    html+=`<div class="row"><button class="btn ghost" id="w-back">← Back</button><div class="grow"></div><button class="btn primary" id="w-next">${w.step===3?'🚀 Start development!':'Next →'}</button></div>`;
    openModal(`🕹️ New game <small style="color:var(--dim)">step ${w.step+1}/4</small>`, html);
    const q=s=>document.querySelector(s);
    const nm=q('#w-name'); if(nm) nm.oninput=()=>w.name=nm.value||'Untitled';
    const rbtn=q('#w-rand'); if(rbtn) rbtn.onclick=()=>{ w.name=randName(); q('#w-name').value=w.name; };
    document.querySelectorAll('[data-size]').forEach(d=>d.onclick=()=>{w.size=d.dataset.size; wizModal(w);});
    document.querySelectorAll('[data-topic]').forEach(d=>d.onclick=()=>{w.topic=d.dataset.topic; wizModal(w);});
    document.querySelectorAll('[data-genre]').forEach(d=>d.onclick=()=>{w.genre=d.dataset.genre; wizModal(w);});
    document.querySelectorAll('[data-plat]').forEach(d=>d.onclick=()=>{w.platform=d.dataset.plat; wizModal(w);});
    const dd=q('#w-d'), tt=q('#w-t');
    if(dd){ const sync=()=>{ w.sliders.design=+dd.value; w.sliders.tech=+tt.value; q('#w-dv').textContent=dd.value; q('#w-tv').textContent=tt.value; costHint(w); };
      dd.oninput=sync; tt.oninput=sync; costHint(w); }
    q('#w-back').onclick=()=>{ if(w.step===0) closeModal(); else {w.step--; wizModal(w);} };
    q('#w-next').onclick=()=>{
      if(w.step===0 && w.size!=='small'){
        if(w.size==='medium'&&S.staff.length<2 && !confirm('Medium games want 2+ staff. Continue anyway?')) return;
        if(w.size==='large'&&!S.researchDone.includes('graphics3d') && !confirm('Large games need 3D Graphics research. Continue anyway (quality penalty)?')) return;
      }
      if(w.step<3){ w.step++; wizModal(w); }
      else{
        if(!w.name.trim()) w.name='Untitled';
        if(DT.sim.startProject(S,{name:w.name.trim(),topic:w.topic,genre:w.genre,platform:w.platform,size:w.size,sliders:{...w.sliders}})){
          closeModal(); closeSheet(); DT.audio.click(); toast(`🚀 ${w.name} entered development!`,'good'); refresh();
        } else wizModal(w);
      }
    };
  }
  function costHint(w){
    const size=DT.SIZES.find(x=>x.id===w.size), plat=DT.PLATFORMS.find(p=>p.id===w.platform);
    const c=document.querySelector('#w-cost'); if(c) c.textContent='$'+DT.sim.fmt(size.cost*plat.devCost+plat.license);
    const k=`${w.genre}|${w.topic}`;
    const cb=document.querySelector('#w-combo');
    if(cb) cb.textContent = DT.GREAT_COMBOS.includes(k)?'✨ GREAT combo!':DT.GOOD_COMBOS.includes(k)?'👍 Good combo':'🧪 Untested…';
  }

  /* ---------- modals ---------- */
  function openModal(title, html){ $('modal-title').innerHTML=title; $('modal-body').innerHTML=html;
    $('modal-veil').classList.remove('hidden'); }
  function closeModal(){ $('modal-veil').classList.add('hidden'); }
  function staffCard(st, idx){
    if(!st) return;
    openModal(`🧑‍💻 ${esc(st.name)}`, `<div class="card">
      <div class="kv"><span>Role / Level</span><b>${esc(st.role)} · Lv ${st.level}</b></div>
      <div class="kv"><span>Salary</span><b>$${DT.sim.fmt(st.salary)}/mo</b></div>
      <div class="kv"><span>Mood / Speed</span><b>😊 ${Math.round(st.mood)} · ⚡ ${st.speed}</b></div>
      <div class="kv"><span>🎨 Design</span><b>${st.design}</b></div><div class="bar"><i style="width:${st.design}%"></i></div>
      <div class="kv"><span>💻 Tech</span><b>${st.tech}</b></div><div class="bar y"><i style="width:${st.tech}%"></i></div>
      ${st.training?`<p>🎓 Training: ${esc(st.training)}</p>`:''}${st.vacation>0?`<p>🏖️ Vacation: ${st.vacation} weeks</p>`:''}</div>
      <div class="row"><button class="btn" id="m-staff">Open Staff tab</button><div class="grow"></div><button class="btn primary" id="m-ok">OK</button></div>`);
    document.getElementById('m-ok').onclick=closeModal;
    document.getElementById('m-staff').onclick=()=>{ closeModal(); openSheet('staff'); };
  }
  function reviewModal(h){
    const stars='★'.repeat(Math.round(h.avg))+'☆'.repeat(10-Math.round(h.avg));
    openModal('⭐ Reviews are in!', `<div style="text-align:center"><div style="font-size:44px">${h.avg>=8?'🏆':h.avg>=6?'🎉':h.avg>=4?'😐':'💩'}</div>
      <h2 style="margin:4px 0">“${esc(h.name)}”</h2><div class="stars">${stars}</div>
      <div class="score">${h.avg.toFixed(1)} / 10</div>
      <p style="color:var(--dim)">${h.avg>=8?'A certified HIT! Fans incoming!':h.avg>=6?'Solid game. Good money.':h.avg>=4?'Mediocre… check your combos & sliders.':'Ouch. Research, train staff, fix bugs!'}</p></div>
      ${DT.REVIEWERS.map((r,i)=>`<div class="review"><div class="mag">${r.i}</div><div class="grow"><b>${r.n}</b></div><div class="score">${h.scores[i]}</div></div>`).join('')}
      <div class="kv"><span>Projected units</span><b>${DT.sim.fmt(h.units)}</b></div>
      <div class="kv"><span>Est. revenue</span><b>$${DT.sim.fmt(h.gross)}</b></div>
      <button class="btn primary big" id="m-ok2">💰 Collect & continue</button>`);
    document.getElementById('m-ok2').onclick=()=>{ closeModal(); refresh(); };
  }
  function gameOverModal(){
    openModal('💸 Bankrupt!', `<div class="gameover"><div class="big">📦</div>
      <h2>${esc(S.studio)} closed after ${S.stats.games} games…</h2>
      <p style="color:var(--dim)">Best score ${S.stats.bestScore.toFixed(1)} · 👥 ${fmtNum(S.fans)} fans · 💰 $${DT.sim.fmt(S.stats.earned)} earned</p>
      ${S.history[0]?`<p>Last hit: “${esc(S.history[0].name)}” (${S.history[0].avg.toFixed(1)}/10)</p>`:''}
      <button class="btn primary big" id="m-again">🔄 Found new studio</button></div>`);
    document.getElementById('m-again').onclick=()=>{ DT.sim.wipe(); location.reload(); };
  }
  function menuModal(){
    openModal('☰ Menu', `<div class="card"><h3>${esc(S.studio)}</h3>
      <div class="kv"><span>Games shipped</span><b>${S.stats.games}</b></div>
      <div class="kv"><span>Best score</span><b>${S.stats.bestScore.toFixed(1)}</b></div>
      <div class="kv"><span>Earned / spent</span><b>$${DT.sim.fmt(S.stats.earned)} / $${DT.sim.fmt(S.stats.spent)}</b></div></div>
      <button class="btn big" id="m-help">❓ How to play</button>
      <div style="height:8px"></div>
      <button class="btn big danger" id="m-reset">🗑️ Restart studio</button>`);
    document.getElementById('m-help').onclick=helpModal;
    document.getElementById('m-reset').onclick=()=>{ if(confirm('Wipe save and restart?')){DT.sim.wipe(); location.reload();} };
  }
  function helpModal(){
    openModal('❓ How to play', `<div class="card"><p><b>1.</b> 🕹️ Develop → pick topic/genre/platform, match sliders to the genre ideal.<br/>
      <b>2.</b> ⚙️ Your isometric team codes automatically. Fix bugs in polish.<br/>
      <b>3.</b> ⭐ Reviews → sales over weeks. Hype & fans multiply sales.<br/>
      <b>4.</b> 💼 Contract work = emergency cash. 🔬 RP unlocks topics/engines.<br/>
      <b>5.</b> 🧑‍💻 Hire & train. 🏢 Move office for more desks.<br/>
      <b>6.</b> 💸 Don't go below −$20K!</p>
      <p>Combos to try: RPG×Fantasy, Adventure×Pirates, Strategy×History, Sim×Sports, Action×Superheroes, RPG×Cyberpunk.</p></div>
      <button class="btn primary big" id="m-ok3">Got it!</button>`);
    document.getElementById('m-ok3').onclick=closeModal;
  }

  /* ---------- toasts ---------- */
  function toast(msg, kind){
    const t=el('div','toast '+(kind||''),msg);
    $('toasts').appendChild(t);
    setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .4s'; setTimeout(()=>t.remove(),400); }, 3400);
  }

  return { bind, refresh, openSheet, closeSheet, isOpen, toast, staffCard, reviewModal, gameOverModal, menuModal, helpModal,
    openModal, closeModal, get tab(){return sheetTab;} };
})();
