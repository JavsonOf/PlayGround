/* Isometric 2.5D office renderer — pure Canvas 2D, touch pan/zoom/tap */
window.DT = window.DT || {};
DT.iso = (function(){
  const T = { TW: 96, TH: 48, zoom: 1, ox: 0, oy: 0, camX: 0, camY: 0, t: 0 };
  let canvas, ctx, W=0, H=0, DPR=1;
  let hover = null, selected = -1, bubbles = [], floaters = [];
  let getState = () => null;

  function init(cv, stateFn){
    canvas = cv; ctx = cv.getContext('2d'); getState = stateFn;
    resize(); window.addEventListener('resize', resize);
    bindInput();
    requestAnimationFrame(frame);
  }
  function resize(){
    const r = canvas.parentElement.getBoundingClientRect();
    DPR = Math.min(2.5, window.devicePixelRatio||1);
    W = Math.max(50, r.width); H = Math.max(50, r.height);
    canvas.width = W*DPR; canvas.height = H*DPR;
    canvas.style.width = W+'px'; canvas.style.height = H+'px';
    if (!T.ox && !T.oy) center();
  }
  function center(){
    T.camX = 0; T.camY = 0;
  }
  function zoomBy(f){ T.zoom = Math.max(0.45, Math.min(2.2, T.zoom*f)); }
  function officeDef(s){ return DT.OFFICES[s.officeIdx]; }

  function isoXY(gx, gy){ // grid -> world
    return { x: (gx-gy)*T.TW/2, y: (gx+gy)*T.TH/2 };
  }
  function worldToScreen(wx, wy){
    return { x: W/2 + (wx - T.camX)*T.zoom, y: H/2 - 40 + (wy - T.camY)*T.zoom - 60 };
  }
  function screenToWorld(sx, sy){
    return { x: (sx - W/2)/T.zoom + T.camX, y: (sy - (H/2-40-60))/T.zoom + T.camY };
  }
  function worldToGrid(wx, wy){
    const gx = (wx/(T.TW/2) + wy/(T.TH/2))/2, gy = (wy/(T.TH/2) - wx/(T.TW/2))/2;
    return { gx, gy };
  }

  /* ---------- input: drag pan, pinch zoom, tap select ---------- */
  function bindInput(){
    const pts = new Map(); let moved=0, pinchD=0, lastMid=null;
    canvas.addEventListener('pointerdown', e=>{ canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId,{x:e.clientX,y:e.clientY}); moved=0; lastMid=null; });
    canvas.addEventListener('pointermove', e=>{
      if(!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId);
      const dx = e.clientX-p.x, dy = e.clientY-p.y;
      p.x=e.clientX; p.y=e.clientY;
      moved += Math.abs(dx)+Math.abs(dy);
      if(pts.size===1){ T.camX -= dx/T.zoom; T.camY -= dy/T.zoom; }
      else if(pts.size===2){
        const a=[...pts.values()];
        const mid={x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2};
        const d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);
        if(pinchD>0){ zoomBy(d/pinchD); }
        if(lastMid){ T.camX -= (mid.x-lastMid.x)/T.zoom; T.camY -= (mid.y-lastMid.y)/T.zoom; }
        pinchD=d; lastMid=mid;
      }
    });
    const up = e=>{
      const wasTap = moved<12 && pts.size===1;
      pts.delete(e.pointerId); pinchD=0; lastMid=null;
      if(wasTap) handleTap(e);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', e=>{pts.delete(e.pointerId);});
    canvas.addEventListener('wheel', e=>{ e.preventDefault(); zoomBy(e.deltaY<0?1.1:0.9); }, {passive:false});
  }
  function handleTap(e){
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX-r.left, sy = e.clientY-r.top;
    const s = getState(); if(!s) return;
    // hit test staff desks (reverse order)
    const desks = deskPositions(s);
    for(let i=desks.length-1;i>=0;i--){
      const w = isoXY(desks[i].gx, desks[i].gy);
      const sc = worldToScreen(w.x,w.y);
      if(Math.hypot(sc.x-sx, sc.y-sy-20*T.zoom) < 46*T.zoom){
        selected = i;
        DT.ui && DT.ui.staffCard(s.staff[i], i);
        blip(sc.x, sc.y-40, '💡');
        return;
      }
    }
    selected = -1;
  }

  function deskPositions(s){
    // fixed layout slots per office size, spread over grid
    const layouts = {
      5:[[1,1],[3,1],[1,3],[3,3],[2,2],[2,4],[4,2],[4,4]],
      6:[[1,1],[4,1],[1,4],[4,4],[2.5,2.5],[2,4],[4,2],[0,0]],
      7:[[1,1],[5,1],[1,5],[5,5],[3,3],[2,5],[5,2],[3,1]],
      8:[[1,1],[6,1],[1,6],[6,6],[3.5,3.5],[2,6],[6,2],[4,5]],
    };
    const g = officeDef(s).grid;
    const L = layouts[g]||layouts[6];
    return s.staff.map((st,i)=>({gx:L[i%L.length][0], gy:L[i%L.length][1], staff:st}));
  }

  function blip(x,y,txt){ floaters.push({x,y,txt,life:1}); }
  function bubble(txt){ const s=getState(); const d=deskPositions(s); if(!d.length) return;
    const i=Math.floor(Math.random()*d.length); const w=isoXY(d[i].gx,d[i].gy); const sc=worldToScreen(w.x,w.y);
    bubbles.push({x:sc.x,y:sc.y-70*T.zoom,txt,life:2.2}); }
  function salePop(txt){ const sc={x:W/2+(Math.random()*120-60), y:H*0.35}; floaters.push({x:sc.x,y:sc.y,txt,life:1.6,big:true}); }

  /* ---------- drawing helpers ---------- */
  function diamond(x,y,w,h,fill,stroke){
    ctx.beginPath(); ctx.moveTo(x,y-h/2); ctx.lineTo(x+w/2,y); ctx.lineTo(x,y+h/2); ctx.lineTo(x-w/2,y); ctx.closePath();
    ctx.fillStyle=fill; ctx.fill(); if(stroke){ctx.strokeStyle=stroke; ctx.lineWidth=1.5; ctx.stroke();}
  }
  function box(x, yBase, w, d, h, cTop, cL, cR){
    // isometric box: top diamond + left/right faces
    const zw = w*T.zoom, zh = h*T.zoom;
    const twh = T.TW*T.zoom, thh = T.TH*T.zoom;
    // top
    diamond(x, yBase-zh, twh*0.62, thh*0.62, cTop, 'rgba(0,0,0,.25)');
    // left face
    ctx.beginPath();
    ctx.moveTo(x-twh*0.31, yBase-zh); ctx.lineTo(x, yBase-zh+thh*0.31); ctx.lineTo(x, yBase+thh*0.31); ctx.lineTo(x-twh*0.31, yBase);
    ctx.closePath(); ctx.fillStyle=cL; ctx.fill(); ctx.strokeStyle='rgba(0,0,0,.25)'; ctx.stroke();
    // right face
    ctx.beginPath();
    ctx.moveTo(x+twh*0.31, yBase-zh); ctx.lineTo(x, yBase-zh+thh*0.31); ctx.lineTo(x, yBase+thh*0.31); ctx.lineTo(x+twh*0.31, yBase);
    ctx.closePath(); ctx.fillStyle=cR; ctx.fill(); ctx.stroke();
  }
  function shade(hex, f){
    const n=parseInt(hex.slice(1),16); let r=(n>>16)&255,g=(n>>8)&255,b=n&255;
    r=Math.min(255,Math.max(0,Math.round(r*f))); g=Math.min(255,Math.max(0,Math.round(g*f))); b=Math.min(255,Math.max(0,Math.round(b*f)));
    return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
  }

  function drawFloor(s, off){
    const def = officeDef(s), n = def.grid;
    for(let x=0;x<n;x++) for(let y=0;y<n;y++){
      const w=isoXY(x,y), sc=worldToScreen(w.x,w.y);
      if(sc.x<-80||sc.x>W+80||sc.y<-60||sc.y>H+60) continue;
      const alt=(x+y)%2===0;
      diamond(sc.x, sc.y, T.TW*T.zoom, T.TH*T.zoom, alt?def.floor:shade(def.floor,0.92), 'rgba(0,0,0,.18)');
    }
    // rug
    const c=isoXY((n-1)/2,(n-1)/2), rc=worldToScreen(c.x,c.y);
    diamond(rc.x, rc.y, T.TW*2.4*T.zoom, T.TH*2.4*T.zoom, 'rgba(255,211,77,.16)');
  }
  function drawWalls(s){
    const def=officeDef(s), n=def.grid;
    const z=T.zoom;
    // back walls: two quads along x= -0.5 edge and y=-0.5 edge
    const wallH = 90*z;
    const c00=worldToScreen(...Object.values(isoXY(-0.55,-0.55)));
    const c10=worldToScreen(...Object.values(isoXY(n-0.45,-0.55)));
    const c01=worldToScreen(...Object.values(isoXY(-0.55,n-0.45)));
    ctx.globalAlpha=0.96;
    // left-back wall (along x)
    ctx.beginPath(); ctx.moveTo(c00.x,c00.y); ctx.lineTo(c10.x,c10.y); ctx.lineTo(c10.x,c10.y-wallH); ctx.lineTo(c00.x,c00.y-wallH); ctx.closePath();
    ctx.fillStyle=shade(def.wall,1.05); ctx.fill(); ctx.strokeStyle='rgba(0,0,0,.3)'; ctx.stroke();
    // right-back wall (along y)
    ctx.beginPath(); ctx.moveTo(c00.x,c00.y); ctx.lineTo(c01.x,c01.y); ctx.lineTo(c01.x,c01.y-wallH); ctx.lineTo(c00.x,c00.y-wallH); ctx.closePath();
    ctx.fillStyle=shade(def.wall,0.8); ctx.fill(); ctx.stroke();
    // windows on walls
    ctx.fillStyle='rgba(140,200,255,.85)';
    for(let i=1;i<n-1;i+=2){
      const a=worldToScreen(...Object.values(isoXY(i,-0.55)));
      ctx.fillRect(a.x-14*z, a.y-wallH+18*z, 28*z, 34*z);
      ctx.strokeStyle='#223'; ctx.strokeRect(a.x-14*z, a.y-wallH+18*z, 28*z, 34*z);
      const b=worldToScreen(...Object.values(isoXY(-0.55,i)));
      ctx.fillRect(b.x-14*z, b.y-wallH+18*z, 28*z, 34*z);
      ctx.strokeRect(b.x-14*z, b.y-wallH+18*z, 28*z, 34*z);
    }
    // poster
    const p=worldToScreen(...Object.values(isoXY(n/2,-0.55)));
    ctx.fillStyle='#ffd34d'; ctx.fillRect(p.x-26*z,p.y-wallH+22*z,52*z,30*z);
    ctx.fillStyle='#141a2e'; ctx.font=`${Math.round(9*z)}px sans-serif`; ctx.textAlign='center';
    ctx.fillText((s.studio || 'STUDIO').slice(0,12), p.x, p.y-wallH+42*z);
    ctx.globalAlpha=1;
  }
  function drawDesk(sc, staff, i, s){
    const z=T.zoom;
    // shadow
    ctx.beginPath(); ctx.ellipse(sc.x, sc.y+8*z, 34*z, 14*z, 0, 0, Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,.3)'; ctx.fill();
    // desk box
    box(sc.x, sc.y, 1, 1, 26, '#8a6a4a', '#6e5238', '#7d5f42');
    // monitor
    const developing = s.project && s.project.phase!=='done';
    ctx.fillStyle='#1a2140'; ctx.fillRect(sc.x-13*z, sc.y-58*z, 26*z, 20*z);
    ctx.strokeStyle='#0a0e22'; ctx.strokeRect(sc.x-13*z, sc.y-58*z, 26*z, 20*z);
    // screen glow
    const hue = developing ? (Math.sin(T.t*3+i)*0.5+0.5) : 0.3;
    ctx.fillStyle = developing ? `rgba(93,242,201,${0.55+hue*0.4})` : 'rgba(90,162,255,.5)';
    ctx.fillRect(sc.x-11*z, sc.y-56*z, 22*z, 16*z);
    // code lines
    ctx.fillStyle='rgba(10,20,10,.6)';
    for(let l=0;l<3;l++) ctx.fillRect(sc.x-9*z, sc.y-53*z+l*5*z, (14-l*3)*z, 2*z);
    drawPerson(sc.x, sc.y+16*z, staff, i, z);
    if(selected===i){
      ctx.beginPath(); ctx.ellipse(sc.x, sc.y+8*z, 42*z, 20*z, 0, 0, Math.PI*2);
      ctx.strokeStyle='#ffd34d'; ctx.lineWidth=3; ctx.stroke();
    }
  }
  function drawPerson(x, y, st, i, z){
    const bob = Math.sin(T.t*2.2 + i*1.7)*2*z;
    const skin=['#ffd9b3','#f1b98a','#c98d5f','#8a5a3b'][i%4];
    const shirt=['#5aa2ff','#b78bff','#5df2c9','#ff9ecb','#ffd34d','#ff8a5c'][i%6];
    // chair
    ctx.fillStyle='#2b3560'; ctx.fillRect(x-12*z, y-14*z, 24*z, 14*z);
    // body
    ctx.fillStyle=shirt;
    ctx.beginPath(); ctx.arc(x, y-24*z+bob, 11*z, 0, Math.PI*2); ctx.fill();
    ctx.fillRect(x-11*z, y-24*z+bob, 22*z, 16*z);
    // head
    ctx.fillStyle=skin; ctx.beginPath(); ctx.arc(x, y-32*z+bob, 9*z, 0, Math.PI*2); ctx.fill();
    // hair
    ctx.fillStyle='#2a2438'; ctx.beginPath(); ctx.arc(x, y-35*z+bob, 9*z, Math.PI, 0); ctx.fill();
    // eyes
    ctx.fillStyle='#141a2e'; ctx.fillRect(x-4*z, y-32*z+bob, 2.5*z, 3*z); ctx.fillRect(x+2*z, y-32*z+bob, 2.5*z, 3*z);
  }
  function drawDecor(s){
    const def=officeDef(s), n=def.grid, z=T.zoom;
    const put=(gx,gy,emoji,size)=>{
      const w=isoXY(gx,gy), sc=worldToScreen(w.x,w.y);
      ctx.font=`${Math.round(size*z)}px serif`; ctx.textAlign='center'; ctx.textBaseline='alphabetic';
      ctx.fillText(emoji, sc.x, sc.y-8*z);
    };
    put(-0.1, n-0.6, '🌵', 30);
    put(n-0.6, -0.1, '📚', 28);
    if(s.officeIdx>=1) put(n-0.5, n-0.5, '🛋️', 34);
    if(s.officeIdx>=2){ put(0.2, 0.2, '🎯', 26); put(n-1.2, 0.6, '🏆', 26); }
    if(s.officeIdx>=3){ put(0.4, n-1.1, '🕹️', 30); put(n-1.1, n-1.6, '☕', 24); }
    // server rack glow
    if(s.researchDone.includes('graphics3d')){
      const w=isoXY(n-0.45, (n-1)/2), sc=worldToScreen(w.x,w.y);
      ctx.font=`${Math.round(30*z)}px serif`; ctx.textAlign='center'; ctx.fillText('🖥️', sc.x, sc.y-10*z);
    }
  }
  function drawDayNight(s){
    // subtle vignette + night tint based on week progress
    const g = ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*0.3,W/2,H/2,Math.max(W,H)*0.75);
    g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(5,8,20,.55)');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  }

  function frame(){
    T.t += 1/60;
    if(!canvas) return requestAnimationFrame(frame);
    ctx.setTransform(DPR,0,0,DPR,0,0);
    const s = getState();
    // bg
    const bg = ctx.createLinearGradient(0,0,0,H);
    bg.addColorStop(0,'#232c52'); bg.addColorStop(.6,'#161c38'); bg.addColorStop(1,'#0e1327');
    ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);
    if(s && !s.started){
      // attract mode: demo office
      drawIdleBackdrop();
    } else if(s){
      drawFloor(s); drawWalls(s); drawDecor(s);
      const desks = deskPositions(s);
      // painter order: sort by gx+gy
      const order = desks.map((d,i)=>({d,i,k:d.gx+d.gy})).sort((a,b)=>a.k-b.k);
      for(const o of order){
        const w=isoXY(o.d.gx,o.d.gy), sc=worldToScreen(w.x,w.y);
        drawDesk(sc, o.d.staff, o.i, s);
      }
      // project hologram in middle
      if(s.project && s.project.phase!=='done'){
        const def=officeDef(s), n=def.grid;
        const w=isoXY((n-1)/2,(n-1)/2), sc=worldToScreen(w.x,w.y);
        ctx.font=`${Math.round(26*T.zoom)}px serif`; ctx.textAlign='center';
        const icons={concept:'💭',dev:'⚙️',polish:'🐞',release:'🚀'};
        ctx.fillText(icons[s.project.phase]||'🎮', sc.x, sc.y-70*T.zoom + Math.sin(T.t*2)*5);
      }
    }
    // bubbles & floaters (screen space)
    bubbles = bubbles.filter(b=>b.life>0);
    for(const b of bubbles){ b.life-=1/60; b.y-=0.4;
      ctx.globalAlpha=Math.min(1,b.life); ctx.font='20px serif'; ctx.textAlign='center'; ctx.fillText(b.txt,b.x,b.y); ctx.globalAlpha=1; }
    floaters = floaters.filter(f=>f.life>0);
    for(const f of floaters){ f.life-=1/60; f.y-=0.6;
      ctx.globalAlpha=Math.min(1,f.life*1.4);
      ctx.font=(f.big?'bold 22px':'bold 15px')+' sans-serif'; ctx.textAlign='center';
      ctx.fillStyle='#ffd34d'; ctx.strokeStyle='rgba(0,0,0,.6)'; ctx.lineWidth=3;
      ctx.strokeText(f.txt,f.x,f.y); ctx.fillText(f.txt,f.x,f.y); ctx.globalAlpha=1; }
    requestAnimationFrame(frame);
  }
  function drawIdleBackdrop(){
    // simple demo floor for boot screen backdrop
    ctx.save(); ctx.globalAlpha=0.5;
    const n=5;
    for(let x=0;x<n;x++) for(let y=0;y<n;y++){
      const w=isoXY(x,y);
      const sc={x:W/2+(w.x)*T.zoom, y:H/2-40+(w.y)*T.zoom-100+((T.t*10)%48)};
      diamond(sc.x, sc.y, T.TW*T.zoom, T.TH*T.zoom, (x+y)%2?'#2b3560':'#343f73', 'rgba(0,0,0,.2)');
    }
    ctx.restore();
  }

  return { init, zoomBy, center, bubble, salePop, blip,
    get selected(){return selected;}, set selected(v){selected=v;},
    worldInfo(){ return {zoom:T.zoom}; }
  };
})();
