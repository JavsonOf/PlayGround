/* Core tycoon simulation: time, staff, projects, reviews, sales, research */
window.DT = window.DT || {};
DT.sim = (function(){
  const SAVE_KEY = 'devtycoon25d_v1';
  const rnd = (a,b)=>a+Math.random()*(b-a);
  const rndi = (a,b)=>Math.floor(rnd(a,b+1));
  const pick = arr=>arr[Math.floor(Math.random()*arr.length)];

  function newStaff(role, level){
    const D = Math.max(10, Math.min(99, rndi(25,60)+level*4+rndi(-8,12)));
    const T2 = Math.max(10, Math.min(99, rndi(25,60)+level*4+rndi(-8,12)));
    const S = rndi(30,90);
    return { id:'s'+Math.random().toString(36).slice(2,8), name:pick(DT.FIRST_NAMES)+' '+pick(DT.LAST_NAMES),
      role, design:D, tech:T2, speed:S, level, salary: Math.round((D+T2)*6 + level*900),
      xp:0, training:null, vacation:0, mood:rndi(70,100) };
  }
  function founder(){ const s=newStaff('dev',1); s.name='You (Founder)'; s.salary=2000; return s; }

  function fresh(diff){
    const cash = diff==='easy'?120000:diff==='hard'?40000:80000;
    return {
      started:true, gameOver:false, paused:false, speed:1,
      studio:'Pixel Forge', diff, cash, fans:0, rp:0, hype:0, rep:0,
      week:1, month:1, year:1, tickAcc:0,
      staff:[founder()], officeIdx:0, applicants:[],
      unlockedTopics:['fantasy','scifi','pirates','sports'],
      unlockedGenres:DT.GENRES.map(g=>g.id),
      researchDone:[], project:null, history:[], activeSales:[],
      marketingCD:0, contractCD:0, loans:0,
      stats:{earned:0, spent:0, bestScore:0, games:0},
      ledger:[], lastDelta:0, news:'',
    };
  }

  /* ---------- time ---------- */
  // 1 week = 2.6s at 1x
  function weekTick(s){
    s.week++;
    if(s.week>4){ s.week=1; s.month++; monthly(s); }
    if(s.month>12){ s.month=1; s.year++; yearly(s); }
    // research points from staff
    const rpGain = s.staff.reduce((a,st)=>a + (st.vacation>0?0:(st.design+st.tech)/45),0);
    s.rp = Math.round((s.rp + rpGain)*10)/10;
    // hype decay
    s.hype = Math.max(0, s.hype - rnd(1.5,3.5));
    // staff xp + salary sanity, vacations tick
    for(const st of s.staff){
      if(st.vacation>0){ st.vacation--; st.mood=Math.min(100,st.mood+12); }
      else { st.xp += st.training?2.4:1; st.mood=Math.max(30,st.mood-rnd(0,1.6)); }
      if(st.training){ trainTick(s,st); }
      if(st.xp>=20){ st.xp=0; st.level++; const up=rndi(2,6); st.design=Math.min(99,st.design+up); st.tech=Math.min(99,st.tech+up); st.salary=Math.round(st.salary*1.12+300); }
    }
    // applicants refresh
    if(s.week===1 || Math.random()<0.3) refreshApplicants(s);
    // project progress
    if(s.project) projectTick(s);
    // sales
    salesTick(s);
    // monthly handled separately; weekly costs
    const weeklyBurn = s.staff.reduce((a,st)=>a+st.salary/4,0);
    spend(s, weeklyBurn, 'Salaries', true);
    if(s.marketingCD>0) s.marketingCD--;
    if(s.contractCD>0) s.contractCD--;
    // news/platform unlocks
    checkEraNews(s);
    // game over
    if(s.cash<0 && s.activeSales.length===0 && !s.project){ /* grace */ }
    if(s.cash < -20000){ s.gameOver=true; }
    save(s);
  }
  function monthly(s){
    const rent = DT.OFFICES[s.officeIdx].rent;
    spend(s, rent, 'Office rent', true);
    if(s.loans>0){ const pay=Math.min(s.cash*0.2, s.loans); s.loans-=pay; spend(s,pay,'Loan repayment',true); }
  }
  function yearly(s){
    // platform market shifts + salary inflation
    for(const st of s.staff) st.salary=Math.round(st.salary*1.06);
    toastNews(s, `🎉 Year ${s.year} — new platforms & trends arrive!`);
  }
  function checkEraNews(s){
    const y=s.year;
    const notes={2:'📺 TES console launches! New platform available.',4:'🕹️ Super TES arrives — bigger audience!',5:'📱 GameGirl handheld is hot!',6:'💿 PlaySystem (CD!) changes everything.',9:'🤳 Pear Phone opens mobile gold rush.',12:'🥽 VR One: niche but premium prices!'};
    if(s.week===1&&s.month===1&&notes[y]) toastNews(s, notes[y]);
  }
  function toastNews(s,msg){ s.news=msg; DT.ui && DT.ui.toast(msg,'gold'); DT.audio && DT.audio.news(); }

  /* ---------- money ---------- */
  function earn(s, amt, label){ s.cash+=amt; s.stats.earned+=amt; s.lastDelta+=amt; pushLedger(s,'+ $'+fmt(amt)+' — '+label, amt); }
  function spend(s, amt, label, quiet){ s.cash-=amt; s.stats.spent+=amt; if(!quiet) s.lastDelta-=amt; else s.lastDelta-=amt; pushLedger(s,'− $'+fmt(amt)+' — '+label, -amt); }
  function pushLedger(s,txt,amt){ s.ledger.unshift({t:`Y${s.year} M${s.month} W${s.week}`, txt, amt}); s.ledger=s.ledger.slice(0,40); }
  function fmt(n){ n=Math.round(n); const a=Math.abs(n); if(a>=1e6) return (n/1e6).toFixed(2)+'M'; if(a>=1e3) return (n/1e3).toFixed(1)+'K'; return ''+n; }

  /* ---------- applicants ---------- */
  function refreshApplicants(s){
    const slots = DT.OFFICES[s.officeIdx].slots - s.staff.length;
    s.applicants=[];
    const n = Math.max(2, Math.min(4, 2+Math.floor(s.year/2)));
    for(let i=0;i<n;i++){
      const lvl = Math.max(1, Math.min(7, s.year + rndi(-1,1) + (s.rep/25|0)));
      const c = newStaff(pick(DT.STAFF_ROLES).id, Math.max(1,lvl));
      c.fee = Math.round(c.salary*0.8); // signing fee
      s.applicants.push(c);
    }
  }

  /* ---------- projects ---------- */
  function startProject(s, cfg){
    const size = DT.SIZES.find(x=>x.id===cfg.size);
    const plat = DT.PLATFORMS.find(p=>p.id===cfg.platform);
    const cost = Math.round(size.cost*plat.devCost + plat.license);
    if(s.cash < cost){ DT.ui.toast('Not enough cash! Try contract work first.','bad'); return false; }
    spend(s, cost, `New ${size.name}: ${cfg.name}`);
    // design/tech targets from genre + sliders
    const genre = DT.GENRES.find(g=>g.id===cfg.genre);
    s.project = { ...cfg, sizeId:size.id, price:size.price,
      phase:'concept', progress:0, need:size.weeks,
      designPts:0, techPts:0, bugs:0,
      designTarget: size.weeks*10*(0.5+cfg.sliders.design/100),
      techTarget: size.weeks*10*(0.5+cfg.sliders.tech/100),
      genreNeed:genre, hypeAtStart:s.hype, week:0 };
    s.hype = Math.min(100, s.hype + size.hype*0.4);
    return true;
  }
  function projectOutputPerWeek(s){
    let d=0,t=0;
    for(const st of s.staff){ if(st.vacation>0) continue;
      const eff = (st.speed/70) * (st.training?0.5:1) * (st.mood<45?0.75:1);
      d += (st.design/4.2)*eff; t += (st.tech/4.2)*eff;
    }
    // engine bonus
    let mult=1; for(const r of s.researchDone){ const def=DT.RESEARCH.find(x=>x.id===r); if(def&&def.bonus) mult+=def.bonus; }
    return {d:d*mult, t:t*mult};
  }
  function projectTick(s){
    const p=s.project; p.week++;
    const out = projectOutputPerWeek(s);
    if(p.phase==='concept'){ p.progress+= 100/1.2; if(p.progress>=100){p.phase='dev';p.progress=0;} }
    else if(p.phase==='dev'){
      p.designPts+=out.d; p.techPts+=out.t;
      let bugRate = 1.1 - (s.researchDone.includes('qa')?0.55:0);
      p.bugs += Math.max(0.2, rnd(0.4,1.6)*bugRate*(p.sizeId==='aaa'?1.5:1));
      p.progress = Math.min(100, 100*(p.designPts+p.techPts)/(p.designTarget+p.techTarget));
      DT.iso.bubble(pick(['⚙️','💻','🎨','🔊','☕']));
      if(p.progress>=100){ p.phase='polish'; p.progress=0; DT.ui.toast('🛠️ Development done — polish & fix bugs!','good'); DT.audio.done(); }
    }
    else if(p.phase==='polish'){
      // auto-fix by staff
      const fix = s.staff.length*rnd(0.8,1.6);
      p.bugs=Math.max(0,p.bugs-fix); p.progress+=100/2;
      if(p.progress>=100){ finishProject(s); }
    }
  }
  function comboBonus(genre, topic){
    const k=`${genre}|${topic}`;
    if(DT.GREAT_COMBOS.includes(k)) return 1.2;
    if(DT.GOOD_COMBOS.includes(k)) return 0.6;
    return 0;
  }
  function finishProject(s){
    const p=s.project;
    // quality 0..10
    const size = DT.SIZES.find(x=>x.id===p.sizeId);
    const plat = DT.PLATFORMS.find(x=>x.id===p.platform);
    const genre = DT.GENRES.find(g=>g.id===p.genre);
    const dRatio = Math.min(1.4, p.designPts/Math.max(1,p.designTarget));
    const tRatio = Math.min(1.4, p.techPts/Math.max(1,p.techTarget));
    // genre alignment: compare sliders to genre ideal
    const total = (p.sliders.design+p.sliders.tech)||1;
    const dShare = p.sliders.design/total*100, tShare=p.sliders.tech/total*100;
    const align = 1 - (Math.abs(dShare-genre.design)+Math.abs(tShare-genre.tech))/220;
    let quality = (dRatio*0.45+tRatio*0.45+align*0.5) * 5; // ~0..7
    quality += comboBonus(p.genre,p.topic);
    quality += (s.rep/60); // experienced studios slightly better
    let engBonus=0; for(const r of s.researchDone){const d=DT.RESEARCH.find(x=>x.id===r); if(d&&d.bonus) engBonus+=d.bonus*2;}
    quality += engBonus;
    quality -= Math.min(2.2, p.bugs*0.12);
    quality += rnd(-0.7,0.7);
    quality = Math.max(1, Math.min(10, quality));
    // reviews
    const scores = DT.REVIEWERS.map(()=> Math.max(1,Math.min(10, Math.round(quality + rnd(-1.2,1.2)))));
    const avg = scores.reduce((a,b)=>a+b,0)/scores.length;
    // sales model
    const platNow = platformShare(plat, s.year);
    let units = Math.pow(Math.max(1,avg),2.6)*140 * (0.5+platNow/50) * (size.price>30?0.6:size.price>15?0.85:1.2);
    units *= (1 + s.fans/9000 + p.hypeAtStart/120 + s.hype/200);
    units *= rnd(0.8,1.25);
    units = Math.round(units);
    const gross = units * size.price * 0.55; // platform cut
    const salesWeeks = p.sizeId==='small'?8:p.sizeId==='medium'?12:p.sizeId==='large'?16:22;
    s.activeSales.push({ name:p.name, unitsLeft:units, weeksLeft:salesWeeks, totalWeeks:salesWeeks, price:size.price, avg });
    const fanGain = Math.round(units*0.02*(avg/7) + size.hype*40);
    s.fans += fanGain;
    s.rep = Math.min(100, s.rep + avg*0.7);
    s.hype = Math.max(0, s.hype - 10);
    s.stats.games++; s.stats.bestScore=Math.max(s.stats.bestScore, avg);
    s.history.unshift({ name:p.name, genre:p.genre, topic:p.topic, platform:p.platform, size:p.sizeId,
      scores, avg:Math.round(avg*10)/10, units, gross:Math.round(gross), bugs:Math.round(p.bugs),
      when:`Y${s.year} M${s.month}`, price:size.price });
    s.history=s.history.slice(0,24);
    s.project=null;
    DT.ui.reviewModal(s.history[0]);
    DT.audio.fanfare(avg);
    save(s);
  }
  function platformShare(plat, year){
    if(year<plat.fromY||year>plat.toY) return 5;
    const mid=(plat.fromY+plat.toY)/2, span=(plat.toY-plat.fromY)/2||1;
    const curve = 1-Math.abs(year-mid)/ (span+1);
    return plat.share*(0.55+0.45*curve);
  }

  /* ---------- sales tick ---------- */
  function salesTick(s){
    let weekRevenue=0, weekUnits=0;
    for(const sale of s.activeSales){
      const decay = 1 - (1 - sale.weeksLeft/sale.totalWeeks)*0.75;
      const u = Math.round(sale.unitsLeft*0.16*decay + sale.unitsLeft/sale.weeksLeft*0.25);
      const sell = Math.min(sale.unitsLeft, Math.max(50,u));
      sale.unitsLeft-=sell; sale.weeksLeft--;
      const rev = sell*sale.price*0.55;
      weekRevenue+=rev; weekUnits+=sell;
    }
    s.activeSales = s.activeSales.filter(x=>x.weeksLeft>0 && x.unitsLeft>0);
    if(weekRevenue>0){
      earn(s, weekRevenue, `Sales (${fmt(weekUnits)} units)`);
      DT.iso.salePop(`+$${fmt(weekRevenue)} 💿`);
      if(s.activeSales.length===0) DT.ui.toast('📉 Sales run finished. Time for the next hit!','');
    }
  }

  /* ---------- contract work ---------- */
  function contract(s){
    if(s.project){ DT.ui.toast('Finish your game first!','bad'); return; }
    if(s.contractCD>0){ DT.ui.toast('No contracts right now… wait a week.','bad'); return; }
    const pay = Math.round(rnd(9000,17000) + s.staff.reduce((a,st)=>a+st.design+st.tech,0)*22);
    s.contractCD=2;
    earn(s, pay, 'Contract work');
    s.rep=Math.min(100,s.rep+0.5);
    DT.iso.bubble('💼');
    DT.ui.toast(`💼 Contract done: +$${fmt(pay)}`,'good'); DT.audio.cash();
    save(s);
  }

  /* ---------- marketing ---------- */
  function campaign(s, id){
    const m = DT.MARKETING.find(x=>x.id===id);
    if(s.marketingCD>0){ DT.ui.toast('Marketing team is busy (cooldown).','bad'); return; }
    if(m.need && !s.researchDone.includes(m.need)){ DT.ui.toast('Research required first!','bad'); return; }
    if(s.cash<m.cost){ DT.ui.toast('Not enough cash!','bad'); return; }
    spend(s, m.cost, m.name);
    s.hype=Math.min(100, s.hype+m.hype); s.marketingCD=2;
    DT.ui.toast(`📣 ${m.name}: +${m.hype} hype!`,'good'); DT.audio.cash();
    save(s);
  }

  /* ---------- research ---------- */
  function research(s, id){
    if(id.startsWith('topic:')){
      const tid=id.slice(6);
      const def=DT.TOPICS.find(t=>t.id===tid);
      if(s.rp<def.rp){DT.ui.toast('Need more 🔬 RP — keep working!','bad');return;}
      s.rp-=def.rp; s.unlockedTopics.push(tid);
      DT.ui.toast(`${def.icon} New topic: ${def.name}!`,'good'); DT.audio.done(); save(s); return;
    }
    const def=DT.RESEARCH.find(r=>r.id===id);
    if(!def||s.researchDone.includes(id)) return;
    if(s.rp<def.cost){DT.ui.toast('Need more 🔬 RP!','bad');return;}
    s.rp-=def.cost; s.researchDone.push(id);
    DT.ui.toast(`${def.icon} Researched: ${def.name}!`,'good'); DT.audio.done(); save(s);
  }
  function trainTick(s,st){
    // training target stored on staff.training = 'design'|'tech'|'speed'
    const boost = s.researchDone.includes('training')?2:1;
    if(st.training==='design') st.design=Math.min(99,st.design+0.55*boost);
    if(st.training==='tech') st.tech=Math.min(99,st.tech+0.55*boost);
    if(st.training==='speed') st.speed=Math.min(99,st.speed+0.6*boost);
  }

  /* ---------- hiring / office ---------- */
  function hire(s, idx){
    const c=s.applicants[idx]; if(!c) return;
    const slots=DT.OFFICES[s.officeIdx].slots;
    if(s.staff.length>=slots){DT.ui.toast('Office full! Move to a bigger office.','bad');return;}
    if(s.cash<c.fee){DT.ui.toast('Cannot afford signing fee!','bad');return;}
    spend(s,c.fee,`Hired ${c.name}`);
    s.staff.push({...c, fee:undefined}); s.applicants.splice(idx,1);
    DT.ui.toast(`🎉 ${c.name} joined the studio!`,'good'); DT.audio.done(); save(s);
  }
  function fire(s, idx){
    if(idx===0){DT.ui.toast('Cannot fire yourself, founder! 😅','bad');return;}
    const gone=s.staff.splice(idx,1)[0];
    DT.ui.toast(`👋 ${gone.name} left.`,''); save(s);
  }
  function moveOffice(s, idx){
    const o=DT.OFFICES[idx];
    if(idx<=s.officeIdx) return;
    if(s.cash<o.moveCost){DT.ui.toast('Not enough cash to move!','bad');return;}
    spend(s,o.moveCost,`Moved to ${o.name}`);
    s.officeIdx=idx;
    DT.ui.toast(`${o.icon} Welcome to ${o.name}!`,'good'); DT.audio.fanfare(8); save(s);
  }

  /* ---------- persistence ---------- */
  function save(s){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify(s)); }catch(e){} }
  function load(){ try{ const r=localStorage.getItem(SAVE_KEY); return r?JSON.parse(r):null; }catch(e){ return null; } }
  function wipe(){ try{localStorage.removeItem(SAVE_KEY);}catch(e){} }

  return { fresh, newStaff, weekTick, startProject, contract, campaign, research, hire, fire, moveOffice,
    earn, spend, fmt, save, load, wipe, platformShare, refreshApplicants, SAVE_KEY };
})();
