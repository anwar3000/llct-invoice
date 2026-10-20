// LLCT Invoicing — quotations, invoices, delivery notes, payments and statements.
// Uses the same Firebase project and staff logins as LLCT Attendance.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, getDoc, setDoc, deleteDoc, onSnapshot, query, where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './config.js';

const fbApp=initializeApp(firebaseConfig);
const auth=getAuth(fbApp);
setPersistence(auth,browserLocalPersistence).catch(()=>{});
let fdb;
try{fdb=initializeFirestore(fbApp,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})})}catch(e){fdb=initializeFirestore(fbApp,{})}
const LOGIN_DOMAIN='staff.attendance.app'; // same login IDs as the attendance app
const loginToEmail=l=>{const s=String(l||'').trim().toLowerCase();return s.includes('@')?s:`${s}@${LOGIN_DOMAIN}`};

/* ================= helpers ================= */
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const today=()=>{const d=new Date();return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
const addDays=(iso,n)=>{const d=new Date(iso+'T00:00:00');d.setDate(d.getDate()+n);return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
const dayDiff=(a,b)=>Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/864e5);
const r2=n=>Math.round((+n||0)*100)/100;
const money=n=>(+n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const cur=n=>`${S.cfg.currency} ${money(n)}`;
const fdate=iso=>{if(!iso)return '—';const d=new Date(iso.length<=10?iso+'T00:00:00':iso);return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})};
const fdt=iso=>{if(!iso)return '—';const d=new Date(iso);return d.toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})};
const clone=o=>JSON.parse(JSON.stringify(o));
const ls={get(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};

function numWords(n){
  const a=['','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const b=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  const w=x=>{if(x<20)return a[x];if(x<100)return b[Math.floor(x/10)]+(x%10?'-'+a[x%10]:'');if(x<1000)return a[Math.floor(x/100)]+' hundred'+(x%100?' and '+w(x%100):'');
    for(const [v,nm] of [[1e9,'billion'],[1e6,'million'],[1e3,'thousand']]) if(x>=v) return w(Math.floor(x/v))+' '+nm+(x%v?(x%v<100?' and ':' ')+w(x%v):'');};
  n=Math.abs(r2(n));const whole=Math.floor(n),fr=Math.round((n-whole)*100);
  let s=(whole?w(whole):'zero')+' '+(S.cfg.currencyName||S.cfg.currency);
  if(fr) s+=' and '+w(fr)+' '+(S.cfg.minorName||'fils');
  return s.charAt(0).toUpperCase()+s.slice(1)+' only';
}

/* ================= config & permissions ================= */
const DEFAULT_CFG={name:'LEADERS LINE TRADING LLC',address:'M05, Al Nisf, Airport Road\nDubai, UAE',phone:'04 880 5577',email:'anwar@llct.net',website:'www.llct.net  ·  www.o2iot.ae',taxId:'100362683300003',taxIdLabel:'TRN',
  currency:'AED',currencyName:'dirhams',minorName:'fils',taxLabel:'VAT',taxRate:5,
  prefix:{quotation:'QT-',invoice:'INV-',delivery:'DN-'},validDays:15,dueDays:30,
  terms:{quotation:'Prices valid for 15 days from the quotation date.\nDelivery: 3–5 working days from confirmed order.\nPayment: 50% advance, balance on delivery.',
         invoice:'Payment due within 30 days of invoice date.\nPlease quote the invoice number with your payment.',
         delivery:'Goods received in good condition. Please check serial numbers against this note.'},
  bank:'Account name: LEADERS LINE TRADING LLC\nWIO Bank, Dubai · IBAN AE250860000009674830642\nRAK Bank (Amal), Dubai · Account 8882060635901 · IBAN AE510400008882060635901',brand:'#B8285E',charcoal:'#17375F',logo:'assets/logo.png',signature:'',signName:'',showPricesOnDN:false};
const PERMS=[
  ['quotation','Create & edit quotations'],['invoice','Create & edit invoices'],['delivery','Create delivery notes'],
  ['deliver','Complete deliveries (scan & sign)'],['payments','Record payments'],['clients','Manage clients & products'],
  ['reports','View accounts & statements'],['viewAll','See documents made by others'],['delete','Delete documents']];
const EMP_DEFAULT={delivery:true,deliver:true};
const TYPE={quotation:{t:'Quotation',p:'Quotations',a:'QT',c:'q'},invoice:{t:'Tax Invoice',p:'Invoices',a:'INV',c:'i'},delivery:{t:'Delivery Note',p:'Delivery notes',a:'DN',c:'d'}};

const S={cfg:clone(DEFAULT_CFG),clients:[],products:[],docs:[],payments:[],users:{},access:{},
  me:{id:null,role:'loading',perms:{}},view:'home',params:{}};
const can=p=>S.me.role==='admin'||S.me.role==='manager'&&p!=='__admin'||!!S.me.perms[p];
const isAdmin=()=>S.me.role==='admin';

/* ================= Firebase store ================= */
const COL={config:'inv_config',access:'inv_access',clients:'inv_clients',products:'inv_products',docs:'inv_docs',payments:'inv_payments',images:'inv_images',users:'users'};
const Store={unsubs:[],
  sub(col,cb,clauses){
    const ref=collection(fdb,COL[col]);const q=clauses&&clauses.length?query(ref,...clauses):ref;
    this.unsubs.push(onSnapshot(q,s=>cb(s.docs.map(d=>({...d.data(),id:d.id}))),e=>{console.warn(col,e);toast('Could not load '+col+' ('+(e.code||e.message)+').',true)}));
  },
  subDoc(col,id,cb){this.unsubs.push(onSnapshot(doc(fdb,COL[col],id),s=>cb(s.exists()?{...s.data(),id:s.id}:null),e=>console.warn(col,e)))},
  stop(){this.unsubs.forEach(u=>{try{u()}catch(e){}});this.unsubs=[]},
  async put(col,id,data){const d=clone(data);delete d.id;await setDoc(doc(fdb,COL[col],id),d)},
  async remove(col,id){await deleteDoc(doc(fdb,COL[col],id))},
  async get(col,id){const s=await getDoc(doc(fdb,COL[col],id));return s.exists()?{...s.data(),id:s.id}:null}
};
async function save(col,id,data,msg){
  try{await Store.put(col,id,data);if(msg)toast(msg);return true}
  catch(e){toast(/permission/i.test(e.code||e.message||'')?'You don\'t have permission to save this. Ask the admin.':'Save failed: '+(e.message||e.code),true);return false}
}
const nameOf=(id,fallback)=>id===S.me.id?(S.me.name||'You'):(S.users[id]&&S.users[id].name)||fallback||'Team member';

/* ================= images (stored in Firestore, no Storage bucket needed) ================= */
const IMG={},imgWait={};
const BLANK='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
function src(ref){if(!ref)return '';if(String(ref).startsWith('img:')){const id=ref.slice(4);if(IMG[id])return IMG[id];loadImg(id);return BLANK}return ref}
function loadImg(id){if(IMG[id])return Promise.resolve(IMG[id]);
  if(!imgWait[id])imgWait[id]=Store.get('images',id).then(d=>{IMG[id]=(d&&d.data)||'';$$(`img[data-ref="img:${id}"]`).forEach(i=>i.src=IMG[id]||BLANK);return IMG[id]}).catch(()=>{delete imgWait[id];return ''});
  return imgWait[id]}
const img=(ref,attrs='')=>`<img src="${h(src(ref))}" data-ref="${h(ref)}" alt="" ${attrs}>`;
function pickImage(){return new Promise(res=>{const inp=$('#img-input');inp.value='';inp.onchange=()=>res(inp.files[0]||null);inp.click()})}
function compress(file,max=900,q=.82,type='image/jpeg'){return new Promise((res,rej)=>{const im=new Image();const u=URL.createObjectURL(file);
  im.onload=()=>{const k=Math.min(1,max/Math.max(im.width,im.height));const c=document.createElement('canvas');c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);
    const x=c.getContext('2d');if(type==='image/jpeg'){x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height)}x.drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);res(c.toDataURL(type,q))};
  im.onerror=rej;im.src=u})}
// Logos and signatures (png) stay inline in settings; product photos go to their own document.
async function storeImage(file,max=900,png=false){
  if(png)return await compress(file,Math.min(max,480),.9,'image/png');
  let data=await compress(file,max,.78);if(data.length>700000)data=await compress(file,600,.65);
  const id=uid();await Store.put('images',id,{data,createdBy:S.me.id,createdAt:new Date().toISOString()});IMG[id]=data;return 'img:'+id;
}

/* ================= barcode scanning ================= */
async function decodeImage(file){
  if('BarcodeDetector' in window){try{const bd=new BarcodeDetector();const bmp=await createImageBitmap(file);const r=await bd.detect(bmp);if(r.length)return r[0].rawValue}catch(e){}}
  if(window.Html5Qrcode){try{const q=new Html5Qrcode('reader-hidden');const t=await q.scanFile(file,false);try{q.clear()}catch(e){}return t}catch(e){}}
  return null;
}
function scanPhoto(){return new Promise(res=>{const inp=$('#scan-input');inp.value='';
  inp.onchange=async()=>{const f=inp.files[0];if(!f)return res(null);toast('Reading barcode…');const code=await decodeImage(f);
    if(!code)toast('No barcode found. Hold the camera closer, keep it sharp, or type the number.',true);res(code)};inp.click()})}
// Live camera scanner. onCode returns false when the code was rejected (e.g. duplicate).
function openScanner(onCode,{title='Scan barcode',multi=false}={}){
  const o=modal(title,`<div id="scan-view" style="width:100%;min-height:240px;background:#000;border-radius:10px;overflow:hidden"></div>
    <div class="muted" id="scan-msg">Starting camera… point it at the barcode.</div>
    <div class="scanrow"><input id="scan-manual" placeholder="Or type / use a handheld scanner" autocomplete="off"><button class="btn" id="scan-ok">Add</button></div>`,
    `<button class="btn" id="scan-photo">Take a photo instead</button><span class="grow"></span><button class="btn primary" data-x>Done</button>`,false,'scan-ov');
  let q=null,last='',lastT=0,stopped=false;
  const stop=()=>{if(stopped)return;stopped=true;if(q){try{q.stop().catch(()=>{}).finally(()=>{try{q.clear()}catch(e){}})}catch(e){}}};
  const msg=t=>{const m=$('#scan-msg',o);if(m)m.textContent=t};
  const hit=code=>{code=String(code||'').trim();if(!code)return;const now=Date.now();if(code===last&&now-lastT<2500)return;last=code;lastT=now;
    if(navigator.vibrate)navigator.vibrate(60);const ok=onCode(code);msg(ok===false?'Not added: '+code:'Added '+code);if(!multi&&ok!==false){stop();o.remove()}};
  const obs=new MutationObserver(()=>{if(!document.body.contains(o)){stop();obs.disconnect()}});obs.observe(document.body,{childList:true});
  $('#scan-ok',o).onclick=()=>{hit($('#scan-manual',o).value);$('#scan-manual',o).value='';$('#scan-manual',o).focus()};
  $('#scan-manual',o).onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('#scan-ok',o).click()}};
  $('#scan-photo',o).onclick=async()=>{const code=await scanPhoto();if(code)hit(code)};
  if(!window.Html5Qrcode){msg('Scanner is still loading. Type the code or take a photo.');return}
  try{q=new Html5Qrcode('scan-view',{verbose:false,experimentalFeatures:{useBarCodeDetectorIfSupported:true}});
    q.start({facingMode:'environment'},{fps:12,qrbox:(w,hh)=>({width:Math.floor(Math.min(w*.9,380)),height:Math.floor(Math.min(hh*.6,180))})},t=>hit(t),()=>{})
      .then(()=>msg(multi?'Scanning… each code is added automatically.':'Point the camera at the barcode.'))
      .catch(e=>msg('Camera not available ('+((e&&e.name)||'blocked')+'). Allow camera access, or take a photo / type the code.'));
  }catch(e){msg('Camera not available. Take a photo or type the code.')}
}

/* ================= totals & accounts ================= */
function totals(d){
  const sub=r2((d.items||[]).reduce((s,i)=>s+(+i.qty||0)*(+i.price||0),0));
  const disc=r2(d.discount||0);const taxable=r2(sub-disc);const rate=d.taxRate??S.cfg.taxRate;
  const tax=r2(taxable*(+rate||0)/100);return {sub,disc,taxable,rate,tax,total:r2(taxable+tax)};
}
const paidOn=invId=>r2(S.payments.filter(p=>p.invoiceId===invId).reduce((s,p)=>s+(+p.amount||0),0));
function invStatus(d){
  const t=totals(d).total,p=paidOn(d.id);
  if(p>=t-0.005&&t>0)return ['paid','good'];
  const od=d.dueDate&&d.dueDate<today();
  if(p>0)return [od?'partial · overdue':'partially paid',od?'bad':'warn'];
  return od?['overdue','bad']:['unpaid','warn'];
}
function docStatus(d){
  if(d.type==='invoice')return invStatus(d);
  if(d.type==='delivery')return d.delivery&&d.delivery.signedAt?['delivered','good']:['pending','warn'];
  const m={draft:'',sent:'brand',accepted:'good',rejected:'bad'};return [d.status||'draft',m[d.status||'draft']];
}
function clientBalance(cid){
  const c=S.clients.find(x=>x.id===cid)||{};
  const inv=S.docs.filter(d=>d.type==='invoice'&&d.clientId===cid).reduce((s,d)=>s+totals(d).total,0);
  const pay=S.payments.filter(p=>p.clientId===cid).reduce((s,p)=>s+(+p.amount||0),0);
  return r2((+c.openingBalance||0)+inv-pay);
}
function soaData(cid,from,to){
  const c=S.clients.find(x=>x.id===cid)||{};
  const tx=[];
  if(+c.openingBalance) tx.push({date:c.openingDate||'2000-01-01',kind:'Opening balance',no:'',ref:'',dr:+c.openingBalance,cr:0});
  S.docs.filter(d=>d.type==='invoice'&&d.clientId===cid).forEach(d=>tx.push({date:d.date,kind:'Invoice',no:d.number,ref:d.ref||'',dr:totals(d).total,cr:0,id:d.id,due:d.dueDate}));
  S.payments.filter(p=>p.clientId===cid).forEach(p=>{const inv=S.docs.find(d=>d.id===p.invoiceId);tx.push({date:p.date,kind:'Payment · '+(p.method||''),no:p.ref||'',ref:inv?'Against '+inv.number:'',dr:0,cr:+p.amount||0})});
  tx.sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:(b.dr-a.dr));
  let open=0;const rows=[];let bal;
  for(const t of tx){ if(t.date<from) open+=t.dr-t.cr; }
  bal=open;
  for(const t of tx){ if(t.date>=from&&t.date<=to){bal+=t.dr-t.cr;rows.push({...t,bal:r2(bal)})} }
  const invd=rows.reduce((s,r)=>s+r.dr,0),recd=rows.reduce((s,r)=>s+r.cr,0);
  // aging as of `to`: allocated payments first, then unallocated credit FIFO
  const invs=S.docs.filter(d=>d.type==='invoice'&&d.clientId===cid&&d.date<=to).sort((a,b)=>a.date<b.date?-1:1)
    .map(d=>({d,out:r2(totals(d).total-S.payments.filter(p=>p.invoiceId===d.id&&p.date<=to).reduce((s,p)=>s+(+p.amount||0),0))}));
  if(+c.openingBalance) invs.unshift({d:{date:c.openingDate||'2000-01-01',dueDate:c.openingDate||'2000-01-01'},out:+c.openingBalance});
  let pool=S.payments.filter(p=>p.clientId===cid&&p.date<=to&&!S.docs.some(d=>d.id===p.invoiceId)).reduce((s,p)=>s+(+p.amount||0),0);
  for(const x of invs){if(x.out<0){pool+=-x.out;x.out=0}}
  for(const x of invs){const u=Math.min(pool,x.out);x.out=r2(x.out-u);pool-=u}
  const ag={cur:0,a30:0,a60:0,a90:0,a90p:0};
  for(const x of invs){if(x.out<=0)continue;const late=dayDiff(x.d.dueDate||x.d.date,to);
    if(late<=0)ag.cur+=x.out;else if(late<=30)ag.a30+=x.out;else if(late<=60)ag.a60+=x.out;else if(late<=90)ag.a90+=x.out;else ag.a90p+=x.out}
  return {c,open:r2(open),rows,invd:r2(invd),recd:r2(recd),close:r2(bal),ag,credit:r2(pool)};
}
function nextNumber(type,date){
  const y=(date||today()).slice(0,4);const pre=(S.cfg.prefix[type]||TYPE[type].a+'-')+y+'-';
  const max=S.docs.filter(d=>d.type===type&&(d.number||'').startsWith(pre)).reduce((m,d)=>Math.max(m,parseInt(d.number.slice(pre.length))||0),0);
  return pre+String(max+1).padStart(4,'0');
}
const visibleDocs=()=>S.docs.filter(d=>can('viewAll')||d.createdBy===S.me.id||(d.type==='delivery'&&can('deliver')&&!(d.delivery&&d.delivery.signedAt)));

/* ================= icons ================= */
const I={
 home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/></svg>',
 doc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8z"/><path d="M14 3v5h5M8 13h8M8 17h5"/></svg>',
 truck:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
 users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 14.5c1.9.6 3.1 2.4 3.5 5.5"/></svg>',
 cash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2.5" y="6" width="19" height="12" rx="1.5"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9v.01M18 15v.01"/></svg>',
 box:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/></svg>',
 gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.6 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
 shield:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
 plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>',
 menu:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
 pdf:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
 scan:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M7 9v6M10 9v6M13 9v6M17 9v6"/></svg>',
 pen:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
 back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5l-7 7 7 7"/></svg>',
};

/* ================= UI primitives ================= */
let toastT;
function toast(msg,err){let t=$('#toast');if(!t){t=document.createElement('div');t.id='toast';document.body.appendChild(t)}t.className='toast'+(err?' err':'');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,err?4200:2400)}
function modal(title,body,foot,wide,id='ov'){
  if(id==='ov')closeModal();else{const old=$('#'+id);if(old)old.remove()}
  const o=document.createElement('div');o.className='overlay';o.id=id;if(id!=='ov')o.style.zIndex=55;
  o.innerHTML=`<div class="modal ${wide?'wide':''}" role="dialog" aria-modal="true"><header><h2>${h(title)}</h2><button class="btn ghost sm" data-x aria-label="Close">✕</button></header><div class="body">${body}</div>${foot?`<footer>${foot}</footer>`:''}</div>`;
  o.addEventListener('click',e=>{if(e.target===o||e.target.closest('[data-x]'))o.remove()});
  document.body.appendChild(o);return o;
}
function closeModal(){const o=$('#ov');if(o)o.remove()}
function confirmBox(title,text,okLabel='Delete'){return new Promise(res=>{const o=modal(title,`<p style="margin:0">${h(text)}</p>`,`<button class="btn" data-x>Cancel</button><button class="btn primary" id="ok">${h(okLabel)}</button>`);
  $('#ok',o).onclick=()=>{closeModal();res(true)};o.addEventListener('click',e=>{if(e.target.closest('[data-x]')||e.target===o)res(false)})})}
function go(view,params={}){S.view=view;S.params=params;closeModal();render();window.scrollTo(0,0)}

/* ================= signature pad ================= */
function sigPad(host){
  host.innerHTML='<div class="base"></div><canvas></canvas><span class="hint">Sign above the line</span>';
  const c=$('canvas',host),x=c.getContext('2d');let drawing=false,dirty=false,last;
  const fit=()=>{const r=c.getBoundingClientRect();const k=window.devicePixelRatio||1;c.width=r.width*k;c.height=r.height*k;x.scale(k,k);x.lineWidth=2.2;x.lineCap='round';x.lineJoin='round';x.strokeStyle='#14213d'};
  requestAnimationFrame(fit);
  const pos=e=>{const r=c.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top]};
  c.addEventListener('pointerdown',e=>{drawing=true;last=pos(e);c.setPointerCapture(e.pointerId);x.beginPath();x.arc(last[0],last[1],1,0,7);x.fillStyle='#14213d';x.fill();dirty=true});
  c.addEventListener('pointermove',e=>{if(!drawing)return;const p=pos(e);x.beginPath();x.moveTo(...last);x.lineTo(...p);x.stroke();last=p;dirty=true});
  ['pointerup','pointercancel','pointerleave'].forEach(t=>c.addEventListener(t,()=>drawing=false));
  return {clear(){x.clearRect(0,0,c.width,c.height);dirty=false},isEmpty:()=>!dirty,
    load(data){const img=new Image();img.onload=()=>requestAnimationFrame(()=>{const r=c.getBoundingClientRect();x.drawImage(img,0,0,r.width,r.height);dirty=true});img.src=data},
    toData(){const o=document.createElement('canvas');const k=Math.min(1,600/c.width);o.width=c.width*k;o.height=c.height*k;o.getContext('2d').drawImage(c,0,0,o.width,o.height);return o.toDataURL('image/png')}};
}

/* ================= document sheet (A4) ================= */
function barcodeData(text){try{const c=document.createElement('canvas');JsBarcode(c,text,{format:'CODE128',displayValue:false,margin:0,height:60,width:2,background:'#ffffff',lineColor:'#1f2226'});return c.toDataURL('image/png')}catch(e){return ''}}
function sheetHead(title,number){
  const c=S.cfg;
  return `<div class="band"></div><div class="hd"><div class="co">${c.logo?img(c.logo,'class="logo"'):''}<div><div class="nm">${h(c.name)}</div>
  <div class="ad">${h([c.address,[c.phone,c.email].filter(Boolean).join('  ·  '),c.website,c.taxId?`${c.taxIdLabel}: ${c.taxId}`:''].filter(Boolean).join('\n'))}</div></div></div>
  <div class="ttl"><div class="dt">${h(title)}</div><div class="no">${h(number)}</div>${number?`<img class="bc" src="${barcodeData(number)}" alt="">`:''}</div></div>`;
}
function sheetFoot(){const c=S.cfg;return `<div class="ft"><span>${h(c.name)}${c.website?' · '+h(c.website):''}</span><span>Generated ${fdate(today())}</span></div>`}
function renderSheet(d){
  const c=S.cfg,t=totals(d),cl=d.client||{},isDN=d.type==='delivery',isQ=d.type==='quotation';
  const showPrice=!isDN||c.showPricesOnDN;const hasImg=isQ&&(d.items||[]).some(i=>i.photo);
  const title=d.type==='invoice'?(+t.rate?'Tax Invoice':'Invoice'):TYPE[d.type].t;
  const src=d.sourceId&&S.docs.find(x=>x.id===d.sourceId);
  const det=[['Date',fdate(d.date)]];
  if(d.type==='invoice'&&d.dueDate)det.push(['Due date',fdate(d.dueDate)]);
  if(isQ&&d.validUntil)det.push(['Valid until',fdate(d.validUntil)]);
  if(d.ref)det.push([isQ?'Your ref':'LPO / Ref',d.ref]);
  if(src)det.push([TYPE[src.type].a+' ref',src.number]);
  if(d.salesperson)det.push(['Salesperson',d.salesperson]);
  let rows=(d.items||[]).map((i,n)=>{
    const sn=(i.serials||[]).length?`<div class="sn">S/N: ${i.serials.map(h).join(', ')}</div>`:'';
    return `<tr><td class="c m">${n+1}</td>${hasImg?`<td>${i.photo?img(i.photo,'class="pi"'):''}</td>`:''}
    <td><div class="it">${h(i.name)}</div>${i.desc?`<div class="idesc">${h(i.desc)}</div>`:''}${isDN?'':sn}</td>
    <td class="r m">${h(i.qty)}</td><td>${h(i.unit||'')}</td>
    ${showPrice?`<td class="r m">${money(i.price)}</td><td class="r m">${money((+i.qty||0)*(+i.price||0))}</td>`:''}
    ${isDN?`<td>${sn?sn.replace('S/N: ',''):'<span style="color:#aaa">—</span>'}</td>`:''}</tr>`}).join('');
  const head=`<tr><th class="c" style="width:28px">#</th>${hasImg?'<th style="width:78px">Image</th>':''}<th>Description</th><th class="r" style="width:54px">Qty</th><th style="width:50px">Unit</th>${showPrice?'<th class="r" style="width:90px">Rate</th><th class="r" style="width:100px">Amount</th>':''}${isDN?'<th style="width:190px">Serial numbers</th>':''}</tr>`;
  let stamp='';
  if(d.type==='invoice'){const [s]=invStatus(d);if(s==='paid')stamp='<span class="stamp">PAID</span>';else if(s.includes('overdue'))stamp='<span class="stamp due">OVERDUE</span>'}
  if(isDN&&d.delivery&&d.delivery.signedAt)stamp='<span class="stamp">DELIVERED</span>';
  const paid=d.type==='invoice'?paidOn(d.id):0;
  const totalsHtml=showPrice?`<div class="tot">
    <div class="tr"><span>Subtotal</span><span class="m">${money(t.sub)}</span></div>
    ${t.disc?`<div class="tr"><span>Discount</span><span class="m">− ${money(t.disc)}</span></div>`:''}
    ${+t.rate?`<div class="tr"><span>${h(c.taxLabel)} ${t.rate}%</span><span class="m">${money(t.tax)}</span></div>`:''}
    <div class="tr gr"><span>Total ${h(c.currency)}</span><span class="m">${money(t.total)}</span></div>
    ${d.type==='invoice'&&paid?`<div class="tr"><span>Paid</span><span class="m">${money(paid)}</span></div><div class="tr" style="font-weight:700"><span>Balance due</span><span class="m">${money(t.total-paid)}</span></div>`:''}</div>`
    :`<div class="tot"><div class="tr"><span>Total items</span><span class="m">${(d.items||[]).length}</span></div><div class="tr"><span>Total quantity</span><span class="m">${(d.items||[]).reduce((s,i)=>s+(+i.qty||0),0)}</span></div><div class="tr"><span>Serials recorded</span><span class="m">${(d.items||[]).reduce((s,i)=>s+(i.serials||[]).length,0)}</span></div></div>`;
  const dl=d.delivery||{};
  const right=isDN?`<div class="sig"><div class="img">${dl.signature?`<img src="${h(dl.signature)}" alt="">`:''}</div><div class="ln"><b>Received by: ${h(dl.receiver||'')}</b><br>${dl.receiverPhone?h(dl.receiverPhone)+' · ':''}${dl.signedAt?fdt(dl.signedAt):'Name, signature & date'}</div></div>`
    :`<div class="sig"><div class="img"></div><div class="ln"><b>${isQ?'Accepted by':'Received by'}</b><br>Name, signature, company stamp & date</div></div>`;
  return `<div class="sheet" style="--b:${h(c.brand)};--c:${h(c.charcoal)}">${sheetHead(title,d.number)}
  <div class="meta"><div class="box"><div class="k">${isDN?'Deliver to':isQ?'Prepared for':'Bill to'}</div><div class="cn">${h(cl.name||'—')}</div>
    <div class="ad" style="white-space:pre-line;color:#5d6168">${h([cl.contact,cl.address,[cl.phone,cl.email].filter(Boolean).join(' · '),cl.taxId?`${c.taxIdLabel}: ${cl.taxId}`:''].filter(Boolean).join('\n'))}</div>
    ${isDN&&d.deliveryAddress?`<div class="k" style="margin-top:8px">Site / address</div><div style="white-space:pre-line">${h(d.deliveryAddress)}</div>`:''}</div>
    <div class="box dg">${det.map(([k,v])=>`<span>${h(k)}</span><span>${h(v)}</span>`).join('')}</div></div>
  ${d.subject?`<div class="subj">Subject: ${h(d.subject)}</div>`:''}
  <table><thead>${head}</thead><tbody>${rows||`<tr><td colspan="8" style="color:#999;text-align:center;padding:20px">No items</td></tr>`}</tbody></table>
  <div class="foot"><div style="display:flex;flex-direction:column;gap:10px">${showPrice?`<div class="words">${h(numWords(t.total))}</div>`:''}
    ${d.notes?`<div><div class="box" style="padding:8px 10px"><div class="k">Notes</div><div class="terms">${h(d.notes)}</div></div></div>`:''}
    ${d.terms?`<div><div class="k" style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#8a8d93;font-weight:600">Terms & conditions</div><div class="terms">${h(d.terms)}</div></div>`:''}
    ${d.type!=='delivery'&&c.bank?`<div><div class="k" style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#8a8d93;font-weight:600">Bank details</div><div class="terms">${h(c.bank)}</div></div>`:''}
    ${stamp?`<div>${stamp}</div>`:''}</div>${totalsHtml}</div>
  <div class="sigs"><div class="sig"><div class="img">${c.signature?img(c.signature):''}</div><div class="ln"><b>For ${h(c.name)}</b><br>${h(c.signName||'Authorised signatory')}${isDN&&dl.deliveredBy?' · Delivered by '+h(nameOf(dl.deliveredBy,dl.deliveredByName)):''}</div></div>${right}</div>
  ${sheetFoot()}</div>`;
}
function renderSOA(cid,from,to){
  const x=soaData(cid,from,to),c=S.cfg,cl=x.c;
  const rows=[`<tr><td class="m">${fdate(from)}</td><td colspan="3"><b>Balance brought forward</b></td><td></td><td></td><td class="r m"><b>${money(x.open)}</b></td></tr>`]
    .concat(x.rows.map(r=>`<tr><td class="m">${fdate(r.date)}</td><td>${h(r.kind)}</td><td class="m">${h(r.no)}</td><td>${h(r.ref)}</td><td class="r m">${r.dr?money(r.dr):''}</td><td class="r m">${r.cr?money(r.cr):''}</td><td class="r m">${money(r.bal)}</td></tr>`)).join('');
  return `<div class="sheet" style="--b:${h(c.brand)};--c:${h(c.charcoal)}">${sheetHead('Statement of Account','')}
  <div class="meta"><div class="box"><div class="k">Customer</div><div class="cn">${h(cl.name)}</div><div style="white-space:pre-line;color:#5d6168">${h([cl.contact,cl.address,[cl.phone,cl.email].filter(Boolean).join(' · '),cl.taxId?`${c.taxIdLabel}: ${cl.taxId}`:''].filter(Boolean).join('\n'))}</div></div>
  <div class="box dg"><span>Period</span><span>${fdate(from)} – ${fdate(to)}</span><span>Statement date</span><span>${fdate(today())}</span><span>Currency</span><span>${h(c.currency)}</span>${cl.creditDays?`<span>Credit terms</span><span>${h(cl.creditDays)} days</span>`:''}</div></div>
  <div class="sum4"><div><div class="k">Opening balance</div><div class="v">${money(x.open)}</div></div><div><div class="k">Invoiced</div><div class="v">${money(x.invd)}</div></div><div><div class="k">Received</div><div class="v">${money(x.recd)}</div></div><div class="dk"><div class="k">Balance due</div><div class="v">${money(x.close)}</div></div></div>
  <table><thead><tr><th style="width:84px">Date</th><th>Transaction</th><th style="width:110px">Number</th><th>Reference</th><th class="r" style="width:86px">Debit</th><th class="r" style="width:86px">Credit</th><th class="r" style="width:96px">Balance</th></tr></thead><tbody>${rows}</tbody></table>
  <div><div class="k" style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#8a8d93;font-weight:600;margin-bottom:6px">Ageing of balance as of ${fdate(to)}</div>
  <div class="aging">${[['Current',x.ag.cur],['1–30 days',x.ag.a30],['31–60 days',x.ag.a60],['61–90 days',x.ag.a90],['Over 90',x.ag.a90p],['Total due',x.close]].map(([k,v])=>`<div><div class="k">${k}</div><div class="m">${money(v)}</div></div>`).join('')}</div></div>
  ${c.bank?`<div><div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#8a8d93;font-weight:600">Bank details</div><div class="terms">${h(c.bank)}</div></div>`:''}
  <div class="terms">Please review this statement and report any differences within 7 days. Thank you for your business.</div>
  <div class="sigs"><div class="sig"><div class="img">${c.signature?img(c.signature):''}</div><div class="ln"><b>For ${h(c.name)}</b><br>${h(c.signName||'Accounts department')}</div></div><div class="sig"><div class="img"></div><div class="ln"><b>Confirmed by customer</b><br>Signature & stamp</div></div></div>
  ${sheetFoot()}</div>`;
}
function fitPreview(host){const w=host.clientWidth-24;const k=Math.min(1,w/794);const sc=$('.preview-scale',host);if(!sc)return;sc.style.transform=`scale(${k})`;sc.style.width='794px';host.style.height=(sc.firstElementChild.offsetHeight*k+24)+'px'}
const isNative=()=>!!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform());
async function downloadPdf(html,filename){
  if(!window.html2pdf){toast('PDF tool is still loading. Try again in a moment.',true);return}
  toast('Preparing PDF…');
  const st=document.createElement('div');st.className='pdf-stage';st.innerHTML=html;document.body.appendChild(st);
  try{
    await Promise.all($$('img[data-ref^="img:"]',st).map(async i=>{i.src=(await loadImg(i.dataset.ref.slice(4)))||BLANK}));
    await Promise.all($$('img',st).map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r})));
    const w=html2pdf().set({margin:0,filename,image:{type:'jpeg',quality:.96},html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff'},
      jsPDF:{unit:'px',format:[794,1123],orientation:'portrait',hotfixes:['px_scaling']},pagebreak:{mode:['css','legacy'],avoid:['tr','.foot','.sigs','.aging']}}).from(st.firstElementChild);
    if(isNative()){
      const uri=await w.outputPdf('datauristring');const P=window.Capacitor.Plugins;
      const r=await P.Filesystem.writeFile({path:filename,data:uri.split(',')[1],directory:'CACHE'});
      await P.Share.share({title:filename,url:r.uri,dialogTitle:'Send or save PDF'});
    }else{
      const blob=await w.outputPdf('blob');const file=new File([blob],filename,{type:'application/pdf'});
      if(matchMedia('(pointer:coarse)').matches&&navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:filename})}
      else{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);toast('PDF downloaded')}
    }
  }catch(e){if(/abort|cancel|declin/i.test((e&&(e.name||e.message))||''))toast('Cancelled');else toast('Could not create the PDF: '+(e.message||e),true)}
  finally{st.remove()}
}

/* ================= shell ================= */
function navItems(){
  const n=[['home','Overview',I.home]];
  if(can('quotation')||can('invoice')||can('viewAll'))n.push(['docs','Documents',I.doc]);
  if(can('delivery')||can('deliver'))n.push(['deliveries','Deliveries',I.truck]);
  if(can('clients')||can('reports'))n.push(['clients','Clients & SOA',I.users]);
  if(can('payments')||can('reports'))n.push(['payments','Payments',I.cash]);
  if(can('clients'))n.push(['products','Products',I.box]);
  if(isAdmin()){n.push(['sep']);n.push(['staff','Staff & access',I.shield]);n.push(['settings','Company & template',I.gear])}
  return n;
}
function render(){
  const app=$('#app');
  if(S.me.role==='loading'){app.innerHTML='<div class="loading">Loading your workspace…</div>';return}
  if(S.me.role==='login'){loginScreen();return}
  if(S.me.role==='pending'||S.me.role==='disabled'){app.innerHTML=`<div class="loading"><div class="card pad" style="max-width:420px;text-align:center;display:flex;flex-direction:column;gap:8px"><h2>${S.me.role==='pending'?'Waiting for access':'Access turned off'}</h2><p class="muted" style="margin:0">${S.me.role==='pending'?'Your request has been sent. The admin will set what you can do here, then this page updates by itself.':'Your access to this workspace was turned off by the admin.'}</p></div></div>`;return}
  const rs=document.documentElement.style;if(S.cfg.brand)rs.setProperty('--brand',S.cfg.brand);if(S.cfg.charcoal)rs.setProperty('--rail',S.cfg.charcoal);
  const cur=S.view;const nav=navItems();
  const v=VIEWS[cur]?VIEWS[cur]():VIEWS.home();
  const logo=S.cfg.logo?img(S.cfg.logo):h((S.cfg.name||'L').slice(0,4));
  app.innerHTML=`<div class="app"><aside class="rail"><div class="brand"><div class="mark">${logo}</div><div><b>${h(S.cfg.name)}</b><small>Invoicing</small></div></div>
    ${nav.map(([k,l,ic])=>k==='sep'?'<div class="nav-sep"></div>':`<button class="nav-btn ${cur===k||(S.params.from===k)?'on':''}" data-go="${k}">${ic}${l}</button>`).join('')}
    <div class="who"><div style="color:#fff;font-weight:600">${h(S.me.name)}</div>${isAdmin()?'Admin':'Staff'} · <button class="btn ghost sm" data-logout style="color:inherit;padding:0 4px;min-height:0">Sign out</button></div></aside>
    <div style="min-width:0"><div class="topbar"><div class="brand"><div class="mark">${logo}</div><div><b>${h(S.cfg.name)}</b></div></div><span class="grow"></span><button class="btn sm" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.25)" data-menu>${I.menu}</button></div>
    <main class="main"><div class="wrap">${v}</div></main></div>
    <nav class="tabbar">${tabbar(cur)}</nav></div>`;
  bindCommon(app);
  if(VIEWS_AFTER[cur])VIEWS_AFTER[cur]();
  $$('.preview-wrap').forEach(fitPreview);
}
function tabbar(cur){
  const t=[['home','Home',I.home]];
  if(can('quotation')||can('invoice')||can('viewAll'))t.push(['docs','Docs',I.doc]);else t.push(['deliveries','Deliveries',I.truck]);
  t.push(['new','New',I.plus]);
  if(can('clients')||can('reports'))t.push(['clients','Clients',I.users]);else if(can('deliver'))t.push(['deliveries','Deliver',I.truck]);
  t.push(['more','More',I.menu]);
  return t.slice(0,5).map(([k,l,ic])=>k==='new'?`<button class="plus" data-new aria-label="New document"><span>${ic}</span></button>`:`<button class="${cur===k?'on':''}" ${k==='more'?'data-menu':`data-go="${k}"`}>${ic}${l}</button>`).join('');
}
function bindCommon(root){
  $$('[data-go]',root).forEach(b=>b.onclick=()=>go(b.dataset.go));
  $$('[data-new]',root).forEach(b=>b.onclick=newMenu);
  $$('[data-logout]',root).forEach(b=>b.onclick=()=>signOut(auth));
  $$('[data-menu]',root).forEach(b=>b.onclick=()=>{const o=modal('Menu',`<div class="list card">${navItems().filter(n=>n[0]!=='sep').map(([k,l,ic])=>`<button class="li" data-g="${k}"><span class="ico q">${ic.replace('<svg','<svg width="18" height="18"')}</span><span class="t">${l}</span><span></span></button>`).join('')}<button class="li" data-lo><span class="ico q">⏻</span><span class="t">Sign out (${h(S.me.name)})</span><span></span></button></div>`);$('[data-lo]',o).onclick=()=>{closeModal();signOut(auth)};$$('[data-g]',o).forEach(b=>b.onclick=()=>go(b.dataset.g))});
  $$('[data-open]',root).forEach(b=>b.onclick=()=>go('view',{id:b.dataset.open}));
}
function newMenu(){
  const opts=[];
  if(can('quotation'))opts.push(['quotation','Quotation','Price offer with product photos']);
  if(can('invoice'))opts.push(['invoice','Invoice','Bill a client, track payment']);
  if(can('delivery'))opts.push(['delivery','Delivery note','Items, serial numbers and signature']);
  if(can('payments'))opts.push(['payment','Payment received','Record money from a client']);
  if(!opts.length){toast('You don\'t have permission to create documents.',true);return}
  const o=modal('Create new',`<div class="list card">${opts.map(([k,t,s])=>`<button class="li" data-k="${k}"><span class="ico ${k==='payment'?'p':TYPE[k].c}">${k==='payment'?'PAY':TYPE[k].a}</span><span style="min-width:0"><div class="t">${t}</div><div class="s">${s}</div></span><span></span></button>`).join('')}</div>`);
  $$('[data-k]',o).forEach(b=>b.onclick=()=>{closeModal();b.dataset.k==='payment'?paymentForm():go('edit',{type:b.dataset.k})});
}

/* ================= views ================= */
const VIEWS={},VIEWS_AFTER={};
function docRow(d){
  const [s,k]=docStatus(d);const t=totals(d);
  return `<button class="li" data-open="${d.id}"><span class="ico ${TYPE[d.type].c}">${TYPE[d.type].a}</span><span style="min-width:0"><div class="t">${h(d.client&&d.client.name||'No client')}</div><div class="s"><span class="num">${h(d.number)}</span> · ${fdate(d.date)}${d.ref?' · '+h(d.ref):''}</div></span>
  <span class="r">${d.type!=='delivery'?`<div class="num">${money(t.total)}</div>`:`<div class="num muted">${(d.items||[]).length} items</div>`}<span class="pill ${k}">${h(s)}</span></span></button>`;
}
VIEWS.home=()=>{
  const ym=today().slice(0,7);const docs=visibleDocs();
  const inv=S.docs.filter(d=>d.type==='invoice');
  const out=r2(S.clients.reduce((s,c)=>s+clientBalance(c.id),0));
  const monthInv=r2(inv.filter(d=>(d.date||'').startsWith(ym)).reduce((s,d)=>s+totals(d).total,0));
  const monthRec=r2(S.payments.filter(p=>(p.date||'').startsWith(ym)).reduce((s,p)=>s+(+p.amount||0),0));
  const pend=docs.filter(d=>d.type==='delivery'&&!(d.delivery&&d.delivery.signedAt));
  const overdue=inv.filter(d=>invStatus(d)[0].includes('overdue'));
  const recent=docs.slice().sort((a,b)=>(b.updatedAt||'')>(a.updatedAt||'')?1:-1).slice(0,8);
  const money4=can('reports');
  return `<div class="head"><div><h1>Overview</h1><div class="sub">${fdate(today())}</div></div><div class="row">${can('quotation')?`<button class="btn" data-q="quotation">${I.plus}Quotation</button>`:''}${can('invoice')?`<button class="btn" data-q="invoice">${I.plus}Invoice</button>`:''}${can('delivery')?`<button class="btn primary" data-q="delivery">${I.plus}Delivery note</button>`:''}</div></div>
  ${money4?`<div class="kpis"><div class="card kpi hl"><span class="label">Receivable</span><span class="v">${money(out)}<small>${h(S.cfg.currency)}</small></span><span style="font-size:.78rem;color:#bbb">${overdue.length} invoice${overdue.length===1?'':'s'} overdue</span></div>
    <div class="card kpi"><span class="label">Invoiced this month</span><span class="v">${money(monthInv)}</span></div>
    <div class="card kpi"><span class="label">Received this month</span><span class="v">${money(monthRec)}</span></div>
    <div class="card kpi"><span class="label">Pending deliveries</span><span class="v">${pend.length}</span></div></div>`:''}
  ${pend.length&&can('deliver')?`<div class="card"><div class="pad row"><h2 class="grow">Waiting to be delivered</h2><button class="btn sm" data-go="deliveries">All deliveries</button></div><div class="list">${pend.slice(0,5).map(docRow).join('')}</div></div>`:''}
  ${money4&&overdue.length?`<div class="card"><div class="pad"><h2>Overdue invoices</h2></div><div class="list">${overdue.slice(0,5).map(docRow).join('')}</div></div>`:''}
  <div class="card"><div class="pad"><h2>Recent activity</h2></div><div class="list">${recent.length?recent.map(docRow).join(''):`<div class="empty"><b>No documents yet</b>Create your first quotation, invoice or delivery note with the buttons above.</div>`}</div></div>`;
};
VIEWS_AFTER.home=()=>$$('[data-q]').forEach(b=>b.onclick=()=>go('edit',{type:b.dataset.q}));

VIEWS.docs=()=>{
  const tab=S.params.tab||(can('invoice')?'invoice':can('quotation')?'quotation':'delivery');const q=(S.params.q||'').toLowerCase();
  const list=visibleDocs().filter(d=>d.type===tab).filter(d=>!q||[d.number,d.client&&d.client.name,d.ref,d.subject].join(' ').toLowerCase().includes(q)).sort((a,b)=>(b.date+b.number)>(a.date+a.number)?1:-1);
  const total=list.reduce((s,d)=>s+totals(d).total,0);
  return `<div class="head"><div><h1>Documents</h1><div class="sub">${list.length} ${TYPE[tab].p.toLowerCase()}${tab!=='delivery'?` · ${cur(total)}`:''}</div></div>${can(tab)||tab==='delivery'&&can('delivery')?`<button class="btn primary" id="nd">${I.plus}New ${TYPE[tab].t.replace('Tax ','').toLowerCase()}</button>`:''}</div>
  <div class="row"><div class="seg">${['quotation','invoice','delivery'].map(t=>`<button class="${t===tab?'on':''}" data-tab="${t}">${TYPE[t].p}</button>`).join('')}</div><span class="grow"></span><input class="search" id="dq" placeholder="Search number, client, LPO…" value="${h(S.params.q||'')}"></div>
  <div class="card list">${list.length?list.map(docRow).join(''):`<div class="empty"><b>No ${TYPE[tab].p.toLowerCase()} found</b>${q?'Try a different search.':'Use the New button to make one.'}</div>`}</div>`;
};
VIEWS_AFTER.docs=()=>{
  $$('[data-tab]').forEach(b=>b.onclick=()=>go('docs',{tab:b.dataset.tab}));
  const nd=$('#nd');if(nd)nd.onclick=()=>go('edit',{type:S.params.tab||(can('invoice')?'invoice':can('quotation')?'quotation':'delivery')});
  const dq=$('#dq');dq.oninput=()=>{S.params.q=dq.value;clearTimeout(dq._t);dq._t=setTimeout(()=>{const p=dq.selectionStart;render();const n=$('#dq');n.focus();n.setSelectionRange(p,p)},250)};
};
VIEWS.deliveries=()=>{
  const tab=S.params.tab||'pending';
  const all=visibleDocs().filter(d=>d.type==='delivery');
  const list=all.filter(d=>tab==='pending'?!(d.delivery&&d.delivery.signedAt):(d.delivery&&d.delivery.signedAt)).sort((a,b)=>(b.date>a.date?1:-1));
  return `<div class="head"><div><h1>Deliveries</h1><div class="sub">${all.filter(d=>!(d.delivery&&d.delivery.signedAt)).length} waiting · ${all.filter(d=>d.delivery&&d.delivery.signedAt).length} delivered</div></div>${can('delivery')?`<button class="btn primary" id="nd">${I.plus}New delivery note</button>`:''}</div>
  <div class="seg"><button class="${tab==='pending'?'on':''}" data-tab="pending">Waiting</button><button class="${tab==='done'?'on':''}" data-tab="done">Delivered</button></div>
  <div class="card list">${list.length?list.map(docRow).join(''):`<div class="empty"><b>${tab==='pending'?'Nothing waiting to deliver':'No completed deliveries yet'}</b>${tab==='pending'?'New delivery notes appear here until they are signed.':''}</div>`}</div>`;
};
VIEWS_AFTER.deliveries=()=>{$$('[data-tab]').forEach(b=>b.onclick=()=>go('deliveries',{tab:b.dataset.tab}));const nd=$('#nd');if(nd)nd.onclick=()=>go('edit',{type:'delivery'})};

/* ----- document view ----- */
VIEWS.view=()=>{
  const d=S.docs.find(x=>x.id===S.params.id);if(!d)return `<div class="empty"><b>Document not found</b>It may have been deleted.</div>`;
  const [s,k]=docStatus(d);const t=totals(d);const canEdit=can(d.type)&&!(d.type==='delivery'&&d.delivery&&d.delivery.signedAt&&!isAdmin());
  const paid=d.type==='invoice'?paidOn(d.id):0;const kids=S.docs.filter(x=>x.sourceId===d.id);const src=d.sourceId&&S.docs.find(x=>x.id===d.sourceId);
  const pays=S.payments.filter(p=>p.invoiceId===d.id);
  return `<div class="head"><div class="row"><button class="btn ghost sm" id="bk">${I.back}Back</button><div><h1 class="num" style="font-family:var(--f-display)">${h(d.number)}</h1><div class="sub">${TYPE[d.type].t} · ${h(d.client&&d.client.name||'')}</div></div></div>
   <div class="row"><button class="btn primary" id="pdf">${I.pdf}Download PDF</button>${canEdit?`<button class="btn" id="ed">${I.pen}Edit</button>`:''}</div></div>
  <div class="view-grid"><div class="card preview-wrap"><div class="preview-scale">${renderSheet(d)}</div></div>
  <aside class="side">
   <div class="card pad"><div class="row" style="margin-bottom:8px"><h3 class="grow">Status</h3><span class="pill ${k}">${h(s)}</span></div>
    ${d.type!=='delivery'?`<div class="kv"><span class="muted">Total</span><span class="num">${cur(t.total)}</span></div>`:''}
    ${d.type==='invoice'?`<div class="kv"><span class="muted">Paid</span><span class="num">${money(paid)}</span></div><div class="kv"><span class="muted">Balance</span><b class="num">${money(t.total-paid)}</b></div>`:''}
    <div class="kv"><span class="muted">Created by</span><span>${h(nameOf(d.createdBy,d.createdByName))}</span></div>
    ${d.delivery&&d.delivery.signedAt?`<div class="kv"><span class="muted">Signed</span><span>${fdt(d.delivery.signedAt)}</span></div>`:''}
    ${src?`<div class="kv"><span class="muted">From</span><a href="#" data-open="${src.id}">${h(src.number)}</a></div>`:''}
    ${kids.map(x=>`<div class="kv"><span class="muted">${TYPE[x.type].t}</span><a href="#" data-open="${x.id}">${h(x.number)}</a></div>`).join('')}
   </div>
   <div class="card pad" style="display:flex;flex-direction:column;gap:8px"><h3>Actions</h3>
    ${d.type==='delivery'&&!(d.delivery&&d.delivery.signedAt)&&can('deliver')?`<button class="btn primary" id="dlv">${I.scan}Deliver: scan & sign</button>`:''}
    ${d.type==='invoice'&&can('payments')&&paid<t.total?`<button class="btn primary" id="pay">${I.cash}Record payment</button>`:''}
    ${d.type==='quotation'&&can('quotation')?`<select id="qs" aria-label="Quotation status">${['draft','sent','accepted','rejected'].map(x=>`<option ${(d.status||'draft')===x?'selected':''} value="${x}">Mark as ${x}</option>`).join('')}</select>`:''}
    ${d.type==='quotation'&&can('invoice')?`<button class="btn" data-conv="invoice">Convert to invoice</button>`:''}
    ${(d.type==='quotation'||d.type==='invoice')&&can('delivery')?`<button class="btn" data-conv="delivery">Make delivery note</button>`:''}
    ${can(d.type)?`<button class="btn" id="dup">Duplicate</button>`:''}
    ${d.client&&d.clientId&&can('reports')?`<button class="btn" id="soa">Client statement (SOA)</button>`:''}
    ${can('delete')||isAdmin()?`<button class="btn danger" id="del">Delete</button>`:''}
   </div>
   ${pays.length?`<div class="card pad"><h3 style="margin-bottom:6px">Payments</h3>${pays.map(p=>`<div class="kv"><span>${fdate(p.date)} · ${h(p.method||'')}</span><span class="num">${money(p.amount)}</span></div>`).join('')}</div>`:''}
  </aside></div>`;
};
VIEWS_AFTER.view=()=>{
  const d=S.docs.find(x=>x.id===S.params.id);$('#bk')&&($('#bk').onclick=()=>history.length&&S.params.back?go(S.params.back,S.params.backp||{}):go(d&&d.type==='delivery'&&!can('viewAll')?'deliveries':'docs',{tab:d&&d.type}));
  if(!d)return;
  $$('[data-open]').forEach(a=>a.onclick=e=>{e.preventDefault();go('view',{id:a.dataset.open})});
  $('#pdf').onclick=()=>downloadPdf(renderSheet(d),`${d.number} ${(d.client&&d.client.name)||''}.pdf`.replace(/[\\/:*?"<>|]/g,'').trim());
  $('#ed')&&($('#ed').onclick=()=>go('edit',{id:d.id}));
  $('#dlv')&&($('#dlv').onclick=()=>go('deliver',{id:d.id}));
  $('#pay')&&($('#pay').onclick=()=>paymentForm({clientId:d.clientId,invoiceId:d.id}));
  $('#qs')&&($('#qs').onchange=e=>save('docs',d.id,{...d,status:e.target.value,updatedAt:new Date().toISOString()},'Status updated'));
  $$('[data-conv]').forEach(b=>b.onclick=()=>go('edit',{type:b.dataset.conv,from:d.id}));
  $('#dup')&&($('#dup').onclick=()=>go('edit',{type:d.type,copy:d.id}));
  $('#soa')&&($('#soa').onclick=()=>go('client',{id:d.clientId}));
  $('#del')&&($('#del').onclick=async()=>{if(!await confirmBox('Delete '+d.number+'?','This removes the document for everyone. Payments recorded against it stay on the client account.'))return;try{await Store.remove('docs',d.id);toast('Deleted');go('docs',{tab:d.type})}catch(e){toast('Could not delete: '+(e.message||e.code),true)}});
};

/* ----- editor ----- */
let ED=null;
function newDraft(type){
  const date=today();
  return {id:uid(),type,number:nextNumber(type,date),date,dueDate:type==='invoice'?addDays(date,S.cfg.dueDays):'',validUntil:type==='quotation'?addDays(date,S.cfg.validDays):'',
    clientId:'',client:null,ref:'',subject:'',salesperson:'',deliveryAddress:'',items:[{name:'',desc:'',qty:1,unit:'pcs',price:0,photo:''}],discount:0,taxRate:S.cfg.taxRate,
    notes:'',terms:S.cfg.terms[type]||'',status:type==='quotation'?'draft':'',createdBy:S.me.id,createdByName:S.me.name,createdAt:new Date().toISOString(),_new:true};
}
VIEWS.edit=()=>{
  const p=S.params;
  if(!ED||ED._key!==JSON.stringify(p)){
    if(p.id){ED=clone(S.docs.find(x=>x.id===p.id)||newDraft('invoice'))}
    else{ED=newDraft(p.type);const srcId=p.from||p.copy;const src=srcId&&S.docs.find(x=>x.id===srcId);
      if(src){Object.assign(ED,{clientId:src.clientId,client:src.client,ref:src.ref,subject:src.subject,salesperson:src.salesperson,items:clone(src.items||[]).map(i=>({...i,serials:p.type==='delivery'?(i.serials||[]):[]})),discount:src.discount,taxRate:src.taxRate,notes:src.notes});
        if(p.from)ED.sourceId=src.id; if(p.copy){ED.terms=src.terms}}}
    ED._key=JSON.stringify(p);
  }
  const d=ED,isQ=d.type==='quotation',isDN=d.type==='delivery';
  const cls='item'+(isDN?' dn':isQ?'':' noimg');
  const t=totals(d);
  return `<div class="head"><div class="row"><button class="btn ghost sm" id="cx">${I.back}Cancel</button><div><h1>${d._new?'New':'Edit'} ${TYPE[d.type].t.replace('Tax ','').toLowerCase()}</h1><div class="sub num">${h(d.number)}</div></div></div><div class="row"><button class="btn primary" id="sv">Save</button></div></div>
  <div class="card pad grid">
   <div class="grid g4">
    <label class="field" style="grid-column:span 2"><span>Client</span><div class="row" style="flex-wrap:nowrap"><select id="e-client"><option value="">Choose a client…</option>${S.clients.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${c.id}" ${c.id===d.clientId?'selected':''}>${h(c.name)}</option>`).join('')}</select>${can('clients')?`<button class="btn" id="e-nc" title="Add client">${I.plus}</button>`:''}</div></label>
    <label class="field"><span>Number</span><input id="e-number" value="${h(d.number)}"></label>
    <label class="field"><span>Date</span><input type="date" id="e-date" value="${h(d.date)}"></label>
    ${d.type==='invoice'?`<label class="field"><span>Due date</span><input type="date" id="e-dueDate" value="${h(d.dueDate)}"></label>`:''}
    ${isQ?`<label class="field"><span>Valid until</span><input type="date" id="e-validUntil" value="${h(d.validUntil)}"></label>`:''}
    <label class="field"><span>${isQ?'Client reference':'LPO / reference'}</span><input id="e-ref" value="${h(d.ref)}"></label>
    <label class="field"><span>Salesperson</span><input id="e-salesperson" value="${h(d.salesperson)}"></label>
    <label class="field" style="grid-column:span ${isDN?1:2}"><span>Subject</span><input id="e-subject" value="${h(d.subject)}" placeholder="e.g. Supply of CCTV equipment"></label>
    ${isDN?`<label class="field" style="grid-column:span 2"><span>Delivery site / address</span><input id="e-deliveryAddress" value="${h(d.deliveryAddress)}"></label>`:''}
   </div>
  </div>
  <div class="card pad grid"><div class="row"><h2 class="grow">Items</h2><button class="btn sm" id="scan-add">${I.scan}Scan product</button></div>
   <datalist id="prodlist">${S.products.map(p=>`<option value="${h(p.name)}">`).join('')}</datalist>
   <div class="items">${d.items.map((i,n)=>`<div class="${cls}" data-i="${n}">
     ${isQ?`<button class="photo" data-photo="${n}" type="button" aria-label="Add product photo">${i.photo?img(i.photo):'+ Photo'}</button>`:''}
     <div class="desc"><input list="prodlist" data-f="name" value="${h(i.name)}" placeholder="Item name"><textarea data-f="desc" rows="1" placeholder="Description, model, specs">${h(i.desc)}</textarea>${isDN&&(i.serials||[]).length?`<div class="serials">${i.serials.map(s=>`<span class="chip">${h(s)}</span>`).join('')}</div>`:''}</div>
     <label class="field f-q"><span>Qty</span><input type="number" step="any" min="0" data-f="qty" value="${h(i.qty)}"></label>
     <label class="field f-u"><span>Unit</span><input data-f="unit" value="${h(i.unit)}"></label>
     ${isDN?'':`<label class="field f-p"><span>Rate</span><input type="number" step="any" min="0" data-f="price" value="${h(i.price)}"></label><div class="amt"><span class="label">Amount</span><br><span data-amt="${n}">${money((+i.qty||0)*(+i.price||0))}</span></div>`}
     <button class="xbtn" data-rm="${n}" aria-label="Remove item">✕</button></div>`).join('')}</div>
   <div><button class="btn" id="add-item">${I.plus}Add item</button></div>
   ${isDN?'':`<div class="totals"><div class="tr"><span class="muted">Subtotal</span><span class="num" id="t-sub">${money(t.sub)}</span></div>
    <div class="tr" style="align-items:center"><span class="muted">Discount</span><input type="number" step="any" id="e-discount" value="${h(d.discount)}" style="width:120px;text-align:right"></div>
    <div class="tr" style="align-items:center"><span class="muted">${h(S.cfg.taxLabel)} %</span><input type="number" step="any" id="e-taxRate" value="${h(d.taxRate)}" style="width:120px;text-align:right"></div>
    <div class="tr"><span class="muted">${h(S.cfg.taxLabel)}</span><span class="num" id="t-tax">${money(t.tax)}</span></div>
    <div class="tr grand"><span>Total</span><span class="num" id="t-total">${cur(t.total)}</span></div></div>`}
  </div>
  <div class="card pad grid g2"><label class="field"><span>Notes (shown on document)</span><textarea id="e-notes">${h(d.notes)}</textarea></label><label class="field"><span>Terms & conditions</span><textarea id="e-terms" rows="4">${h(d.terms)}</textarea></label></div>
  <div class="row"><span class="grow"></span><button class="btn" id="cx2">Cancel</button><button class="btn primary" id="sv2">Save ${TYPE[d.type].t.replace('Tax ','').toLowerCase()}</button></div>`;
};
function readEditor(){
  const d=ED;
  ['number','date','dueDate','validUntil','ref','salesperson','subject','deliveryAddress','notes','terms','discount','taxRate'].forEach(k=>{const el=$('#e-'+k);if(el)d[k]=el.type==='number'?(+el.value||0):el.value});
  $$('.items [data-i]').forEach(row=>{const it=d.items[+row.dataset.i];$$('[data-f]',row).forEach(el=>{it[el.dataset.f]=el.type==='number'?(el.value===''?'':+el.value):el.value})});
}
function updTotals(){readEditor();const t=totals(ED);if(!$('#t-sub'))return;$('#t-sub').textContent=money(t.sub);$('#t-tax').textContent=money(t.tax);$('#t-total').textContent=cur(t.total);ED.items.forEach((i,n)=>{const a=$(`[data-amt="${n}"]`);if(a)a.textContent=money((+i.qty||0)*(+i.price||0))})}
function addProduct(p){readEditor();const blank=ED.items.findIndex(i=>!i.name);const it={name:p.name,desc:p.desc||'',qty:1,unit:p.unit||'pcs',price:+p.price||0,photo:p.photo||'',pid:p.id};if(blank>=0)ED.items[blank]=it;else ED.items.push(it);render()}
VIEWS_AFTER.edit=()=>{
  const cancel=()=>{const d=ED;ED=null;d._new?go(d.sourceId?'view':'docs',d.sourceId?{id:d.sourceId}:{tab:d.type}):go('view',{id:d.id})};
  $('#cx').onclick=cancel;$('#cx2').onclick=cancel;
  $('#e-client').onchange=e=>{readEditor();ED.clientId=e.target.value;const c=S.clients.find(x=>x.id===ED.clientId);ED.client=c?clientSnap(c):null;if(c&&ED.type==='invoice'&&c.creditDays)ED.dueDate=addDays(ED.date,+c.creditDays);if(c&&ED.type==='delivery'&&!ED.deliveryAddress)ED.deliveryAddress=c.address||'';render()};
  $('#e-nc')&&($('#e-nc').onclick=()=>{readEditor();clientForm(null,c=>{ED.clientId=c.id;ED.client=clientSnap(c);render()})});
  $('#add-item').onclick=()=>{readEditor();ED.items.push({name:'',desc:'',qty:1,unit:'pcs',price:0,photo:''});render();const rows=$$('.items [data-i]');$('[data-f="name"]',rows[rows.length-1]).focus()};
  $$('[data-rm]').forEach(b=>b.onclick=()=>{readEditor();ED.items.splice(+b.dataset.rm,1);if(!ED.items.length)ED.items.push({name:'',qty:1,unit:'pcs',price:0});render()});
  $$('[data-photo]').forEach(b=>b.onclick=async()=>{const f=await pickImage();if(!f)return;readEditor();toast('Uploading photo…');ED.items[+b.dataset.photo].photo=await storeImage(f,800);render()});
  $$('.items input,.items textarea,#e-discount,#e-taxRate').forEach(el=>el.addEventListener('input',updTotals));
  $$('.items [data-f="name"]').forEach(el=>el.addEventListener('change',()=>{const p=S.products.find(x=>x.name===el.value);if(!p)return;readEditor();const it=ED.items[+el.closest('[data-i]').dataset.i];Object.assign(it,{desc:it.desc||p.desc||'',price:+p.price||it.price,unit:p.unit||it.unit,photo:it.photo||p.photo||'',pid:p.id});render()}));
  $('#scan-add').onclick=()=>openScanner(code=>{const p=S.products.find(x=>x.barcode===code||x.sku===code);if(p){addProduct(p);toast('Added '+p.name)}else{readEditor();ED.items.push({name:code,desc:'',qty:1,unit:'pcs',price:0});render();toast('Code '+code+' is not in your product list. Added as a new line.')}},{title:'Scan product'});
  const doSave=async()=>{readEditor();const d=clone(ED);
    if(!d.clientId){toast('Choose a client first.',true);return}
    d.items=d.items.filter(i=>i.name||i.desc);if(!d.items.length){toast('Add at least one item.',true);return}
    if(S.docs.some(x=>x.id!==d.id&&x.number===d.number)){toast('Number '+d.number+' is already used.',true);return}
    const c=S.clients.find(x=>x.id===d.clientId);if(c)d.client=clientSnap(c);
    delete d._new;delete d._key;d.updatedAt=new Date().toISOString();
    if(await save('docs',d.id,d,'Saved '+d.number)){ED=null;go('view',{id:d.id})}};
  $('#sv').onclick=doSave;$('#sv2').onclick=doSave;
};
const clientSnap=c=>({name:c.name,contact:c.contact||'',address:c.address||'',phone:c.phone||'',email:c.email||'',taxId:c.taxId||''});

/* ----- delivery: scan serials + sign ----- */
let DV=null,pad=null;
VIEWS.deliver=()=>{
  const d=S.docs.find(x=>x.id===S.params.id);if(!d)return '<div class="empty"><b>Delivery note not found</b></div>';
  if(!DV||DV.id!==d.id)DV={id:d.id,items:clone(d.items||[]).map(i=>({...i,serials:i.serials||[]})),receiver:'',receiverPhone:''};
  const need=DV.items.reduce((s,i)=>s+(+i.qty||0),0),got=DV.items.reduce((s,i)=>s+i.serials.length,0);
  return `<div class="head"><div class="row"><button class="btn ghost sm" id="bk">${I.back}Back</button><div><h1>Deliver ${h(d.number)}</h1><div class="sub">${h(d.client&&d.client.name||'')}${d.deliveryAddress?' · '+h(d.deliveryAddress):''}</div></div></div></div>
  <div class="card pad grid"><div class="row"><h2 class="grow">1. Serial numbers</h2><span class="muted num">${got} of ${need} scanned</span></div>
   <div class="progress"><i style="width:${need?Math.min(100,got/need*100):0}%"></i></div>
   <p class="muted" style="margin:0">Tap <b>Camera</b> to photograph a barcode, or type it and press Enter. A handheld USB/Bluetooth scanner also works in the box.</p>
   ${DV.items.map((i,n)=>`<div class="dl-item"><div class="row"><div class="grow" style="min-width:0"><b>${h(i.name)}</b><div class="muted" style="font-size:.8rem">${h(i.desc||'')}</div></div><span class="pill ${i.serials.length>=+i.qty?'good':'warn'} num">${i.serials.length}/${h(i.qty)}</span></div>
     <div class="scanrow"><input id="sn-${n}" data-sn="${n}" placeholder="Scan or type serial number" autocomplete="off"><button class="btn" data-cam="${n}">${I.scan}Camera</button></div>
     ${i.serials.length?`<div class="serials">${i.serials.map((s,k)=>`<span class="chip">${h(s)}<button data-del="${n}:${k}" aria-label="Remove ${h(s)}">×</button></span>`).join('')}</div>`:''}</div>`).join('')}
  </div>
  <div class="card pad grid"><h2>2. Receiver</h2><div class="grid g2"><label class="field"><span>Received by (name)</span><input id="rc-name" value="${h(DV.receiver)}"></label><label class="field"><span>Mobile</span><input id="rc-phone" value="${h(DV.receiverPhone)}" inputmode="tel"></label></div>
   <div class="row"><h3 class="grow">Receiver signature</h3><button class="btn sm" id="sig-clr">Clear</button></div><div class="sigpad" id="sig"></div></div>
  <div class="row"><span class="grow"></span><button class="btn" id="save-draft">Save serials only</button><button class="btn primary" id="confirm">Confirm delivery</button></div>`;
};
VIEWS_AFTER.deliver=()=>{
  const d=S.docs.find(x=>x.id===S.params.id);if(!d)return;
  pad=sigPad($('#sig'));
  const keep=()=>{DV.receiver=$('#rc-name').value;DV.receiverPhone=$('#rc-phone').value};
  const add=(n,code)=>{code=(code||'').trim();if(!code)return false;const dup=DV.items.some(i=>i.serials.includes(code));if(dup){toast(code+' is already on this note.',true);return false}
    const it=DV.items[n];if(it.serials.length>=+it.qty){toast('All '+it.qty+' serials for this item are recorded.',true);return false}
    keep();it.serials.push(code);const sig=pad&&!pad.isEmpty()?pad.toData():null;render();if(sig)pad.load(sig);const nx=$('#sn-'+n);if(!$('#scan-ov')){if(nx&&it.serials.length<+it.qty)nx.focus();else{const k=DV.items.findIndex(i=>i.serials.length<+i.qty);if(k>=0)$('#sn-'+k).focus()}}return true};
  $('#bk').onclick=()=>{DV=null;go('view',{id:d.id})};
  $$('[data-sn]').forEach(inp=>inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();add(+inp.dataset.sn,inp.value)}}));
  $$('[data-cam]').forEach(b=>b.onclick=()=>{const n=+b.dataset.cam;openScanner(code=>add(n,code),{title:'Scan serials · '+DV.items[n].name,multi:true})});
  $$('[data-del]').forEach(b=>b.onclick=()=>{const [n,k]=b.dataset.del.split(':').map(Number);keep();const sig=!pad.isEmpty()?pad.toData():null;DV.items[n].serials.splice(k,1);render();if(sig)pad.load(sig)});
  $('#sig-clr').onclick=()=>pad.clear();
  $('#save-draft').onclick=async()=>{keep();if(await save('docs',d.id,{...d,items:DV.items,updatedAt:new Date().toISOString()},'Serials saved'))go('view',{id:d.id})};
  $('#confirm').onclick=async()=>{keep();
    if(!DV.receiver.trim()){toast('Enter the receiver\'s name.',true);return}
    if(pad.isEmpty()){toast('Ask the receiver to sign in the box.',true);return}
    const missing=DV.items.reduce((s,i)=>s+Math.max(0,(+i.qty||0)-i.serials.length),0);
    if(missing&&!await confirmBox('Some serials are missing',missing+' serial number'+(missing>1?'s are':' is')+' not recorded. Confirm the delivery anyway?','Confirm anyway'))return;
    const upd={...d,items:DV.items,updatedAt:new Date().toISOString(),delivery:{receiver:DV.receiver.trim(),receiverPhone:DV.receiverPhone.trim(),signature:pad.toData(),signedAt:new Date().toISOString(),deliveredBy:S.me.id,deliveredByName:S.me.name}};
    if(await save('docs',d.id,upd,'Delivery confirmed')){DV=null;go('view',{id:d.id})}};
};
/* ----- clients ----- */
VIEWS.clients=()=>{
  const q=(S.params.q||'').toLowerCase();
  const list=S.clients.filter(c=>!q||[c.name,c.contact,c.phone,c.email].join(' ').toLowerCase().includes(q)).map(c=>({c,b:clientBalance(c.id)})).sort((a,b)=>b.b-a.b||a.c.name.localeCompare(b.c.name));
  return `<div class="head"><div><h1>Clients & SOA</h1><div class="sub">${S.clients.length} clients${can('reports')?' · '+cur(list.reduce((s,x)=>s+x.b,0))+' receivable':''}</div></div>${can('clients')?`<button class="btn primary" id="nc">${I.plus}Add client</button>`:''}</div>
  <input class="search" id="cq" placeholder="Search clients" value="${h(S.params.q||'')}">
  <div class="card list">${list.length?list.map(({c,b})=>`<button class="li" data-c="${c.id}"><span class="ico q">${h(c.name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase())}</span><span style="min-width:0"><div class="t">${h(c.name)}</div><div class="s">${h([c.contact,c.phone].filter(Boolean).join(' · ')||'No contact details')}</div></span>
   <span class="r">${can('reports')?`<div class="num" style="${b>0?'font-weight:600':''}">${money(b)}</div><span class="pill ${b>0?'warn':'good'}">${b>0?'balance due':b<0?'in credit':'settled'}</span>`:''}</span></button>`).join(''):`<div class="empty"><b>No clients yet</b>Add a client to start quoting and invoicing.</div>`}</div>`;
};
VIEWS_AFTER.clients=()=>{
  $('#nc')&&($('#nc').onclick=()=>clientForm());
  $$('[data-c]').forEach(b=>b.onclick=()=>go('client',{id:b.dataset.c,from:'clients'}));
  const cq=$('#cq');cq.oninput=()=>{S.params.q=cq.value;clearTimeout(cq._t);cq._t=setTimeout(()=>{render();const n=$('#cq');n.focus();n.setSelectionRange(n.value.length,n.value.length)},250)};
};
VIEWS.client=()=>{
  const c=S.clients.find(x=>x.id===S.params.id);if(!c)return '<div class="empty"><b>Client not found</b></div>';
  const first=[c.openingBalance?c.openingDate:null,...S.docs.filter(d=>d.clientId===c.id&&d.type==='invoice').map(d=>d.date),...S.payments.filter(p=>p.clientId===c.id).map(p=>p.date)].filter(Boolean).sort()[0]||today().slice(0,4)+'-01-01';
  const from=S.params.sf||first,to=S.params.st||today();
  const x=soaData(c.id,from,to);
  const docs=S.docs.filter(d=>d.clientId===c.id).sort((a,b)=>b.date>a.date?1:-1);
  return `<div class="head"><div class="row"><button class="btn ghost sm" id="bk">${I.back}Clients</button><div><h1>${h(c.name)}</h1><div class="sub">${h([c.contact,c.phone,c.email].filter(Boolean).join(' · '))}</div></div></div>
   <div class="row">${can('clients')?`<button class="btn" id="ec">${I.pen}Edit</button>`:''}${can('payments')?`<button class="btn" id="cp">${I.cash}Record payment</button>`:''}${can('reports')?`<button class="btn primary" id="soa">${I.pdf}SOA PDF</button>`:''}</div></div>
  ${can('reports')?`<div class="kpis"><div class="card kpi hl"><span class="label">Balance due</span><span class="v">${money(clientBalance(c.id))}<small>${h(S.cfg.currency)}</small></span></div>
   <div class="card kpi"><span class="label">Overdue 1–30</span><span class="v">${money(x.ag.a30)}</span></div><div class="card kpi"><span class="label">Overdue 31–90</span><span class="v">${money(x.ag.a60+x.ag.a90)}</span></div><div class="card kpi"><span class="label">Over 90 days</span><span class="v">${money(x.ag.a90p)}</span></div></div>
  <div class="card"><div class="pad row"><h2 class="grow">Statement of account</h2><label class="field"><span>From</span><input type="date" id="sf" value="${from}"></label><label class="field"><span>To</span><input type="date" id="st" value="${to}"></label></div>
   <div class="scroll-x"><table class="tbl"><thead><tr><th>Date</th><th>Transaction</th><th>Number</th><th>Reference</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead><tbody>
   <tr><td class="num">${fdate(from)}</td><td colspan="5"><b>Balance brought forward</b></td><td class="r num"><b>${money(x.open)}</b></td></tr>
   ${x.rows.map(r=>`<tr><td class="num">${fdate(r.date)}</td><td>${h(r.kind)}</td><td class="num">${r.id?`<a href="#" data-open="${r.id}">${h(r.no)}</a>`:h(r.no)}</td><td>${h(r.ref)}</td><td class="r num">${r.dr?money(r.dr):''}</td><td class="r num">${r.cr?money(r.cr):''}</td><td class="r num">${money(r.bal)}</td></tr>`).join('')}
   <tr><td colspan="4"><b>Closing balance</b></td><td class="r num"><b>${money(x.invd)}</b></td><td class="r num"><b>${money(x.recd)}</b></td><td class="r num"><b>${money(x.close)}</b></td></tr></tbody></table></div></div>`:''}
  <div class="card"><div class="pad"><h2>Documents</h2></div><div class="list">${docs.filter(d=>visibleDocs().includes(d)).map(docRow).join('')||'<div class="empty">No documents for this client yet.</div>'}</div></div>`;
};
VIEWS_AFTER.client=()=>{
  const c=S.clients.find(x=>x.id===S.params.id);$('#bk')&&($('#bk').onclick=()=>go('clients'));if(!c)return;
  $('#ec')&&($('#ec').onclick=()=>clientForm(c));
  $('#cp')&&($('#cp').onclick=()=>paymentForm({clientId:c.id}));
  $$('[data-open]').forEach(a=>a.onclick=e=>{e.preventDefault();go('view',{id:a.dataset.open})});
  const sf=$('#sf'),st=$('#st');if(sf){const ch=()=>{S.params.sf=sf.value;S.params.st=st.value;render()};sf.onchange=ch;st.onchange=ch}
  $('#soa')&&($('#soa').onclick=()=>{const f=$('#sf').value,t=$('#st').value;downloadPdf(renderSOA(c.id,f,t),`SOA ${c.name} ${t}.pdf`.replace(/[\\/:*?"<>|]/g,''))});
};
function clientForm(c,after){
  const e=c||{};
  const o=modal(c?'Edit client':'New client',`<div class="grid g2">
   <label class="field" style="grid-column:1/-1"><span>Company / client name</span><input id="c-name" value="${h(e.name)}"></label>
   <label class="field"><span>Contact person</span><input id="c-contact" value="${h(e.contact)}"></label><label class="field"><span>Phone</span><input id="c-phone" value="${h(e.phone)}"></label>
   <label class="field"><span>Email</span><input id="c-email" value="${h(e.email)}"></label><label class="field"><span>${h(S.cfg.taxIdLabel)}</span><input id="c-taxId" value="${h(e.taxId)}"></label>
   <label class="field" style="grid-column:1/-1"><span>Address</span><textarea id="c-address">${h(e.address)}</textarea></label>
   <label class="field"><span>Credit days</span><input type="number" id="c-creditDays" value="${h(e.creditDays??S.cfg.dueDays)}"></label><span></span>
   <label class="field"><span>Old balance (before using this app)</span><input type="number" step="any" id="c-openingBalance" value="${h(e.openingBalance||'')}" placeholder="0.00"></label>
   <label class="field"><span>Old balance as of</span><input type="date" id="c-openingDate" value="${h(e.openingDate||today())}"></label></div>`,
   `${c&&isAdmin()?'<button class="btn danger" id="c-del">Delete</button><span class="grow"></span>':''}<button class="btn" data-x>Cancel</button><button class="btn primary" id="c-save">Save client</button>`);
  $('#c-save',o).onclick=async()=>{const d={...e};['name','contact','phone','email','taxId','address','openingDate'].forEach(k=>d[k]=$('#c-'+k,o).value.trim());d.creditDays=+$('#c-creditDays',o).value||0;d.openingBalance=+$('#c-openingBalance',o).value||0;
    if(!d.name){toast('Enter the client name.',true);return}const id=e.id||uid();d.updatedAt=new Date().toISOString();
    if(await save('clients',id,d,'Client saved')){closeModal();d.id=id;if(after)after(d)}};
  $('#c-del',o)&&($('#c-del',o).onclick=async()=>{if(S.docs.some(x=>x.clientId===e.id)){toast('This client has documents. Delete those first.',true);return}if(!await confirmBox('Delete client?',e.name+' will be removed.'))return;await Store.remove('clients',e.id);go('clients')});
}

/* ----- payments ----- */
VIEWS.payments=()=>{
  const list=S.payments.slice().sort((a,b)=>b.date>a.date?1:-1);
  const ym=today().slice(0,7);
  return `<div class="head"><div><h1>Payments</h1><div class="sub">${cur(list.filter(p=>(p.date||'').startsWith(ym)).reduce((s,p)=>s+(+p.amount||0),0))} received this month</div></div>${can('payments')?`<button class="btn primary" id="np">${I.plus}Record payment</button>`:''}</div>
  <div class="card list">${list.length?list.map(p=>{const c=S.clients.find(x=>x.id===p.clientId);const inv=S.docs.find(d=>d.id===p.invoiceId);
   return `<button class="li" data-p="${p.id}"><span class="ico p">PAY</span><span style="min-width:0"><div class="t">${h(c?c.name:'Unknown client')}</div><div class="s">${fdate(p.date)} · ${h(p.method||'')}${p.ref?' · '+h(p.ref):''}${inv?' · '+h(inv.number):' · on account'}</div></span><span class="r num">${money(p.amount)}</span></button>`}).join(''):`<div class="empty"><b>No payments recorded</b>Record money received against an invoice or on account.</div>`}</div>`;
};
VIEWS_AFTER.payments=()=>{$('#np')&&($('#np').onclick=()=>paymentForm());$$('[data-p]').forEach(b=>b.onclick=()=>can('payments')&&paymentForm(S.payments.find(p=>p.id===b.dataset.p)))};
function paymentForm(pre={}){
  const e={date:today(),method:'Bank transfer',...pre};
  const invOpts=cid=>S.docs.filter(d=>d.type==='invoice'&&d.clientId===cid).map(d=>{const due=r2(totals(d).total-paidOn(d.id)+(e.id&&e.invoiceId===d.id?+e.amount:0));return due>0||d.id===e.invoiceId?`<option value="${d.id}" data-due="${due}" ${d.id===e.invoiceId?'selected':''}>${h(d.number)} · due ${money(due)}</option>`:''}).join('');
  const o=modal(e.id?'Edit payment':'Record payment',`<div class="grid g2">
   <label class="field" style="grid-column:1/-1"><span>Client</span><select id="p-client"><option value="">Choose…</option>${S.clients.map(c=>`<option value="${c.id}" ${c.id===e.clientId?'selected':''}>${h(c.name)} · ${money(clientBalance(c.id))}</option>`).join('')}</select></label>
   <label class="field" style="grid-column:1/-1"><span>Against invoice</span><select id="p-inv"><option value="">On account (not linked to one invoice)</option>${e.clientId?invOpts(e.clientId):''}</select></label>
   <label class="field"><span>Amount (${h(S.cfg.currency)})</span><input type="number" step="any" id="p-amount" value="${h(e.amount||'')}"></label>
   <label class="field"><span>Date</span><input type="date" id="p-date" value="${h(e.date)}"></label>
   <label class="field"><span>Method</span><select id="p-method">${['Bank transfer','Cash','Cheque','Card','PDC','Other'].map(m=>`<option ${m===e.method?'selected':''}>${m}</option>`).join('')}</select></label>
   <label class="field"><span>Reference / cheque no.</span><input id="p-ref" value="${h(e.ref||'')}"></label>
   <label class="field" style="grid-column:1/-1"><span>Note</span><input id="p-note" value="${h(e.note||'')}"></label></div>`,
   `${e.id?'<button class="btn danger" id="p-del">Delete</button><span class="grow"></span>':''}<button class="btn" data-x>Cancel</button><button class="btn primary" id="p-save">Save payment</button>`);
  $('#p-client',o).onchange=ev=>{e.clientId=ev.target.value;e.invoiceId='';$('#p-inv',o).innerHTML='<option value="">On account (not linked to one invoice)</option>'+invOpts(e.clientId)};
  $('#p-inv',o).onchange=ev=>{const op=ev.target.selectedOptions[0];if(op&&op.dataset.due&&!$('#p-amount',o).value)$('#p-amount',o).value=op.dataset.due};
  if(e.invoiceId&&!e.amount){const op=$('#p-inv',o).selectedOptions[0];if(op&&op.dataset.due)$('#p-amount',o).value=op.dataset.due}
  $('#p-save',o).onclick=async()=>{const d={clientId:$('#p-client',o).value,invoiceId:$('#p-inv',o).value,amount:r2($('#p-amount',o).value),date:$('#p-date',o).value,method:$('#p-method',o).value,ref:$('#p-ref',o).value.trim(),note:$('#p-note',o).value.trim(),createdBy:e.createdBy||S.me.id,updatedAt:new Date().toISOString()};
    if(!d.clientId){toast('Choose the client.',true);return}if(!(d.amount>0)){toast('Enter an amount above zero.',true);return}
    if(await save('payments',e.id||uid(),d,'Payment recorded'))render(),closeModal()};
  $('#p-del',o)&&($('#p-del',o).onclick=async()=>{if(!await confirmBox('Delete payment?','This changes the client balance and invoice status.'))return;await Store.remove('payments',e.id);toast('Payment deleted');closeModal()});
}

/* ----- products ----- */
VIEWS.products=()=>{
  const q=(S.params.q||'').toLowerCase();const list=S.products.filter(p=>!q||[p.name,p.desc,p.barcode].join(' ').toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name));
  return `<div class="head"><div><h1>Products</h1><div class="sub">Saved items fill in descriptions, prices and photos on quotations</div></div><button class="btn primary" id="npd">${I.plus}Add product</button></div>
  <input class="search" id="pq" placeholder="Search products or barcode" value="${h(S.params.q||'')}">
  <div class="card list">${list.length?list.map(p=>`<button class="li" data-pd="${p.id}">${p.photo?img(p.photo,'style="width:36px;height:36px;border-radius:8px;object-fit:cover"'):'<span class="ico q">ITEM</span>'}<span style="min-width:0"><div class="t">${h(p.name)}</div><div class="s">${h(p.desc||'')}${p.barcode?' · <span class="num">'+h(p.barcode)+'</span>':''}</div></span><span class="r num">${money(p.price)}<div class="muted" style="font-size:.75rem">per ${h(p.unit||'pcs')}</div></span></button>`).join(''):`<div class="empty"><b>No products saved</b>Add the items you sell most so quotations fill in by themselves.</div>`}</div>`;
};
VIEWS_AFTER.products=()=>{$('#npd').onclick=()=>productForm();$$('[data-pd]').forEach(b=>b.onclick=()=>productForm(S.products.find(p=>p.id===b.dataset.pd)));
  const pq=$('#pq');pq.oninput=()=>{S.params.q=pq.value;clearTimeout(pq._t);pq._t=setTimeout(()=>{render();const n=$('#pq');n.focus();n.setSelectionRange(n.value.length,n.value.length)},250)}};
function productForm(p){
  const e={unit:'pcs',...(p||{})};
  const o=modal(p?'Edit product':'New product',`<div class="row" style="align-items:flex-start;flex-wrap:nowrap"><button class="photo" id="pd-ph" style="width:96px;height:96px;flex:none" type="button">${e.photo?img(e.photo):'+ Photo'}</button>
   <div class="grid grow"><label class="field"><span>Name</span><input id="pd-name" value="${h(e.name)}"></label><label class="field"><span>Description</span><textarea id="pd-desc">${h(e.desc)}</textarea></label></div></div>
   <div class="grid g3"><label class="field"><span>Price</span><input type="number" step="any" id="pd-price" value="${h(e.price||'')}"></label><label class="field"><span>Unit</span><input id="pd-unit" value="${h(e.unit)}"></label>
   <label class="field"><span>Barcode / SKU</span><div class="row" style="flex-wrap:nowrap"><input id="pd-barcode" value="${h(e.barcode||'')}"><button class="btn" id="pd-scan" aria-label="Scan barcode">${I.scan}</button></div></label></div>`,
   `${p?'<button class="btn danger" id="pd-del">Delete</button><span class="grow"></span>':''}<button class="btn" data-x>Cancel</button><button class="btn primary" id="pd-save">Save product</button>`);
  $('#pd-ph',o).onclick=async()=>{const f=await pickImage();if(!f)return;toast('Uploading photo…');e.photo=await storeImage(f,800);$('#pd-ph',o).innerHTML=img(e.photo)};
  $('#pd-scan',o).onclick=()=>openScanner(c=>{$('#pd-barcode',o).value=c},{title:'Scan product barcode'});
  $('#pd-save',o).onclick=async()=>{const d={...e,name:$('#pd-name',o).value.trim(),desc:$('#pd-desc',o).value.trim(),price:+$('#pd-price',o).value||0,unit:$('#pd-unit',o).value.trim(),barcode:$('#pd-barcode',o).value.trim()};
    if(!d.name){toast('Enter the product name.',true);return}if(await save('products',e.id||uid(),d,'Product saved'))closeModal()};
  $('#pd-del',o)&&($('#pd-del',o).onclick=async()=>{if(!await confirmBox('Delete product?',e.name+' will be removed from the list. Existing documents keep it.'))return;await Store.remove('products',e.id);closeModal()});
}

/* ----- staff & access (admin) ----- */
VIEWS.staff=()=>{
  if(!isAdmin())return '<div class="empty"><b>Admins only</b></div>';
  const people=Object.values(S.users).filter(u=>u.id!==S.me.id&&u.active!==false).sort((a,b)=>(a.role==='admin')-(b.role==='admin')||String(a.name).localeCompare(String(b.name)));
  return `<div class="head"><div><h1>Staff & access</h1><div class="sub">Same logins as the attendance app</div></div></div>
  <div class="notice">Staff sign in with their attendance login ID and password. Add or remove logins in the attendance dashboard; here you decide what each person can do in invoicing. Attendance admins always have full access.</div>
  <div class="card">${people.length?people.map(u=>{const a=S.access[u.id]||{};const p=a.perms||{};const on=a.enabled!==false&&!!S.access[u.id];
   if(u.role==='admin')return `<div class="pad row" style="border-top:1px solid var(--line)"><b class="grow">${h(u.name)}</b><span class="pill brand">Admin · full access</span></div>`;
   return `<div class="pad" style="border-top:1px solid var(--line);display:flex;flex-direction:column;gap:10px" data-u="${u.id}">
    <div class="row"><div class="grow" style="min-width:0"><b>${h(u.name||'Unnamed')}</b><div class="muted" style="font-size:.8rem">${h([u.designation,u.loginId].filter(Boolean).join(' · '))}</div></div>
     <label class="check"><input type="checkbox" data-on ${on?'checked':''}>Invoicing access</label></div>
    <div class="perm-grid" ${on?'':'hidden'}>${PERMS.map(([k,l])=>`<label class="check"><input type="checkbox" data-perm="${k}" ${p[k]?'checked':''}>${l}</label>`).join('')}</div>
    <div class="row"><span class="grow"></span><button class="btn sm primary" data-savestaff>Save access</button></div></div>`}).join(''):`<div class="empty"><b>No staff found</b>Create staff logins in the attendance dashboard first.</div>`}</div>`;
};
VIEWS_AFTER.staff=()=>{
  $$('[data-u]').forEach(row=>{const id=row.dataset.u;const on=$('[data-on]',row);
    on.onchange=()=>{$('.perm-grid',row).hidden=!on.checked;if(on.checked&&!$$('[data-perm]:checked',row).length)Object.keys(EMP_DEFAULT).forEach(k=>$(`[data-perm="${k}"]`,row).checked=true)};
    $('[data-savestaff]',row).onclick=()=>{const perms={};$$('[data-perm]',row).forEach(c=>{if(c.checked)perms[c.dataset.perm]=true});
      save('access',id,{enabled:on.checked,perms,updatedAt:new Date().toISOString(),updatedBy:S.me.id},'Access saved for '+nameOf(id))}});
};

/* ----- settings (admin) ----- */
VIEWS.settings=()=>{
  if(!isAdmin())return '<div class="empty"><b>Admins only</b></div>';
  const c=S.cfg;const f=(k,l,v=c[k],type='text',span)=>`<label class="field" ${span?'style="grid-column:1/-1"':''}><span>${l}</span><input id="s-${k}" type="${type}" value="${h(v)}"></label>`;
  const sample={id:'_sample',type:'quotation',number:(c.prefix.quotation||'QT-')+today().slice(0,4)+'-0001',date:today(),validUntil:addDays(today(),c.validDays),client:{name:'Example Client LLC',contact:'Attn: Purchasing',address:'Office 12, Example Tower',phone:'+000 000 0000'},
    ref:'RFQ-0001',subject:'Example quotation (preview only)',items:[{name:'Example item A',desc:'Shown to preview the layout',qty:2,unit:'pcs',price:450},{name:'Example service',desc:'Installation and testing',qty:1,unit:'lot',price:300}],discount:0,taxRate:c.taxRate,terms:c.terms.quotation};
  return `<div class="head"><div><h1>Company & template</h1><div class="sub">Shown on every quotation, invoice, delivery note and statement</div></div><button class="btn primary" id="s-save">Save settings</button></div>
  <div class="view-grid"><div style="display:flex;flex-direction:column;gap:16px;min-width:0">
  <div class="card pad grid"><h2>Company</h2>
   <div class="row" style="align-items:flex-start"><div class="field"><span style="font-size:.75rem;font-weight:600;color:var(--muted)">Logo</span><button class="logo-box" id="s-logo" type="button">${c.logo?img(c.logo):'Upload logo'}</button>${c.logo?'<button class="btn ghost sm" id="s-logo-x">Remove</button>':''}</div>
    <div class="grid grow g2" style="min-width:220px">${f('name','Company name')}${f('website','Website')}${f('phone','Phone')}${f('email','Email')}${f('taxIdLabel','Tax ID label')}${f('taxId','Tax ID number')}</div></div>
   <label class="field"><span>Address</span><textarea id="s-address">${h(c.address)}</textarea></label>
   <label class="field"><span>Bank details (printed on quotations, invoices, statements)</span><textarea id="s-bank" placeholder="Bank name&#10;Account name&#10;IBAN&#10;SWIFT">${h(c.bank)}</textarea></label></div>
  <div class="card pad grid"><h2>Money & numbering</h2><div class="grid g3">${f('currency','Currency code')}${f('currencyName','Currency in words')}${f('minorName','Cents in words')}${f('taxLabel','Tax name')}${f('taxRate','Tax rate %',c.taxRate,'number')}${f('dueDays','Invoice due (days)',c.dueDays,'number')}${f('validDays','Quotation valid (days)',c.validDays,'number')}
   <label class="field"><span>Quotation prefix</span><input id="s-pq" value="${h(c.prefix.quotation)}"></label><label class="field"><span>Invoice prefix</span><input id="s-pi" value="${h(c.prefix.invoice)}"></label><label class="field"><span>Delivery note prefix</span><input id="s-pd" value="${h(c.prefix.delivery)}"></label></div>
   <label class="check"><input type="checkbox" id="s-dnp" ${c.showPricesOnDN?'checked':''}>Show prices on delivery notes</label></div>
  <div class="card pad grid"><h2>Default terms</h2>${['quotation','invoice','delivery'].map(t=>`<label class="field"><span>${TYPE[t].t}</span><textarea id="s-t-${t}" rows="3">${h(c.terms[t])}</textarea></label>`).join('')}</div>
  <div class="card pad grid"><h2>Look & signature</h2><div class="grid g2"><label class="field"><span>Accent colour</span><input type="color" id="s-brand" value="${h(c.brand)}" style="padding:2px;height:40px"></label><label class="field"><span>Dark colour</span><input type="color" id="s-charcoal" value="${h(c.charcoal)}" style="padding:2px;height:40px"></label></div>
   ${f('signName','Signatory name & title',c.signName,'text',true)}
   <div class="row"><h3 class="grow">Authorised signature / stamp</h3><button class="btn sm" id="s-sig-up">Upload image</button><button class="btn sm" id="s-sig-clr">Clear</button></div>
   ${c.signature?`<div class="row"><img src="${h(src(c.signature))}" alt="Current signature" style="max-height:70px;background:#fff;border-radius:6px;padding:4px"><span class="muted">Current. Draw below to replace.</span></div>`:''}
   <div class="sigpad" id="s-sig"></div></div>
  </div>
  <div class="side"><div class="label">Template preview</div><div class="card preview-wrap"><div class="preview-scale">${renderSheet(sample)}</div></div></div></div>`;
};
VIEWS_AFTER.settings=()=>{
  if(!isAdmin())return;
  const sp=sigPad($('#s-sig'));const c=clone(S.cfg);
  $('#s-logo').onclick=async()=>{const f=await pickImage();if(!f)return;toast('Uploading logo…');c.logo=await storeImage(f,600,true);$('#s-logo').innerHTML=img(c.logo)};
  $('#s-logo-x')&&($('#s-logo-x').onclick=()=>{c.logo='';$('#s-logo').innerHTML='Upload logo'});
  $('#s-sig-up').onclick=async()=>{const f=await pickImage();if(!f)return;c.signature=await storeImage(f,600,true);toast('Signature image ready. Save settings to keep it.')};
  $('#s-sig-clr').onclick=()=>{sp.clear();c.signature='';toast('Signature cleared. Save settings to keep the change.')};
  $('#s-save').onclick=async()=>{
    ['name','website','phone','email','taxIdLabel','taxId','address','bank','currency','currencyName','minorName','taxLabel','signName','brand','charcoal'].forEach(k=>c[k]=$('#s-'+k).value.trim());
    ['taxRate','dueDays','validDays'].forEach(k=>c[k]=+$('#s-'+k).value||0);
    c.prefix={quotation:$('#s-pq').value,invoice:$('#s-pi').value,delivery:$('#s-pd').value};
    c.terms={quotation:$('#s-t-quotation').value,invoice:$('#s-t-invoice').value,delivery:$('#s-t-delivery').value};
    c.showPricesOnDN=$('#s-dnp').checked;if(!sp.isEmpty())c.signature=sp.toData();
    await save('config','company',c,'Settings saved');
  };
};

/* ================= sign-in & data ================= */
function loginScreen(){
  const app=$('#app');
  app.innerHTML=`<div class="loading"><form class="card pad" id="lf" style="width:min(380px,100%);display:flex;flex-direction:column;gap:14px">
    <div class="brand" style="padding:0"><div class="mark" style="background:#fff"><img src="${h(DEFAULT_CFG.logo)}" alt=""></div><div><b style="color:var(--ink)">${h(DEFAULT_CFG.name)}</b><small class="muted">Invoicing</small></div></div>
    <h2>Sign in</h2><p class="muted" style="margin:0">Use your attendance app login.</p>
    <label class="field"><span>Login ID or email</span><input id="lf-id" autocomplete="username" autocapitalize="none" required></label>
    <label class="field"><span>Password</span><input id="lf-pw" type="password" autocomplete="current-password" required></label>
    <div id="lf-err" class="pill bad" hidden style="text-transform:none;padding:8px 10px;border-radius:8px"></div>
    <button class="btn primary" id="lf-go">Sign in</button></form></div>`;
  $('#lf').onsubmit=async e=>{e.preventDefault();const b=$('#lf-go'),er=$('#lf-err');b.disabled=true;er.hidden=true;
    try{await signInWithEmailAndPassword(auth,loginToEmail($('#lf-id').value),$('#lf-pw').value)}
    catch(x){er.hidden=false;er.textContent=/invalid|wrong|not-found|credential/i.test(x.code||'')?'Login ID or password is wrong.':/network/i.test(x.code||'')?'No internet connection.':'Could not sign in ('+(x.code||x.message)+').';b.disabled=false}};
}
function messageScreen(title,text,retry){
  $('#app').innerHTML=`<div class="loading"><div class="card pad" style="max-width:420px;text-align:center;display:flex;flex-direction:column;gap:10px"><h2>${h(title)}</h2><p class="muted" style="margin:0">${text}</p>
   <div class="row" style="justify-content:center">${retry?'<button class="btn primary" id="ms-retry">Check again</button>':''}<button class="btn" id="ms-out">Sign out</button></div></div></div>`;
  $('#ms-out').onclick=()=>signOut(auth);if(retry)$('#ms-retry').onclick=()=>location.reload();
}
const busyViews=['edit','deliver','settings'];
let rT;const soon=()=>{clearTimeout(rT);rT=setTimeout(()=>{if(!busyViews.includes(S.view))render()},80)};
function startData(){
  Store.subDoc('config','company',c=>{S.cfg={...clone(DEFAULT_CFG),...(c||{}),prefix:{...DEFAULT_CFG.prefix,...(c&&c.prefix||{})},terms:{...DEFAULT_CFG.terms,...(c&&c.terms||{})}};delete S.cfg.id;soon()});
  Store.sub('clients',r=>{S.clients=r;soon()});
  Store.sub('products',r=>{S.products=r;soon()});
  if(can('payments')||can('reports')||can('invoice'))Store.sub('payments',r=>{S.payments=r;soon()});
  const parts={};const merge=()=>{const m={};Object.values(parts).forEach(a=>a.forEach(d=>m[d.id]=d));S.docs=Object.values(m);soon()};
  if(can('viewAll'))Store.sub('docs',r=>{parts.all=r;merge()});
  else{Store.sub('docs',r=>{parts.mine=r;merge()},[where('createdBy','==',S.me.id)]);if(can('deliver'))Store.sub('docs',r=>{parts.dl=r;merge()},[where('type','==','delivery')])}
  if(isAdmin()){Store.sub('users',r=>{S.users=Object.fromEntries(r.map(u=>[u.id,u]));soon()});Store.sub('access',r=>{S.access=Object.fromEntries(r.map(a=>[a.id,a]));if(S.view==='staff')soon()})}
  Store.subDoc('access',S.me.id,a=>{if(isAdmin()||!a)return;const p=JSON.stringify(a.perms||{});if(a.enabled===false||p!==JSON.stringify(S.me.perms))location.reload()});
}
onAuthStateChanged(auth,async u=>{
  Store.stop();S.docs=[];S.clients=[];S.products=[];S.payments=[];S.users={};S.access={};
  if(!u){S.me={id:null,role:'login',perms:{}};loginScreen();return}
  S.me={id:u.uid,role:'loading',perms:{},name:''};render();
  try{
    const usr=await Store.get('users',u.uid);
    if(!usr||usr.active===false){messageScreen('Access turned off','This login is not active. Ask your admin.');return}
    S.me.name=usr.name||u.email;
    if(usr.role==='admin')S.me.role='admin';
    else{const a=await Store.get('access',u.uid).catch(()=>null);
      if(!a||a.enabled===false){messageScreen('No invoicing access yet',`Signed in as <b>${h(S.me.name)}</b>. Ask the admin to turn on invoicing access for you in Staff &amp; access.`,true);return}
      S.me.role='employee';S.me.perms=a.perms||{}}
  }catch(e){messageScreen('Could not load your account',h(e.code||e.message)+'<br>Check your internet connection and the Firestore rules.',true);return}
  S.view='home';S.params={};render();startData();
});
window.addEventListener('resize',()=>$$('.preview-wrap').forEach(fitPreview));
