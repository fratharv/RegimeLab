// RegimeLab AI Copilot — talks to Qwen via Alibaba DashScope's OpenAI-compatible API.
(function(){
const $ = id => document.getElementById(id);
const ENDPOINT = window.REGIMELAB_AI_URL || '';
const SYS = `You are the copilot inside RegimeLab, a synthetic-market lab that backtests a moving-average crossover strategy across market regimes (trending, mean_reverting, high_vol, shock).
You receive CURRENT STATE (params, metrics, per-regime results) with every message. Comment briefly and concretely on what the numbers say and how to improve the strategy. Keep replies under 120 words.
You can change the app. Reply ONLY with a JSON object: {"reply": string, "actions": {"params": {...}, "reseed": boolean}}. Omit "actions" if nothing should change.
Valid params (ranges): trend 0-1, meanrev 0-1, vol 0.05-1, shockp 0-0.2, shockm 0.01-0.2, persist 0.05-1, trans 0-1, len 100-5000 (periods), cap 10000-1000000 (initial capital), ma 5-100 (MA period), sl 0.5-15 (stop loss %), tp 0.5-30 (take profit %), ps 5-100 (position size %).
Set "reseed": true to draw a fresh random market (also needed to leave uploaded real data).
Rules of thumb: daily volatility % is about 0.3 + 1.2*vol. Strong uptrend stock = high trend, low meanrev. Choppy/sideways = low trend, high meanrev.
You have NO live market data. If asked for a real stock like "today's Apple chart", say so in one sentence, then set params so the synthetic market has that stock's typical character (e.g. AAPL: daily vol ~1.5% => vol ~0.95... use judgment, moderate trend, few shocks), and tell the user to upload a real price CSV with the "Upload prices CSV" button for exact data.
Never invent performance numbers; only use CURRENT STATE.`;
let hist = [], busy = false;

function toggle(open){
  $('aiPanel').classList.toggle('open',open); document.body.classList.toggle('ai-open',open);
  setTimeout(()=>window.dispatchEvent(new Event('resize')),250);
}
$('aiBtn').onclick=()=>{toggle(true); if(!$('aiLog').children.length) add('sys','Tell me what market to build or what to change, or tap “Analyze this run”.');};
$('aiClose').onclick=()=>toggle(false);

function add(cls,text,applied){
  const d=document.createElement('div'); d.className='msg '+cls; d.textContent=text;
  if(applied&&applied.length){const s=document.createElement('span'); s.className='applied'; s.textContent='Applied: '+applied.join(', '); d.appendChild(s);}
  $('aiLog').appendChild(d); $('aiLog').scrollTop=1e9; return d;
}

// Offline fallback so common commands still work instantly if the AI is unreachable.
function localIntent(t){
  t=t.toLowerCase(); const p={}, has=(...w)=>w.some(x=>t.includes(x));
  if(has('apple','aapl')) Object.assign(p,{trend:.6,meanrev:.2,vol:.95,shockp:.03,shockm:.07});
  if(has('trending','uptrend','bull')) Object.assign(p,{trend:.85,meanrev:.1});
  if(has('sideways','choppy','mean rever','range')) Object.assign(p,{trend:.15,meanrev:.85});
  if(has('volatile','volatility','harder','stress')) p.vol=.9;
  if(has('calm','low vol','stable')) p.vol=.2;
  if(has('crash','shock')) Object.assign(p,{shockp:.15,shockm:.18});
  if(has('tight')) p.sl=1; if(has('wider stop','wide stop')) p.sl=6;
  if(has('longer','1000 periods','more data')) p.len=3000;
  return Object.keys(p).length?{reply:'(Offline mode) Applied your request. Charts updated.',actions:{params:p,reseed:true}}
    :{reply:'The AI is unavailable and I could not parse that offline. Try “trending market”, “choppy market”, “more volatile”, “add shocks” or “Apple-like market”.'};
}

async function ask(text){
  if(busy||!text.trim()) return;
  busy=true; $('aiSend').disabled=true; add('user',text);
  const wait=add('sys','Thinking…');
  let out;
  try{
    if(!ENDPOINT) throw new Error('no endpoint');
    const res=await fetch(ENDPOINT,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({temperature:0.4,response_format:{type:'json_object'},
        messages:[{role:'system',content:SYS},...hist.slice(-8),
          {role:'user',content:'CURRENT STATE:\n'+JSON.stringify(RL.snapshot())+'\n\nUSER: '+text}]})
    });
    if(!res.ok) throw new Error('API '+res.status);
    const data=await res.json();
    const raw=(data.choices[0].message.content||'').replace(/^```json|```$/g,'').trim();
    try{ out=JSON.parse(raw); }catch(e){ out={reply:raw}; }
  }catch(e){ out=localIntent(text); }
  const applied = out.actions ? RL.apply(out.actions) : [];
  wait.remove(); add('bot',out.reply||'Done.',applied);
  hist.push({role:'user',content:text},{role:'assistant',content:out.reply||''});
  busy=false; $('aiSend').disabled=false;
}

$('aiSend').onclick=()=>{const t=$('aiText').value; $('aiText').value=''; ask(t);};
$('aiText').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault(); $('aiSend').click();}});
document.querySelectorAll('.ai-chips button[data-q]').forEach(b=>b.onclick=()=>ask(b.dataset.q));

// ----- Real price data: CSV with a "Close" column (Yahoo/Google Finance/NSE exports work) -----
$('aiCsvBtn').onclick=()=>$('aiCsv').click();
$('aiCsv').onchange=async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{
    const rows=(await f.text()).trim().split(/\r?\n/).map(l=>l.split(/[,;\t]/).map(c=>c.trim().replace(/^"|"$/g,'')));
    const head=rows[0].map(h=>h.toLowerCase());
    let ci=head.findIndex(h=>h==='close'||h==='adj close'||h==='close/last'||h==='price');
    let body=rows, hasHead=isNaN(parseFloat(rows[0][0]))&&isNaN(parseFloat(rows[0][rows[0].length-1]));
    if(hasHead) body=rows.slice(1); if(ci<0) ci=rows[0].length-1;
    let px=body.map(r=>parseFloat(String(r[ci]).replace(/[$₹,]/g,''))).filter(v=>isFinite(v)&&v>0);
    const di=head.findIndex(h=>h==='date'); 
    if(di>=0 && body.length>1 && new Date(body[0][di])>new Date(body[body.length-1][di])) px.reverse();
    if(px.length<100) throw new Error('Need at least 100 valid closing prices (found '+px.length+').');
    px=px.slice(-5000); RL.loadPrices(px);
    add('sys','Loaded '+px.length+' real prices from '+f.name+'. Regimes were auto-detected from the data.');
    ask('I just loaded real price data. Analyze how my strategy performs on it.');
  }catch(err){ add('err','Could not read CSV: '+err.message); }
  e.target.value='';
};
})();
