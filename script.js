const REGIME_COLOR = {trending:'#22c55e', mean_reverting:'#3b82f6', high_vol:'#a855f7', shock:'#ef4444'};
const REGIME_NAME = {trending:'Trending', mean_reverting:'Mean Reverting', high_vol:'High Volatility', shock:'Shock'};

const ids = ['trend','meanrev','vol','shockp','shockm','persist','trans','len','cap','ma','sl','tp','ps'];
const el = {}; ids.forEach(id=>el[id]=document.getElementById(id));

function fmtVal(id,v){
  if(id==='len') return Math.round(v).toLocaleString();
  if(id==='cap') return Math.round(v).toLocaleString();
  if(id==='ma') return Math.round(v);
  if(id==='ps') return Math.round(v);
  if(id==='sl'||id==='tp') return (+v).toFixed(1);
  return (+v).toFixed(2);
}
const labelMap = {trend:'v_trend',meanrev:'v_meanrev',vol:'v_vol',shockp:'v_shockp',shockm:'v_shockm',
  persist:'v_persist',trans:'v_trans',len:'v_len',cap:'v_cap',ma:'v_ma',sl:'v_sl',tp:'v_tp',ps:'v_ps'};

function syncLabels(){
  ids.forEach(id=>{document.getElementById(labelMap[id]).textContent = fmtVal(id, el[id].value);});
  document.getElementById('maLbl1').textContent = el.ma.value;
  document.getElementById('maLbl2').textContent = el.ma.value;
}

// ---------- RNG ----------
function randNormal(){
  let u=0,v=0; while(u===0)u=Math.random(); while(v===0)v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}

// ---------- Regime sequence ----------
function buildRegimes(n, persistence, transProb){
  const avgDur = 40 + persistence*460; // 40..500 periods
  const order = ['trending','mean_reverting','high_vol','shock'];
  let segs = []; let t=0; let prevIdx = -1;
  while(t<n){
    let dur = Math.max(15, Math.round(-avgDur*Math.log(1-Math.random())));
    dur = Math.min(dur, n-t);
    let idx;
    if(prevIdx===-1){ idx = Math.floor(Math.random()*3); } // start away from shock
    else if(Math.random() < transProb){
      idx = Math.floor(Math.random()*order.length);
      if(idx===3 && Math.random()>0.35) idx = Math.floor(Math.random()*3); // shock rarer
    } else { idx = prevIdx; }
    segs.push({regime:order[idx], start:t, end:t+dur});
    t+=dur; prevIdx=idx;
  }
  return segs;
}
function regimeArray(n,segs){
  const arr = new Array(n);
  segs.forEach(s=>{for(let i=s.start;i<s.end && i<n;i++) arr[i]=s.regime;});
  return arr;
}

// ---------- Market generator ----------
function genMarket(n, regs, p){
  const prices = new Array(n); prices[0]=100;
  let ref = 100;
  const baseVol = 0.003 + p.vol*0.012;
  for(let t=1;t<n;t++){
    const r = regs[t];
    let drift=0, volMult=1, jump=0;
    if(r==='trending'){ drift = p.trend*0.0009; volMult=1; }
    else if(r==='mean_reverting'){ drift = p.meanrev*0.5*((ref-prices[t-1])/prices[t-1]); volMult=0.8; }
    else if(r==='high_vol'){ drift = (p.trend-0.5)*0.0003; volMult=2.2; }
    else if(r==='shock'){ volMult=1.6;
      if(Math.random() < p.shockp) jump = (Math.random()<0.5?-1:1) * p.shockm * (0.5+Math.random());
    }
    const noise = randNormal()*baseVol*volMult;
    let px = prices[t-1]*(1+drift+noise+jump);
    prices[t] = Math.max(1, px);
    ref = ref*0.99 + prices[t]*0.01;
  }
  return prices;
}

// ---------- Strategy backtest ----------
function movingAvg(prices, period){
  const ma = new Array(prices.length).fill(null);
  let sum=0;
  for(let i=0;i<prices.length;i++){
    sum+=prices[i];
    if(i>=period) sum-=prices[i-period];
    if(i>=period-1) ma[i]=sum/period;
  }
  return ma;
}

function backtest(prices, ma, cap0, slPct, tpPct, posPct){
  const n=prices.length;
  const equity = new Array(n).fill(cap0);
  let cash = cap0, shares=0, entryPrice=0, inPos=false;
  const trades = [];
  let cur = null;
  for(let i=1;i<n;i++){
    if(ma[i]!=null && ma[i-1]!=null){
      const crossUp = prices[i-1]<=ma[i-1] && prices[i]>ma[i];
      const crossDown = prices[i-1]>=ma[i-1] && prices[i]<ma[i];
      if(!inPos && crossUp){
        const alloc = cash*(posPct/100);
        shares = alloc/prices[i]; cash-=alloc; entryPrice=prices[i]; inPos=true;
        cur = {entryIdx:i, entryPrice:prices[i], shares};
      } else if(inPos){
        const chg = (prices[i]-entryPrice)/entryPrice;
        const hitSL = chg <= -slPct/100;
        const hitTP = chg >= tpPct/100;
        if(crossDown || hitSL || hitTP){
          cash += shares*prices[i];
          cur.exitIdx=i; cur.exitPrice=prices[i]; cur.pnlPct=chg*100; cur.pnl = shares*(prices[i]-entryPrice);
          trades.push(cur); cur=null; shares=0; inPos=false;
        }
      }
    }
    equity[i] = cash + shares*prices[i];
  }
  if(inPos){ cash += shares*prices[n-1]; equity[n-1]=cash;
    cur.exitIdx=n-1; cur.exitPrice=prices[n-1]; cur.pnlPct=((prices[n-1]-entryPrice)/entryPrice)*100;
    cur.pnl = shares*(prices[n-1]-entryPrice); trades.push(cur); }
  return {equity, trades};
}

function metricsFor(equity, trades, cap0){
  const n=equity.length;
  const finalCap = equity[n-1];
  const totalReturn = (finalCap-cap0)/cap0*100;
  let peak=equity[0], maxDD=0;
  const rets=[];
  for(let i=1;i<n;i++){
    peak=Math.max(peak,equity[i]);
    maxDD=Math.min(maxDD, (equity[i]-peak)/peak);
    rets.push((equity[i]-equity[i-1])/equity[i-1]);
  }
  const meanR = rets.reduce((a,b)=>a+b,0)/rets.length || 0;
  const sd = Math.sqrt(rets.reduce((a,b)=>a+(b-meanR)**2,0)/rets.length) || 1e-9;
  const sharpe = (meanR/sd)*Math.sqrt(252);
  const wins = trades.filter(t=>t.pnl>0), losses = trades.filter(t=>t.pnl<=0);
  const winRate = trades.length? wins.length/trades.length*100 : 0;
  const grossWin = wins.reduce((a,t)=>a+t.pnl,0), grossLoss = Math.abs(losses.reduce((a,t)=>a+t.pnl,0));
  const profitFactor = grossLoss>0 ? grossWin/grossLoss : (grossWin>0?Infinity:0);
  const avgWin = wins.length? wins.reduce((a,t)=>a+t.pnlPct,0)/wins.length : 0;
  const avgLoss = losses.length? losses.reduce((a,t)=>a+t.pnlPct,0)/losses.length : 0;
  return {finalCap, totalReturn, maxDD:maxDD*100, sharpe, trades:trades.length, winRate, profitFactor, avgWin, avgLoss, wins:wins.length, losses:losses.length};
}

function regimePerf(segs, equity, trades){
  return segs.reduce((acc,s)=>{
    const key = s.regime;
    if(!acc[key]) acc[key]={regime:key,duration:0,startEq:null,endEq:null,minEq:Infinity,peakEq:-Infinity,trades:0};
    const o=acc[key];
    o.duration += (Math.min(s.end,equity.length)-s.start);
    for(let i=s.start;i<Math.min(s.end,equity.length);i++){
      if(o.startEq===null) o.startEq=equity[i];
      o.endEq=equity[i];
      o.peakEq=Math.max(o.peakEq,equity[i]);
      o.minEq=Math.min(o.minEq,equity[i]);
    }
    o.trades += trades.filter(t=>t.entryIdx>=s.start && t.entryIdx<s.end).length;
    return acc;
  },{});
}

// ---------- Drawing ----------
function setupCanvas(cv){
  const dpr = window.devicePixelRatio||1;
  const w = cv.clientWidth, h = cv.clientHeight || cv.height;
  cv.width = w*dpr; cv.height = h*dpr;
  const ctx = cv.getContext('2d'); ctx.scale(dpr,dpr);
  return {ctx,w,h};
}

let view={a:0,b:1}, lastDraw=null;
function viewRange(n){ const s=Math.max(0,Math.floor(view.a*(n-1))); return [s, Math.min(n-1,Math.max(s+10,Math.ceil(view.b*(n-1))))]; }
function redraw(){ if(!lastDraw) return; drawMarketChart(lastDraw.prices,lastDraw.segs); drawEquityChart(lastDraw.equity,lastDraw.buyHold); }

function drawMarketChart(prices, segs){
  const cv = document.getElementById('marketChart');
  const {ctx,w,h} = setupCanvas(cv);
  ctx.clearRect(0,0,w,h);
  const padL=44,padR=10,padT=26,padB=22, n=prices.length, [s0,e0]=viewRange(n);
  const vis=prices.slice(s0,e0+1), min=Math.min(...vis), max=Math.max(...vis);
  const pad=(max-min)*0.08||1, y0=min-pad, y1=max+pad;
  const x = i => padL + ((i-s0)/(e0-s0))*(w-padL-padR);
  const y = v => padT + (1-(v-y0)/(y1-y0))*(h-padT-padB);
  const dec=(y1-y0)<10?2:(y1-y0)<50?1:0;
  ctx.strokeStyle='#1f2937'; ctx.lineWidth=1;
  for(let g=0;g<=4;g++){ const v=y0+g*(y1-y0)/4, yy=y(v);
    ctx.beginPath();ctx.moveTo(padL,yy);ctx.lineTo(w-padR,yy);ctx.stroke();
    ctx.fillStyle='#6b7688'; ctx.font='10px -apple-system,sans-serif'; ctx.textAlign='right';
    ctx.fillText(v.toFixed(dec), padL-6, yy+3);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(padL,0,w-padL-padR,h); ctx.clip();
  segs.forEach(sg=>{
    if(sg.end<s0||sg.start>e0) return;
    const x0=x(sg.start), x1=x(Math.min(sg.end,n-1)), c0=Math.max(x0,padL), c1=Math.min(x1,w-padR);
    ctx.fillStyle=REGIME_COLOR[sg.regime]+'22'; ctx.fillRect(c0,padT,c1-c0,h-padT-padB);
    ctx.strokeStyle=REGIME_COLOR[sg.regime]+'55'; ctx.beginPath(); ctx.moveTo(x0,padT); ctx.lineTo(x0,h-padB); ctx.stroke();
    ctx.fillStyle=REGIME_COLOR[sg.regime]; ctx.font='600 10px -apple-system,sans-serif'; ctx.textAlign='center';
    if(c1-c0>50) ctx.fillText(REGIME_NAME[sg.regime], (c0+c1)/2, padT-8);
  });
  ctx.strokeStyle='#3b82f6'; ctx.lineWidth=1.6; ctx.beginPath();
  const st=Math.max(s0-1,0);
  for(let i=st;i<=Math.min(e0+1,n-1);i++){ i===st?ctx.moveTo(x(i),y(prices[i])):ctx.lineTo(x(i),y(prices[i])); }
  ctx.stroke(); ctx.restore();
}

function drawEquityChart(equity, buyHold){
  const cv = document.getElementById('equityChart');
  const {ctx,w,h} = setupCanvas(cv);
  ctx.clearRect(0,0,w,h);
  const padL=48,padR=10,padT=10,padB=20, n=equity.length, [s0,e0]=viewRange(n);
  const all = equity.slice(s0,e0+1).concat(buyHold.slice(s0,e0+1));
  const min=Math.min(...all), max=Math.max(...all); const pad=(max-min)*0.08||1;
  const y0=min-pad, y1=max+pad;
  const x = i => padL + ((i-s0)/(e0-s0))*(w-padL-padR);
  const y = v => padT + (1-(v-y0)/(y1-y0))*(h-padT-padB);
  ctx.strokeStyle='#1f2937'; ctx.lineWidth=1;
  for(let g=0;g<=4;g++){ const v=y0+g*(y1-y0)/4; const yy=y(v);
    ctx.beginPath();ctx.moveTo(padL,yy);ctx.lineTo(w-padR,yy);ctx.stroke();
    ctx.fillStyle='#6b7688'; ctx.font='10px -apple-system,sans-serif'; ctx.textAlign='right';
    ctx.fillText('₹'+((y1-y0)<10000?(v/1000).toFixed(1):Math.round(v/1000))+'k', padL-6, yy+3);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(padL,0,w-padL-padR,h); ctx.clip();
  const st=Math.max(s0-1,0), en=Math.min(e0+1,n-1);
  [[buyHold,'#556070',1.2],[equity,'#22c55e',1.8]].forEach(([arr,c,lw])=>{
    ctx.strokeStyle=c; ctx.lineWidth=lw; ctx.beginPath();
    for(let i=st;i<=en;i++){ i===st?ctx.moveTo(x(i),y(arr[i])):ctx.lineTo(x(i),y(arr[i])); }
    ctx.stroke();
  });
  ctx.restore();
}

function drawDonut(wins,losses){
  const cv = document.getElementById('donutChart');
  const dpr=window.devicePixelRatio||1; const size=140;
  cv.width=size*dpr; cv.height=size*dpr; const ctx=cv.getContext('2d'); ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,size,size);
  const total=wins+losses||1; const cx=70,cy=70,rO=60,rI=38;
  let start=-Math.PI/2;
  [[wins,'#22c55e'],[losses,'#ef4444']].forEach(([v,c])=>{
    const ang=(v/total)*Math.PI*2;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,rO,start,start+ang); ctx.closePath();
    ctx.fillStyle=c; ctx.fill(); start+=ang;
  });
  ctx.globalCompositeOperation='destination-out';
  ctx.beginPath(); ctx.arc(cx,cy,rI,0,Math.PI*2); ctx.fill();
  ctx.globalCompositeOperation='source-over';
  ctx.fillStyle='#e5e9f0'; ctx.textAlign='center'; ctx.font='700 20px -apple-system,sans-serif';
  ctx.fillText(String(total), cx, cy-2);
  ctx.fillStyle='#8792a6'; ctx.font='11px -apple-system,sans-serif'; ctx.fillText('Trades', cx, cy+14);
}

// ---------- Orchestration ----------
function getParams(){
  return {
    trend:+el.trend.value, meanrev:+el.meanrev.value, vol:+el.vol.value,
    shockp:+el.shockp.value, shockm:+el.shockm.value,
    persist:+el.persist.value, trans:+el.trans.value,
    len:Math.round(+el.len.value), cap:+el.cap.value,
    ma:Math.round(+el.ma.value), sl:+el.sl.value, tp:+el.tp.value, ps:+el.ps.value
  };
}

let lastSegs=null, lastPrices=null, customData=null, lastSnap=null;
function update(reseed){
  syncLabels();
  const p = getParams();
  if(reseed){ customData=null; view={a:0,b:1}; }
  if(customData){ lastPrices=customData.prices; lastSegs=customData.segs; }
  else if(reseed || !lastSegs){
    lastSegs = buildRegimes(p.len, p.persist, p.trans);
    lastPrices = genMarket(p.len, regimeArray(p.len, lastSegs), p);
  } else if(lastPrices.length!==p.len){
    lastSegs = buildRegimes(p.len, p.persist, p.trans);
    lastPrices = genMarket(p.len, regimeArray(p.len, lastSegs), p);
  }
  const prices = lastPrices, segs = lastSegs;
  const ma = movingAvg(prices, p.ma);
  const {equity, trades} = backtest(prices, ma, p.cap, p.sl, p.tp, p.ps);
  const buyHold = prices.map(px => p.cap * (px/prices[0]));
  const m = metricsFor(equity, trades, p.cap);
  const rperf = regimePerf(segs, equity, trades);
  lastSnap = {m, rperf, n:prices.length, real:!!customData};

  lastDraw={prices,segs,equity,buyHold};
  redraw();
  drawDonut(m.wins, m.losses);

  document.getElementById('regimeLegend').innerHTML = Object.entries(REGIME_NAME)
    .map(([k,v])=>`<span><span class="dot" style="background:${REGIME_COLOR[k]}"></span>${v}</span>`).join('');

  const rc = v => v>=0?'pos':'neg';
  document.getElementById('statsGrid').innerHTML = `
    <div class="stat"><div class="l">Total Return</div><div class="v ${rc(m.totalReturn)}">${m.totalReturn>=0?'+':''}${m.totalReturn.toFixed(1)}%</div></div>
    <div class="stat"><div class="l">Sharpe Ratio</div><div class="v">${m.sharpe.toFixed(2)}</div></div>
    <div class="stat"><div class="l">Max Drawdown</div><div class="v neg">${m.maxDD.toFixed(1)}%</div></div>
    <div class="stat"><div class="l">Total Trades</div><div class="v">${m.trades}</div></div>
    <div class="stat"><div class="l">Final Capital</div><div class="v">₹${Math.round(m.finalCap).toLocaleString()}</div></div>
    <div class="stat"><div class="l">Win Rate</div><div class="v">${m.winRate.toFixed(1)}%</div></div>
  `;

  document.getElementById('regimeTable').innerHTML = Object.values(rperf).map(o=>{
    const ret = o.startEq? (o.endEq-o.startEq)/o.startEq*100 : 0;
    const dd = o.peakEq>0 ? (o.minEq-o.peakEq)/o.peakEq*100 : 0;
    return `<tr><td><span class="regime-chip"><span class="dot" style="background:${REGIME_COLOR[o.regime]}"></span>${REGIME_NAME[o.regime]}</span></td>
      <td>${o.duration}</td><td class="${rc(ret)}">${ret>=0?'+':''}${ret.toFixed(1)}%</td>
      <td class="neg">${dd.toFixed(1)}%</td><td>${o.trades}</td></tr>`;
  }).join('');

  document.getElementById('donutLegend').innerHTML = `
    <div class="row"><span><span class="dot" style="background:#22c55e"></span>Profitable</span><b>${m.trades?((m.wins/m.trades)*100).toFixed(1):'0.0'}%</b></div>
    <div class="row"><span><span class="dot" style="background:#ef4444"></span>Losing</span><b>${m.trades?((m.losses/m.trades)*100).toFixed(1):'0.0'}%</b></div>
    <div class="row"><span>Avg Win</span><b class="pos">+${m.avgWin.toFixed(1)}%</b></div>
    <div class="row"><span>Avg Loss</span><b class="neg">${m.avgLoss.toFixed(1)}%</b></div>
    <div class="row"><span>Profit Factor</span><b>${isFinite(m.profitFactor)?m.profitFactor.toFixed(2):'∞'}</b></div>
  `;
}

// ---------- Events ----------
ids.forEach(id => el[id].addEventListener('input', ()=>update(false)));
document.getElementById('runBtn').addEventListener('click', ()=>update(true));

document.querySelectorAll('.tabs button').forEach(b=>{
  b.addEventListener('click', ()=>{
    document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    document.getElementById('tab-market').style.display = b.dataset.tab==='market'?'block':'none';
    document.getElementById('tab-strategy').style.display = b.dataset.tab==='strategy'?'block':'none';
  });
});

const PRESETS = {
  trending: {trend:0.85, meanrev:0.1, vol:0.35, shockp:0.02, shockm:0.06, persist:0.85, trans:0.15},
  meanrev: {trend:0.15, meanrev:0.85, vol:0.3, shockp:0.02, shockm:0.06, persist:0.75, trans:0.2},
  highvol: {trend:0.5, meanrev:0.3, vol:0.9, shockp:0.06, shockm:0.12, persist:0.4, trans:0.45},
  shock: {trend:0.4, meanrev:0.3, vol:0.6, shockp:0.15, shockm:0.18, persist:0.3, trans:0.5},
  custom: {trend:0.6, meanrev:0.3, vol:0.5, shockp:0.05, shockm:0.10, persist:0.7, trans:0.3},
};
document.querySelectorAll('.presets button').forEach(b=>{
  b.addEventListener('click', ()=>{
    const pr = PRESETS[b.dataset.preset];
    Object.entries(pr).forEach(([k,v])=>{ el[k].value=v; });
    update(true);
  });
});

// ---------- Zoom / pan on the price chart (also drives the equity chart) ----------
(function(){
  const cv=document.getElementById('marketChart'), PL=44, PR=10;
  const N=()=>lastDraw?lastDraw.prices.length:0;
  const minSpan=()=>Math.min(1,15/Math.max(1,N()-1));
  function set(a,b){ const sp=Math.min(1,Math.max(minSpan(),b-a)); a=Math.max(0,Math.min(1-sp,a)); view={a,b:a+sp}; redraw(); }
  function zoom(f,fx){ const sp=view.b-view.a, ns=Math.min(1,Math.max(minSpan(),sp*f)), c=view.a+fx*sp; set(c-fx*ns,c-fx*ns+ns); }
  const fxOf=ev=>{const r=cv.getBoundingClientRect(); return Math.max(0,Math.min(1,(ev.clientX-r.left-PL)/(r.width-PL-PR)));};
  cv.addEventListener('wheel',ev=>{ev.preventDefault(); zoom(ev.deltaY>0?1.25:0.8,fxOf(ev));},{passive:false});
  let drag=null;
  cv.addEventListener('pointerdown',ev=>{drag={x:ev.clientX,a:view.a,sp:view.b-view.a}; cv.setPointerCapture(ev.pointerId);});
  cv.addEventListener('pointermove',ev=>{ if(!drag) return; const r=cv.getBoundingClientRect(); const d=(ev.clientX-drag.x)/(r.width-PL-PR)*drag.sp; set(drag.a-d,drag.a-d+drag.sp); });
  ['pointerup','pointercancel'].forEach(t=>cv.addEventListener(t,()=>{drag=null;}));
  cv.addEventListener('dblclick',()=>set(0,1));
  document.getElementById('zIn').onclick=()=>zoom(0.6,0.5);
  document.getElementById('zOut').onclick=()=>zoom(1.66,0.5);
  document.getElementById('zReset').onclick=()=>set(0,1);
})();

// ---------- Hooks for the AI copilot (ai.js) ----------
function classifyRegimes(prices, win=40){
  const r=[]; for(let i=1;i<prices.length;i++) r.push(prices[i]/prices[i-1]-1);
  const sd=a=>{const m=a.reduce((x,y)=>x+y,0)/a.length; return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length)||1e-9;};
  const allSd=sd(r), segs=[];
  for(let s=0;s<r.length;s+=win){
    const c=r.slice(s,s+win), m=c.reduce((x,y)=>x+y,0)/c.length, v=sd(c);
    let reg;
    if(Math.max(...c.map(Math.abs))>4*allSd) reg='shock';
    else if(v>1.4*allSd) reg='high_vol';
    else if(Math.abs(m/(v/Math.sqrt(c.length)))>1.5) reg='trending';
    else reg='mean_reverting';
    segs.push({regime:reg,start:s,end:Math.min(s+win,prices.length)});
  }
  return segs;
}
window.RL = {
  snapshot(){ const p=getParams(), s=lastSnap; if(!s) return {params:p};
    const r=x=>Math.round(x*100)/100;
    return {params:p, dataSource:s.real?'uploaded real prices':'synthetic', periods:s.n,
      metrics:{totalReturnPct:r(s.m.totalReturn),sharpe:r(s.m.sharpe),maxDrawdownPct:r(s.m.maxDD),trades:s.m.trades,winRatePct:r(s.m.winRate),profitFactor:isFinite(s.m.profitFactor)?r(s.m.profitFactor):'inf',avgWinPct:r(s.m.avgWin),avgLossPct:r(s.m.avgLoss)},
      byRegime:Object.values(s.rperf).map(o=>({regime:o.regime,periods:o.duration,returnPct:o.startEq?r((o.endEq-o.startEq)/o.startEq*100):0,trades:o.trades}))}; },
  apply(a){ const done=[];
    if(a.params) Object.entries(a.params).forEach(([k,v])=>{ if(!el[k]||isNaN(+v)) return;
      const x=Math.min(+el[k].max,Math.max(+el[k].min,+v)); el[k].value=x; done.push(k+'='+fmtVal(k,x)); });
    const strategyOnly = a.params && Object.keys(a.params).every(k=>['ma','sl','tp','ps','cap'].includes(k));
    if(a.reseed || (a.params && !strategyOnly && !customData)) { update(true); if(a.reseed) done.push('new market'); }
    else update(false);
    return done; },
  loadPrices(prices){ customData={prices, segs:classifyRegimes(prices)}; update(false); }
};

window.addEventListener('resize', ()=>update(false));
update(true);
