// LLCT Invoicing — quotations, invoices, delivery notes, payments and statements.
// Uses the same Firebase project and staff logins as LLCT Attendance.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, getDoc, setDoc, deleteDoc, onSnapshot, query, where, runTransaction, getDocsFromServer, getDocFromServer, serverTimestamp, writeBatch, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
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
  prefix:{quotation:'QTN',invoice:'INV',delivery:'DLN',receipt:'RCT'},seqStart:{quotation:1,invoice:1,delivery:1},validDays:15,dueDays:30,
  terms:{quotation:'Prices valid for 15 days from the quotation date.\nDelivery: 3–5 working days from confirmed order.\nPayment: 50% advance, balance on delivery.',
         invoice:'Payment due within 30 days of invoice date.\nPlease quote the invoice number with your payment.',
         delivery:'Goods received in good condition. Please check serial numbers against this note.'},
  photoSize:'M',docStyle:'clean',docFont:'gothic',gps:'',tagline:'SECURITY | IoT | AUTOMATION | SOLUTIONS',stamp:'',bank:'Account name: LEADERS LINE TRADING LLC\nWIO Bank, Dubai · IBAN AE250860000009674830642\nRAK Bank (Amal), Dubai · Account 8882060635901 · IBAN AE510400008882060635901',brand:'#B8285E',charcoal:'#17375F',logo:'assets/logo.png',signature:'',signName:'',showPricesOnDN:false};
const PERMS=[
  ['quotation','Create & edit quotations'],['invoice','Create & edit invoices'],['delivery','Create delivery notes'],
  ['deliver','Complete deliveries (scan & sign)'],['payments','Record payments'],['clients','Manage clients & products'],
  ['reports','View accounts & statements'],['viewAll','See documents made by others'],['delete','Delete documents']];
const EMP_DEFAULT={delivery:true,deliver:true};
// One delivery-note form, three names. Numbering shares one running sequence.
const REPORT={
  delivery:{t:'Delivery Note',a:'DN',p:'DLN',who:'Deliver to',sign:'Received by',ok:'Received in good condition. Thank you for your acceptance.',ty:'Thank you for accepting the delivery.',done:'Delivery confirmed',act:'Deliver: scan & sign',photos:'Proof of delivery',
    st:['Delivered','Delivered & installed','Installed','Partially delivered','Pending']},
  service:{t:'Service Report',a:'SR',p:'SRV',who:'Customer',sign:'Customer confirmation',ok:'Work completed to satisfaction. Thank you for your acceptance.',ty:'Thank you for confirming our service visit.',done:'Report signed',act:'Sign off: customer signature',photos:'Site photos',
    st:['Completed','Attended','Repaired','Replaced','Pending parts','Follow-up required']},
  callout:{t:'Call-out Attendance Report',a:'CO',p:'COR',who:'Customer',sign:'Customer confirmation',ok:'Call-out attended. Thank you for your acceptance.',ty:'Thank you for confirming our call-out attendance.',done:'Report signed',act:'Sign off: customer signature',photos:'Site photos',
    st:['Attended','Completed','Temporary fix','Pending parts','Follow-up required']}};
const rep=d=>REPORT[(d&&d.reportType)||'delivery']||REPORT.delivery;
const docTitle=d=>d.type==='delivery'?rep(d).t:TYPE[d.type].t;
const stClass=x=>/install|attend/i.test(x)?'ins':/partial|follow|temporary/i.test(x)?'part':/pending/i.test(x)?'pend':'del';
const TYPE={quotation:{t:'Quotation',p:'Quotations',a:'QT',c:'q'},invoice:{t:'Tax Invoice',p:'Invoices',a:'INV',c:'i'},delivery:{t:'Delivery Note',p:'Delivery notes',a:'DN',c:'d'}};

const S={logins:[],acct:[],drv:[],acctOpen:{},acctParties:{},petty:[],sites:[],projects:{},counters:{},cfg:clone(DEFAULT_CFG),clients:[],products:[],docs:[],payments:[],users:{},access:{},
  me:{id:null,role:'loading',perms:{}},view:'home',params:{}};
const can=p=>S.me.role==='admin'||S.me.role==='manager'&&p!=='__admin'||!!S.me.perms[p];
const isAdmin=()=>S.me.role==='admin';

/* ================= Firebase store ================= */
const COL={ledger:'inv_ledger',logins:'inv_logins',acct:'acctEntries',acctFiles:'acctFiles',acctSettings:'acctSettings',driverPay:'driverPayments',petty:'petty',profiles:'inv_profiles',numbers:'inv_numbers',sites:'sites',projects:'projects',counters:'inv_counters',config:'inv_config',access:'inv_access',clients:'inv_clients',products:'inv_products',docs:'inv_docs',payments:'inv_payments',images:'inv_images',users:'users'};
const Store={unsubs:[],
  sub(col,cb,clauses,quiet){
    const ref=collection(fdb,COL[col]);const q=clauses&&clauses.length?query(ref,...clauses):ref;
    this.unsubs.push(onSnapshot(q,s=>cb(s.docs.map(d=>({...d.data(),id:d.id}))),e=>{console.warn(col,e);if(!quiet)toast('Could not load '+col+' ('+(e.code||e.message)+').',true)}));
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

/* ================= GPS & location matching ================= */
function getGPS(){return new Promise(res=>{if(!navigator.geolocation)return res({error:'unavailable'});
  navigator.geolocation.getCurrentPosition(p=>res({lat:+p.coords.latitude.toFixed(6),lng:+p.coords.longitude.toFixed(6),acc:Math.round(p.coords.accuracy||0),at:new Date().toISOString()}),
    e=>res({error:e&&e.code===1?'denied':'unavailable'}),{enableHighAccuracy:true,timeout:15000,maximumAge:30000})})}
const hasGPS=g=>!!g&&typeof g.lat==='number'&&typeof g.lng==='number';
function distM(a,b){const R=6371000,r=x=>x*Math.PI/180;const dLat=r(b.lat-a.lat),dLng=r(b.lng-a.lng);const q=Math.sin(dLat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLng/2)**2;return 2*R*Math.asin(Math.sqrt(q))}
const fmtGPS=g=>hasGPS(g)?`${(+g.lat).toFixed(6)}, ${(+g.lng).toFixed(6)}`:'';
const fmtDist=m=>m<1000?Math.round(m)+' m':(m/1000).toFixed(1)+' km';
// Clients whose saved places, or whose attendance sites, are at this spot. Closest first.
function nearby(g){
  if(!hasGPS(g))return [];const out=[];const slack=Math.min(g.acc||0,100);
  const byName=n=>{n=String(n||'').trim().toLowerCase();if(n.length<3)return null;return S.clients.find(c=>String(c.name||'').trim().toLowerCase()===n)||S.clients.find(c=>{const cn=String(c.name||'').toLowerCase();return cn.length>2&&(cn.includes(n)||n.includes(cn))})||null};
  S.clients.forEach(c=>(c.places||[]).forEach(pl=>{if(!hasGPS(pl))return;const dd=distM(g,pl);if(dd<=(+pl.radius||150)+slack)out.push({client:c,site:pl.name||'',address:pl.address||'',dist:dd})}));
  S.sites.forEach(si=>{if(!hasGPS(si)||si.active===false||si.approved===false)return;const dd=distM(g,si);
    if(dd<=(+si.radius||200)+slack){const pr=S.projects[si.projectId];out.push({client:byName(pr&&pr.client)||byName(si.name),site:si.name||'',address:si.address||'',dist:dd})}});
  out.sort((a,b)=>(!!b.client-!!a.client)||a.dist-b.dist);
  const seen=new Set();return out.filter(x=>{const k=(x.client?x.client.id:'-')+'|'+x.site;if(seen.has(k))return false;seen.add(k);return true}).slice(0,5);
}
// Remember where a client was served, so the next report there picks them automatically.
async function rememberPlace(d){
  const g=d.gps;if(d.type!=='delivery'||!hasGPS(g)||!d.clientId||(g.acc||0)>300)return;
  const c=S.clients.find(x=>x.id===d.clientId);if(!c)return;
  if((c.places||[]).some(pl=>hasGPS(pl)&&distM(pl,g)<=(+pl.radius||150)))return;
  const places=[...(c.places||[]),{name:(d.deliveryAddress||'Site').slice(0,80),lat:g.lat,lng:g.lng,radius:150,addedAt:new Date().toISOString()}];
  try{const x={...c,places,updatedAt:new Date().toISOString()};delete x.id;await Store.put('clients',c.id,x)}catch(e){console.warn('place',e)}
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
  if(d.legacy){const total=r2(d.amount),tax=r2(d.vat||0);return {sub:r2(total-tax),disc:0,taxable:r2(total-tax),rate:0,tax,total}}
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
  if(+c.openingBalance) tx.push({date:c.openingDate||'2000-01-01',kind:'Opening balance',no:'',ref:'',dr:+c.openingBalance,cr:0,open:true});
  S.docs.filter(d=>d.type==='invoice'&&d.clientId===cid).forEach(d=>tx.push({date:d.date,kind:d.legacy?'Invoice (previous)':'Invoice',no:d.number,ref:[d.subject,d.ref].filter(Boolean).join(' · '),dr:totals(d).total,cr:0,id:d.id,due:d.dueDate,legacy:!!d.legacy}));
  S.payments.filter(p=>p.clientId===cid).forEach(p=>{const inv=S.docs.find(d=>d.id===p.invoiceId);tx.push({date:p.date,kind:(/credit|adjust/i.test(p.method||'')?'':'Payment · ')+(p.method||''),no:p.ref||'',ref:inv?'Against '+inv.number:(p.note||''),dr:0,cr:+p.amount||0,pid:p.id})});
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
// Number format: PREFIX + DDMMYY + running sequence, e.g. QTN201026001 (sequence never resets).
const OLD_PREFIX=['QT-','INV-','DN-','QUT'];
const numPrefix=type=>{const p=(S.cfg.prefix||{})[type];return p&&!OLD_PREFIX.includes(p)?p:DEFAULT_CFG.prefix[type]};const _np=type=>({quotation:'QTN',invoice:'INV',delivery:'DLN'})[type];
const ddmmyy=iso=>{const d=(iso||today());return d.slice(8,10)+d.slice(5,7)+d.slice(2,4)};
const prefixFor=(type,rt)=>type==='delivery'&&rt&&rt!=='delivery'&&REPORT[rt]?REPORT[rt].p:numPrefix(type);
const fmtNumber=(type,date,seq,rt)=>prefixFor(type,rt)+ddmmyy(date)+String(seq).padStart(3,'0');
const rand3=()=>String(1+Math.floor(Math.random()*999)).padStart(3,'0');
function nextNumber(type,date,rt){const pre=prefixFor(type,rt)+ddmmyy(date);const used=new Set(S.docs.map(d=>d.number));
  for(let i=0;i<60;i++){const n=pre+rand3();if(!used.has(n))return n}return pre+rand3()}
// Claim the number on the server (inv_numbers/{number}) so no two documents ever share one.
async function reserveNumber(type,date,rt,preferred){
  const pre=prefixFor(type,rt)+ddmmyy(date);const used=new Set(S.docs.map(d=>d.number));
  let cand=preferred&&preferred.startsWith(pre)&&!used.has(preferred)?preferred:null;
  for(let i=0;i<30;i++){
    let n=cand;cand=null;if(!n){for(let k=0;k<60;k++){n=pre+rand3();if(!used.has(n))break}}
    try{const ok=await runTransaction(fdb,async tx=>{const ref=doc(fdb,COL.numbers,n);const sn=await tx.get(ref);if(sn.exists())return false;
        tx.set(ref,{type,by:S.me.id,at:new Date().toISOString()});return true});
      if(ok)return n;used.add(n)}
    catch(e){console.warn('number',e);return n}
  }
  return pre+rand3();
}
const visibleDocs=()=>S.docs.filter(d=>can('viewAll')||d.createdBy===S.me.id||(d.type==='delivery'&&can('deliver')&&!(d.delivery&&d.delivery.signedAt)));

/* ================= icons ================= */
const I={
 home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/></svg>',
 doc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8z"/><path d="M14 3v5h5M8 13h8M8 17h5"/></svg>',
 truck:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
 users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 14.5c1.9.6 3.1 2.4 3.5 5.5"/></svg>',
 clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
 book:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4.5A1.5 1.5 0 015.5 3H20v15H5.5A1.5 1.5 0 004 19.5z"/><path d="M4 19.5A1.5 1.5 0 005.5 21H20v-3M8 7h8M8 11h6"/></svg>',
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
// Phones: pop-ups sit as a sheet on top of the keyboard, and the field being typed in is scrolled into view.
(function keyboardSafe(){const vv=window.visualViewport;
  const fit=()=>{if(!vv)return;$$('.overlay').forEach(o=>{if(window.innerWidth>700){o.style.top='';o.style.height='';return}o.style.top=vv.offsetTop+'px';o.style.height=vv.height+'px'})};
  if(vv){vv.addEventListener('resize',fit);vv.addEventListener('scroll',fit)}
  new MutationObserver(fit).observe(document.body,{childList:true});
  document.addEventListener('focusin',ev=>{const t=ev.target;if(!t.closest||!t.closest('.modal')||!/INPUT|SELECT|TEXTAREA/.test(t.tagName))return;
    setTimeout(()=>{fit();t.scrollIntoView({block:'center',behavior:'smooth'})},280)});})();
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
function sheetHead(title,number,sub){
  const c=S.cfg;
  if(isPrem()){
    const w=String(c.name||'').trim().split(/\s+/);const n1=w.length>=3?w.slice(0,-2).join(' '):c.name,n2=w.length>=3?w.slice(-2).join(' '):'';
    const row=(k,txt,i)=>txt?`<div class="pc"><span class="pci ${i%2?'n':''}">${ico(k,'#ffffff')}</span><span>${h(txt)}</span></div>`:'';
    return `<div class="pdeco"></div><div class="ph"><div class="ph-l">${c.logo?img(c.logo,'class="plogo"'):''}<div class="pnm"><div class="pn1">${h(n1)}</div>${n2?`<div class="pn2">${h(n2)}</div>`:''}${c.tagline?`<div class="ptag">${h(c.tagline)}</div>`:''}${c.taxId?`<div class="ptrn">${h(c.taxIdLabel)} ${h(c.taxId)}</div>`:''}</div></div>
     <div class="ph-r">${row('pin',c.address,0)}${row('gps',c.gps?'GPS '+c.gps:'',1)}${row('globe',c.website,2)}</div></div>
     <div class="pband"><i></i><i></i><i></i></div>
     <div class="ptbar"><div><div class="pdt${String(title).length>20?' xl':String(title).length>13?' long':''}">${h(title)}</div><div class="pul"></div>${sub?`<div class="psub">${h(sub)}</div>`:''}</div>${number?`<div class="nb"><img class="bc" src="${barcodeData(number)}" alt=""><div class="no">${h(number)}</div></div>`:''}</div>`;
  }
  const line=(k,v)=>v?`<div><b>${k}</b>${h(v)}</div>`:'';
  return `<div class="band"></div>
  <div class="hd"><div class="co">${c.logo?img(c.logo,'class="logo"'):''}<div class="idn"><div class="nm">${h(c.name)}</div>${c.taxId?`<div class="trn">${h(c.taxIdLabel)} ${h(c.taxId)}</div>`:''}</div></div>
   <div class="ct"><div class="adr">${h(c.address||'')}</div>${line('GPS',c.gps)}${line('W',c.website)}</div></div>
  <div class="tbar"><div><div class="dt">${h(title)}</div>${sub?`<div class="dsub">${h(sub)}</div>`:''}</div>
   ${number?`<div class="nb"><img class="bc" src="${barcodeData(number)}" alt=""><div class="no">${h(number)}</div></div>`:''}</div>`;
}
function sheetFoot(){const c=S.cfg;
  if(isPrem())return `<div class="pft"><div class="pfl">${c.website?`<span>${ico('globe','#ffffff')}${h(c.website)}</span>`:''}${c.email?`<span>${ico('mail','#ffffff')}${h(c.email)}</span>`:''}${c.phone?`<span>${ico('phone','#ffffff')}${h(c.phone)}</span>`:''}</div><div class="pfr">${h(c.tagline||'')}</div></div>`;
  return `<div class="ft"><span>${h(c.name)}${c.taxId?' · '+h(c.taxIdLabel)+' '+h(c.taxId):''}</span><span>This is a computer-generated document</span><span>${h((c.website||'').split('·')[0].trim())}</span></div>`}
// Photos attached to a document print as extra pages after it.
function renderAnnex(d){
  const ims=(d.attachments||[]).filter(a=>a.kind==='image'&&a.inPdf!==false);if(!ims.length)return '';
  const U={S:1,M:2,L:4},c=S.cfg,pages=[];let cur=[],used=0;
  for(const a of ims){const u=U[a.size||'M']||2;if(used+u>4&&cur.length){pages.push(cur);cur=[];used=0}cur.push(a);used+=u}
  if(cur.length)pages.push(cur);let no=0;
  return pages.map((pg,k)=>`<div class="sheet annex${docCls()}" style="--b:${h(c.brand)};--c:${h(c.charcoal)};page-break-before:always;break-before:page"><div class="band"></div>
   <div class="ahd"><div><div class="dt2">${d.type==='delivery'?rep(d).photos:'Attachments'}</div><div class="as">${h(docTitle(d))} ${h(d.number)}${d.client&&d.client.name?' · '+h(d.client.name):''}</div></div><div class="pg">${k+1} / ${pages.length}</div></div>
   <div class="agrid">${pg.map(a=>{no++;const z=a.size||'M';return `<figure class="af sz-${z}"><div class="abox">${img(a.ref)}</div><figcaption><b>${String(no).padStart(2,'0')}</b>${h(a.caption||'')}</figcaption></figure>`}).join('')}</div>
   ${sheetFoot()}</div>`).join('');
}
const docCls=()=>(S.cfg.docStyle==='classic'?'':S.cfg.docStyle==='premium'?' premium':' clean')+' f-'+(S.cfg.docFont||'gothic');
const isPrem=()=>S.cfg.docStyle==='premium';
// Small line icons for the Premium style (as images, so they print into the PDF).
const ICO={pin:'M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12z M12 6.5a2.5 2.5 0 110 5a2.5 2.5 0 110-5z',
  phone:'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
  mail:'M3 6h18v12H3z M3 7l9 6 9-6',globe:'M12 3a9 9 0 110 18a9 9 0 110-18z M3 12h18 M12 3c3 3.5 3 14.5 0 18 M12 3c-3 3.5-3 14.5 0 18',
  building:'M4 21V5l8-2v18 M12 8h8v13 M7 8h2 M7 12h2 M7 16h2 M15 12h2 M15 16h2 M2 21h20',
  cal:'M4 6h16v15H4z M4 10h16 M8 3v4 M16 3v4',calchk:'M4 6h16v15H4z M4 10h16 M8 3v4 M16 3v4 M9 15.5l2 2 4-4',
  doc:'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h5',user:'M12 12a4 4 0 110-8a4 4 0 110 8z M4 21c1-4 4-6 8-6s7 2 8 6',
  clock:'M12 3a9 9 0 110 18a9 9 0 110-18z M12 7v5l3 2',
  gps:'M12 2v4 M12 18v4 M2 12h4 M18 12h4 M12 7a5 5 0 110 10a5 5 0 110-10z M12 11a1 1 0 110 2a1 1 0 110-2z'};
const ico=(n,color)=>`<img class="ic" alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${color||'#17375F'}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='${ICO[n]||ICO.doc}'/></svg>`)}">`;
const icoFor=k=>/^contact|received by/i.test(k)?'user':/^bank/i.test(k)?'building':/mobile|phone/i.test(k)?'phone':/mail/i.test(k)?'mail':/due|valid/i.test(k)?'calchk':/date|period/i.test(k)?'cal':/sales|techn/i.test(k)?'user':/time|credit/i.test(k)?'clock':'doc';
const subFor=d=>d.type==='quotation'?'Thank you for your enquiry':d.type==='invoice'?'Thank you for your business':({delivery:'Goods delivered as listed',service:'Service visit report',callout:'Call-out attendance'})[d.reportType||'delivery'];
function detHtml(det){
  if(!isPrem())return `<div class="box dg">${det.map(([k,v])=>`<span>${h(k)}</span><span>${h(v)}</span>`).join('')}</div>`;
  return `<div class="box pdet">${det.map(([k,v],i)=>`<div class="pr"><span class="pico ${i%2?'pk2':''}">${ico(icoFor(k),i%2?S.cfg.brand:S.cfg.charcoal)}</span><span class="pk">${h(k)}</span><span class="pv${String(v).length>44?' wrap':String(v).length>32?' sm':''}">${h(v)}</span></div>`).join('')}</div>`;
}
function termsHtml(t){
  if(!isPrem())return `<div class="terms">${h(t)}</div>`;
  return `<div class="tlist">${String(t).split(/\n+/).map(x=>x.trim()).filter(Boolean).map((x,i)=>`<div class="tl"><i>${i+1}</i><span>${h(x)}</span></div>`).join('')}</div>`;
}
function bankHtml(b){
  if(!isPrem())return `<div class="terms">${h(b)}</div>`;
  return `<div class="bk">${String(b).split(/\n+/).map(x=>x.trim()).filter(Boolean).map(x=>{const m=x.match(/^([^:]{2,22}):\s*(.+)$/);return m?`<span>${h(m[1])}</span><b>${h(m[2])}</b>`:`<b class="full">${h(x)}</b>`}).join('')}</div>`;
}
const pdfRefs=d=>(d.attachments||[]).filter(a=>a.kind==='pdf'&&a.inPdf!==false).map(a=>a.ref);
function renderSheet(d){
  const c=S.cfg,t=totals(d),cl=d.client||{},isDN=d.type==='delivery',isQ=d.type==='quotation';
  const showPrice=!isDN||c.showPricesOnDN;const hasImg=!isDN&&(d.items||[]).some(i=>i.photo);
  const PX={S:44,M:72,L:112};const psz=i=>PX[i.photoSize||c.photoSize||'M']||72;
  const imgW=hasImg?Math.max(...(d.items||[]).filter(i=>i.photo).map(psz))+16:0;
  const title=d.type==='invoice'?(+t.rate?'Tax Invoice':'Invoice'):docTitle(d);const R=rep(d);const isSvc=isDN&&(d.reportType||'delivery')!=='delivery';
  const src=d.sourceId&&S.docs.find(x=>x.id===d.sourceId);
  const det=[['Date',fdate(d.date)]];
  if(d.type==='invoice'&&d.dueDate)det.push(['Due date',fdate(d.dueDate)]);
  if(isQ&&d.validUntil)det.push(['Valid until',fdate(d.validUntil)]);
  if(d.ref)det.push([isQ?'Your ref':'LPO / Ref',d.ref]);
  if(d.contactName)det.push(['Contact',d.contactName]);
  if(d.contactMobile||d.contactEmail)det.push([d.contactMobile&&d.contactEmail?'Mobile / Email':d.contactMobile?'Mobile':'Email',[d.contactMobile,d.contactEmail].filter(Boolean).join('  |  ')]);
  if(src)det.push([TYPE[src.type].a+' ref',src.number]);
  if(d.salesperson)det.push(['Salesperson',d.salesperson]);
  if(isSvc&&d.technician)det.push(['Technician',d.technician]);
  if(isSvc&&(d.timeIn||d.timeOut))det.push(['Time in / out',[d.timeIn||'—',d.timeOut||'—'].join(' – ')]);
  let rows=(d.items||[]).map((i,n)=>{
    const sl=(i.serials||[]);
    const sn=sl.length?`<div class="sn"><b>S/N</b>${sl.map(x=>`<span>${h(x)}</span>`).join('')}</div>`:'';
    return `<tr><td class="c m n">${String(n+1).padStart(2,'0')}</td>${hasImg?`<td>${i.photo?`<span class="pib" style="width:${psz(i)}px;height:${psz(i)}px">${img(i.photo,'class="pi"')}</span>`:''}</td>`:''}
    <td><div class="it">${h(i.name)}</div>${i.desc?`<div class="idesc">${h(i.desc)}</div>`:''}${sn}</td>
    <td class="r m">${h(i.qty)}</td><td class="u">${h(i.unit||'')}</td>
    ${showPrice?`<td class="r m">${money(i.price)}</td><td class="r m b">${money((+i.qty||0)*(+i.price||0))}</td>`:''}
    ${isDN?`<td class="c"><span class="st ${stClass(i.status||rep(d).st[0])}">${h(i.status||rep(d).st[0])}</span></td>`:''}</tr>`}).join('');
  const head=`<tr><th class="c" style="width:34px">#</th>${hasImg?`<th style="width:${imgW}px">Image</th>`:''}<th>Item & description</th><th class="r" style="width:50px">Qty</th><th style="width:48px">Unit</th>${showPrice?`<th class="r" style="width:96px">Unit price${isPrem()?` <small>(${h(c.currency)})</small>`:''}</th><th class="r" style="width:108px">Amount${isPrem()?` <small>(${h(c.currency)})</small>`:''}</th>`:''}${isDN?'<th class="c" style="width:136px">Status</th>':''}</tr>`;
  let stamp='';
  if(d.type==='invoice'){const [s]=invStatus(d);if(s==='paid')stamp='<span class="stamp">PAID</span>';else if(s.includes('overdue'))stamp='<span class="stamp due">OVERDUE</span>'}
  if(isDN&&d.delivery&&d.delivery.signedAt)stamp=`<span class="stamp">${isSvc?'SIGNED OFF':'DELIVERED'}</span>`;
  const paid=d.type==='invoice'?paidOn(d.id):0;
  const totalsHtml=showPrice?`<div class="tot">
    <div class="tr"><span>Subtotal</span><span class="m">${money(t.sub)}</span></div>
    ${t.disc?`<div class="tr"><span>Discount</span><span class="m">− ${money(t.disc)}</span></div>`:''}
    ${+t.rate?`<div class="tr"><span>${h(c.taxLabel)} ${t.rate}%</span><span class="m">${money(t.tax)}</span></div>`:''}
    <div class="tr gr"><span>Total <small>${h(c.currency)}</small></span><span class="m">${money(t.total)}</span></div>
    ${d.type==='invoice'&&paid?`<div class="tr"><span>Paid</span><span class="m">${money(paid)}</span></div><div class="tr" style="font-weight:700"><span>Balance due</span><span class="m">${money(t.total-paid)}</span></div>`:''}</div>`
    :!(d.items||[]).length?'':`<div class="tot"><div class="tr"><span>Total items</span><span class="m">${(d.items||[]).length}</span></div><div class="tr"><span>Total quantity</span><span class="m">${(d.items||[]).reduce((s,i)=>s+(+i.qty||0),0)}</span></div><div class="tr"><span>Serials recorded</span><span class="m">${(d.items||[]).reduce((s,i)=>s+(i.serials||[]).length,0)}</span></div></div>`;
  const dl=d.delivery||{};
  const right=isDN?`<div class="sig"><div class="img">${dl.signature?`<img src="${h(dl.signature)}" alt="">`:''}</div><div class="ln"><b>${h(R.sign)}: ${h(dl.receiver||'')}</b>${dl.signedAt?`<br><i style="color:#2F8A57;font-style:normal">${h(R.ok)}</i>`:''}${hasGPS(dl.gps)?`<br><span class="m" style="font-size:9px">Signed at GPS ${fmtGPS(dl.gps)}</span>`:''}<br>${dl.receiverPhone?h(dl.receiverPhone)+' · ':''}${dl.signedAt?fdt(dl.signedAt):'Name, signature & date'}</div></div>`
    :`<div class="sig"><div class="img"></div><div class="ln"><b>${isQ?'Accepted by':'Received by'}</b><br>Name, signature, company stamp & date</div></div>`;
  return `<div class="sheet${docCls()}" data-client="${h(cl.name||'')}" data-site="${h(d.deliveryAddress||d.subject||'')}" data-ref="${h(d.ref||'')}" style="--b:${h(c.brand)};--c:${h(c.charcoal)}">${sheetHead(title,d.number,isPrem()?subFor(d):'')}
  <div class="meta"><div class="box cbox">${isPrem()?`<span class="bico">${ico('building',c.brand)}</span>`:''}<div class="cbody"><div class="k">${isDN?R.who:isQ?'Prepared for':'Bill to'}</div><div class="cn">${h(cl.name||'—')}</div>
    <div class="ad" style="white-space:pre-line;color:#5d6168">${h([cl.contact,cl.address,[cl.phone,cl.email].filter(Boolean).join(' · '),cl.taxId?`${c.taxIdLabel}: ${cl.taxId}`:''].filter(Boolean).join('\n'))}</div>
    ${isDN&&(d.deliveryAddress||hasGPS(d.gps))?`<div class="k" style="margin-top:8px">Site / location</div>${d.deliveryAddress?`<div style="white-space:pre-line">${h(d.deliveryAddress)}</div>`:''}${hasGPS(d.gps)?`<div class="gps"><b>GPS</b> ${fmtGPS(d.gps)}</div>`:''}`:''}</div></div>
    ${detHtml(det)}</div>
  ${d.subject?`<div class="subj">${h(d.subject)}</div>`:''}
  ${isSvc&&(d.complaint||d.workDone)?`<div class="svc">${d.complaint?`<div><div class="hh">Complaint / request</div><div class="terms">${h(d.complaint)}</div></div>`:''}${d.workDone?`<div><div class="hh">Work carried out</div><div class="terms">${h(d.workDone)}</div></div>`:''}</div>`:''}
  ${rows||!isSvc?`<table><thead>${head}</thead><tbody>${rows||`<tr><td colspan="8" style="color:#999;text-align:center;padding:20px">No items</td></tr>`}</tbody></table>`:''}
  ${(()=>{const words=showPrice?`<div class="words">${isPrem()?`<span class="wico">${ico('doc',c.charcoal)}</span>`:''}<span>Amount in words</span><b>${h(numWords(t.total))}</b></div>`:'';
    return `<div class="foot"><div class="fl">${d.notes?`<div class="note"><div class="hh">Notes</div><div class="terms">${h(d.notes)}</div></div>`:''}${stamp?`<div>${stamp}</div>`:''}${isPrem()?words:''}</div>${totalsHtml}</div>${isPrem()?'':words}`})()}
  ${(d.terms||(d.type!=='delivery'&&c.bank))?`<div class="info">${d.terms?`<div><div class="hh">Terms & conditions</div>${termsHtml(d.terms)}</div>`:''}${d.type!=='delivery'&&c.bank?`<div><div class="hh">Bank details</div>${bankHtml(c.bank)}</div>`:''}</div>`:''}
  <div class="sigs"><div class="sig"><div class="img">${c.stamp?img(c.stamp,'class="stampimg"'):''}${c.signature?img(c.signature,'class="sigimg"'):''}</div><div class="ln"><b>For ${h(c.name)}</b><br>${h(c.signName||'Authorised signatory')}${isDN&&dl.deliveredBy?' · Delivered by '+h(nameOf(dl.deliveredBy,dl.deliveredByName)):''}</div></div>${right}</div>
  ${sheetFoot()}</div>`;
}
function renderSOA(cid,from,to){
  const x=soaData(cid,from,to),c=S.cfg,cl=x.c;
  const rows=[`<tr><td class="m">${fdate(from)}</td><td colspan="3"><b>Balance brought forward</b></td><td></td><td></td><td class="r m"><b>${money(x.open)}</b></td></tr>`]
    .concat(x.rows.map(r=>`<tr><td class="m">${fdate(r.date)}</td><td>${h(r.kind)}</td><td class="m">${h(r.no)}</td><td>${h(r.ref)}</td><td class="r m">${r.dr?money(r.dr):''}</td><td class="r m">${r.cr?money(r.cr):''}</td><td class="r m">${money(r.bal)}</td></tr>`)).join('');
  return `<div class="sheet soa${docCls()}" data-client="${h(cl.name||'')}" data-site="${h('Statement '+fdate(from)+' – '+fdate(to))}" style="--b:${h(c.brand)};--c:${h(c.charcoal)}">${sheetHead('SOA','SOA'+ddmmyy(to)+String(cid).replace(/[^A-Za-z0-9]/g,'').slice(-4).toUpperCase(),'Statement of account · '+fdate(from)+' – '+fdate(to))}
  <div class="meta"><div class="box"><div class="k">Customer</div><div class="cn">${h(cl.name)}</div><div style="white-space:pre-line;color:#5d6168">${h([cl.contact,cl.address,[cl.phone,cl.email].filter(Boolean).join(' · '),cl.taxId?`${c.taxIdLabel}: ${cl.taxId}`:''].filter(Boolean).join('\n'))}</div></div>
  <div class="box dg"><span>Period</span><span>${fdate(from)} – ${fdate(to)}</span><span>Statement date</span><span>${fdate(today())}</span><span>Currency</span><span>${h(c.currency)}</span>${cl.creditDays?`<span>Credit terms</span><span>${h(cl.creditDays)} days</span>`:''}</div></div>
  <div class="sum4"><div><div class="k">Opening balance</div><div class="v">${money(x.open)}</div></div><div><div class="k">Invoiced</div><div class="v">${money(x.invd)}</div></div><div><div class="k">Received</div><div class="v">${money(x.recd)}</div></div><div class="dk"><div class="k">Balance due</div><div class="v">${money(x.close)}</div></div></div>
  <table><thead><tr><th style="width:100px">Date</th><th>Transaction</th><th style="width:110px">Number</th><th>Reference</th><th class="r" style="width:86px">Debit</th><th class="r" style="width:86px">Credit</th><th class="r" style="width:96px">Balance</th></tr></thead><tbody>${rows}</tbody></table>
  <div><div class="hh">Ageing of balance as of ${fdate(to)}</div>
  <div class="aging">${[['Current',x.ag.cur],['1–30 days',x.ag.a30],['31–60 days',x.ag.a60],['61–90 days',x.ag.a90],['Over 90',x.ag.a90p],['Total due',x.close]].map(([k,v])=>`<div><div class="k">${k}</div><div class="m">${money(v)}</div></div>`).join('')}</div></div>
  ${c.bank?`<div><div class="hh">Bank details</div>${bankHtml(c.bank)}</div>`:''}
  <div class="terms">Please review this statement and report any differences within 7 days. Thank you for your business.</div>
  <div class="sigs"><div class="sig"><div class="img">${c.stamp?img(c.stamp,'class="stampimg"'):''}${c.signature?img(c.signature,'class="sigimg"'):''}</div><div class="ln"><b>For ${h(c.name)}</b><br>${h(c.signName||'Accounts department')}</div></div><div class="sig"><div class="img"></div><div class="ln"><b>Confirmed by customer</b><br>Signature & stamp</div></div></div>
  ${sheetFoot()}</div>`;
}
// Premium: space "TRADING LLC" out to the exact width of "LEADERS LINE" so both lines align.
function alignBrand(root=document){
  $$('.sheet.premium .pnm',root).forEach(b=>{const a=$('.pn1',b),t=$('.pn2',b);if(!a||!t)return;
    t.style.letterSpacing='0px';t.style.marginRight='0px';const w1=a.offsetWidth,w2=t.offsetWidth,n=t.textContent.length;
    if(n>1&&w1>w2){const ls=(w1-w2)/(n-1);t.style.letterSpacing=ls.toFixed(2)+'px';t.style.marginRight=(-ls).toFixed(2)+'px'}})}
function fitPreview(host){const w=host.clientWidth-24;const k=Math.min(1,w/794);const sc=$('.preview-scale',host);if(!sc)return;sc.style.transform=`scale(${k})`;sc.style.width='794px';host.style.height=(sc.firstElementChild.offsetHeight*k+24)+'px'}
const isNative=()=>!!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform());
function b64(bytes){let out='';for(let i=0;i<bytes.length;i+=0x8000)out+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(out)}
function dataToBytes(du){const bin=atob(du.split(',')[1]||'');const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u}
async function saveFile(bytes,filename,mime,shareTitle){
  if(isNative()){const P=window.Capacitor.Plugins;const r=await P.Filesystem.writeFile({path:filename,data:b64(bytes),directory:'CACHE'});await P.Share.share({title:filename,url:r.uri,dialogTitle:shareTitle||'Send or save'});return}
  const blob=new Blob([bytes],{type:mime});const file=new File([blob],filename,{type:mime});
  if(matchMedia('(pointer:coarse)').matches&&navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:filename});return}
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},4000);toast('Downloaded '+filename);
}
async function downloadPdf(html,filename,merge=[]){
  if(!window.html2pdf){toast('PDF tool is still loading. Try again in a moment.',true);return}
  toast('Preparing PDF…');
  const st=document.createElement('div');st.className='pdf-stage';st.innerHTML=`<div class="pdfdoc">${html}</div>`;document.body.appendChild(st);
  try{
    await Promise.all($$('img[data-ref^="img:"]',st).map(async i=>{i.src=(await loadImg(i.dataset.ref.slice(4)))||BLANK}));
    if(document.fonts&&document.fonts.ready)await document.fonts.ready;alignBrand(st);
    await Promise.all($$('img',st).map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r})));
    // Classic & Clean: leave room for a running header (pages 2+) and a footer on every page
    const mp=!!st.querySelector('.sheet')&&!isPrem();const MT=60,MB=40;
    if(mp)st.firstElementChild.classList.add('mp');
    const first=st.querySelector('.sheet');const tx=sel=>{const e=first&&first.querySelector(sel);if(!e)return '';const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);const parts=[];while(w.nextNode())parts.push(w.currentNode.nodeValue.trim());return parts.filter(Boolean).join(' ').replace(/\s+/g,' ')};
    const meta={client:(first&&first.dataset.client)||'',site:(first&&first.dataset.site)||'',ref:(first&&first.dataset.ref)||'',title:tx('.tbar .dt'),number:tx('.tbar .nb .no'),
      total:tx('.tot .gr')||(first&&first.querySelector('.sum4 .dk')?tx('.sum4 .dk .k')+' '+tx('.sum4 .dk .v'):'')||(tx('.rcamt .rv')?'Amount '+tx('.rcamt .rv'):'')};
    paginate(st.firstElementChild,mp?1123-MT-MB:1123);
    const w=html2pdf().set({margin:mp?[MT,0,MB,0]:0,filename,image:{type:'jpeg',quality:.95},html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff'},
      jsPDF:{unit:'px',format:[794,1123],orientation:'portrait',hotfixes:['px_scaling']},pagebreak:{mode:[]}}).from(st.firstElementChild);
    let bytes;
    if(mp){const pdf=await w.toPdf().get('pdf');decoratePages(pdf,meta,MT,MB);bytes=new Uint8Array(pdf.output('arraybuffer'))}
    else bytes=new Uint8Array(await w.outputPdf('arraybuffer'));
    if(merge.length){
      if(!window.PDFLib)toast('Attached PDFs were skipped: the PDF joiner did not load.',true);
      else{const out=await PDFLib.PDFDocument.load(bytes);let bad=0;
        for(const ref of merge){try{const data=await loadImg(ref.split(':')[1]);if(!data){bad++;continue}
          const src=await PDFLib.PDFDocument.load(dataToBytes(data),{ignoreEncryption:true});(await out.copyPages(src,src.getPageIndices())).forEach(pg=>out.addPage(pg))}catch(e){bad++}}
        bytes=await out.save();if(bad)toast(bad+' attached PDF could not be joined (it may be protected).',true)}
    }
    await saveFile(bytes,filename,'application/pdf','Send or save PDF');
  }catch(e){if(/abort|cancel|declin/i.test((e&&(e.name||e.message))||''))toast('Cancelled');else toast('Could not create the PDF: '+(e.message||e),true)}
  finally{st.remove()}
}
// Running header / footer drawn straight onto each PDF page (Classic & Clean styles)
function decoratePages(pdf,meta,MT,MB){
  const c=S.cfg,W=794,H=1123,L=48,R=W-48,n=pdf.internal.getNumberOfPages();
  const rgb=hx=>{const m=String(hx||'#000').replace('#','');const v=parseInt(m.length===3?m.split('').map(x=>x+x).join(''):m,16);return [(v>>16)&255,(v>>8)&255,v&255]};
  const dark=rgb(c.charcoal),grey=[120,124,131],line=[200,203,209];
  const fit=(t,max)=>{t=String(t||'');if(pdf.getTextWidth(t)<=max)return t;while(t.length>3&&pdf.getTextWidth(t+'…')>max)t=t.slice(0,-1);return t+'…'};
  let bc='';try{bc=meta.number?barcodeData(meta.number):''}catch(e){}
  // header boxes (pages 2+): [company · document] [client · site / ref] [barcode · number]
  const y=12,hh=38,c1=L,c2=L+250,c3=R-190;
  for(let i=1;i<=n;i++){pdf.setPage(i);
    if(i>1){
      pdf.setDrawColor(...line);pdf.setLineWidth(.8);pdf.roundedRect(L,y,R-L,hh,3,3,'S');pdf.line(c2,y,c2,y+hh);pdf.line(c3,y,c3,y+hh);
      pdf.setFont('helvetica','bold');pdf.setFontSize(8.5);pdf.setTextColor(...dark);pdf.text(fit(c.name,c2-c1-20),c1+10,y+15);
      pdf.setFont('helvetica','normal');pdf.setFontSize(7.5);pdf.setTextColor(...grey);pdf.text(fit(String(meta.title||'').toUpperCase(),c2-c1-20),c1+10,y+29);
      pdf.setFontSize(6);pdf.setTextColor(...grey);pdf.text(meta.ref?'CLIENT  ·  REF '+fit(meta.ref,120):'CLIENT / SITE',c2+10,y+11);
      pdf.setFont('helvetica','bold');pdf.setFontSize(8);pdf.setTextColor(...dark);pdf.text(fit(meta.client||'—',c3-c2-20),c2+10,y+22);
      pdf.setFont('helvetica','normal');pdf.setFontSize(7);pdf.setTextColor(...grey);pdf.text(fit(meta.site||'',c3-c2-20),c2+10,y+32);
      if(bc){try{pdf.addImage(bc,'PNG',c3+12,y+5,R-c3-24,17)}catch(e){}}
      pdf.setFont('courier','bold');pdf.setFontSize(8.5);pdf.setTextColor(...dark);pdf.text(meta.number||'',(c3+R)/2,y+33,{align:'center'});
    }
    // footer (every page)
    const fy=H-MB+24;pdf.setDrawColor(...line);pdf.setLineWidth(.6);pdf.line(L,H-MB+10,R,H-MB+10);
    pdf.setFont('helvetica','normal');pdf.setFontSize(7);pdf.setTextColor(...grey);
    pdf.text(fit(c.name+(c.taxId?'  ·  '+c.taxIdLabel+' '+c.taxId:''),250),L,fy);
    pdf.setFont('helvetica','bold');pdf.setTextColor(...dark);pdf.text(`Page ${i} of ${n}`,W/2,fy,{align:'center'});
    const right=i<n?(meta.total?meta.total+'  ·  continued':'Continued on next page'):(meta.number||String(c.website||'').split('·')[0].trim());
    pdf.setFont('helvetica',i<n?'bold':'normal');pdf.setTextColor(...(i<n?dark:grey));pdf.text(fit(right,250),R,fy,{align:'right'});
  }
}
// Page breaks: keep rows, totals, terms and signatures whole, and repeat table headings on new pages.
function paginate(root,pageH){
  const top0=()=>root.getBoundingClientRect().top;
  const els=$$('.pdfdoc > .sheet, .sheet > *:not(table), .sheet > table > tbody > tr',root);
  els.forEach((el,i)=>{
    const r=el.getBoundingClientRect(),t=r.top-top0(),b=r.bottom-top0();
    if(el.classList.contains('sheet')){ // each extra sheet (attachments) starts on a new page
      if(i>0&&t%pageH>1){const sp=document.createElement('div');sp.style.height=(Math.ceil(t/pageH)*pageH-t)+'px';el.parentNode.insertBefore(sp,el)}return}
    if(r.height<2||r.height>pageH*0.85)return;
    if(Math.floor(t/pageH)===Math.floor((b-1)/pageH))return;
    const pad=(Math.floor(t/pageH)+1)*pageH-t;
    if(el.tagName==='TR'){
      const sp=document.createElement('tr');sp.className='pgsp';sp.innerHTML=`<td colspan="20" style="height:${pad}px;padding:0;border:0;background:#fff"></td>`;
      el.parentNode.insertBefore(sp,el);
      const hd=el.closest('table').querySelector('thead tr');if(hd){const rh=hd.cloneNode(true);rh.className='rephead';el.parentNode.insertBefore(rh,el)}
    }else{
      // signatures never sit alone: take the terms / bank block (or amount in words) to the new page with them
      let target=el,tt=t;
      if(el.classList.contains('sigs')){let pv=el.previousElementSibling;while(pv&&(pv.classList.contains('pgsp')||pv.getBoundingClientRect().height<2))pv=pv.previousElementSibling;
        if(pv&&pv.matches('.info,.words,.svc')){const pt=pv.getBoundingClientRect().top-top0();if(b-pt<pageH*0.8){target=pv;tt=pt}}}
      const pad2=(Math.floor(tt/pageH)+1)*pageH-tt;
      const gap=parseFloat(getComputedStyle(target.parentNode).rowGap)||0;const sp=document.createElement('div');sp.className='pgsp';sp.style.height=Math.max(0,pad2-gap+6)+'px';target.parentNode.insertBefore(sp,target)}
  });
}
async function openAttachment(a){
  const data=await loadImg(a.ref.split(':')[1]);if(!data){toast('Could not load this attachment.',true);return}
  if(a.kind==='image'){modal(a.caption||a.name||'Photo',`<img src="${h(data)}" alt="" style="width:100%;border-radius:8px">`,'',true);return}
  try{await saveFile(dataToBytes(data),a.name||'attachment.pdf','application/pdf','Open attachment')}catch(e){}
}

/* ================= shell ================= */
function navItems(){
  const n=[['home','Overview',I.home]];
  if(can('quotation')||can('invoice')||can('viewAll'))n.push(['docs','Documents',I.doc]);
  if(can('delivery')||can('deliver'))n.push(['deliveries','Deliveries',I.truck]);
  if(can('clients')||can('reports'))n.push(['clients','Clients & SOA',I.users]);
  if(can('payments')||can('reports'))n.push(['payments','Payments',I.cash]);
  if(can('clients'))n.push(['products','Products',I.box]);
  if(isAdmin()){n.push(['accounts','Accounts',I.book]);n.push(['logins','Login log',I.clock]);n.push(['sep']);n.push(['staff','Staff & access',I.shield]);n.push(['settings','Company & template',I.gear])}
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
  const logo='<img src="assets/mark.png" alt="">';
  app.innerHTML=`<div class="app"><aside class="rail"><div class="brand"><div class="mark">${logo}</div><div><b>${h(S.cfg.name)}</b><small>Invoicing</small></div></div>
    ${nav.map(([k,l,ic])=>k==='sep'?'<div class="nav-sep"></div>':`<button class="nav-btn ${cur===k||(S.params.from===k)?'on':''}" data-go="${k}">${ic}${l}</button>`).join('')}
    <div class="who"><div style="color:#fff;font-weight:600">${h(S.me.name)}</div>${isAdmin()?'Admin':'Staff'} · <button class="btn ghost sm" data-myinfo style="color:inherit;padding:0 4px;min-height:0">My details</button> · <button class="btn ghost sm" data-logout style="color:inherit;padding:0 4px;min-height:0">Sign out</button></div></aside>
    <div style="min-width:0"><div class="topbar"><div class="brand"><div class="mark">${logo}</div><div><b>${h(S.cfg.name)}</b></div></div><span class="grow"></span><button class="btn sm" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.25)" data-menu>${I.menu}</button></div>
    <main class="main"><div class="wrap">${v}</div></main></div>
    <nav class="tabbar">${tabbar(cur)}</nav></div>`;
  bindCommon(app);
  if(VIEWS_AFTER[cur])VIEWS_AFTER[cur]();
  $$('.preview-wrap').forEach(fitPreview);alignBrand();if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>alignBrand());
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
  $$('[data-logout]',root).forEach(b=>b.onclick=logOut);
  $$('[data-myinfo]',root).forEach(b=>b.onclick=profileForm);
  $$('[data-menu]',root).forEach(b=>b.onclick=()=>{const o=modal('Menu',`<div class="list card">${navItems().filter(n=>n[0]!=='sep').map(([k,l,ic])=>`<button class="li" data-g="${k}"><span class="ico q">${ic.replace('<svg','<svg width="18" height="18"')}</span><span class="t">${l}</span><span></span></button>`).join('')}<button class="li" data-mi><span class="ico q">ME</span><span class="t">My contact details</span><span></span></button><button class="li" data-lo><span class="ico q">⏻</span><span class="t">Sign out (${h(S.me.name)})</span><span></span></button></div>`);$('[data-lo]',o).onclick=()=>{closeModal();logOut()};$('[data-mi]',o).onclick=profileForm;$$('[data-g]',o).forEach(b=>b.onclick=()=>go(b.dataset.g))});
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
  return `<button class="li" data-open="${d.id}"><span class="ico ${TYPE[d.type].c}">${d.type==='delivery'?rep(d).a:TYPE[d.type].a}</span><span style="min-width:0"><div class="t">${h(d.client&&d.client.name||'No client')}</div><div class="s"><span class="num">${h(d.number)}</span> · ${fdate(d.date)}${d.legacy?' · previous':''}${d.ref?' · '+h(d.ref):''}</div></span>
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
  return `<div class="head"><div class="row"><button class="btn ghost sm" id="bk">${I.back}Back</button><div><h1 class="num" style="font-family:var(--f-display)">${h(d.number)}</h1><div class="sub">${h(docTitle(d))} · ${h(d.client&&d.client.name||'')}</div></div></div>
   <div class="row">${d.legacy?'':`<button class="btn primary" id="pdf">${I.pdf}Download PDF</button>`}${canEdit?`<button class="btn" id="ed">${I.pen}Edit</button>`:''}</div></div>
  <div class="view-grid">${d.legacy?`<div class="card pad grid"><span class="pill">Previous invoice · entered manually</span><h2 class="num">${h(d.number)}</h2>
    <div class="grid g2"><div class="kv"><span class="muted">Date</span><span>${fdate(d.date)}</span></div><div class="kv"><span class="muted">Due</span><span>${fdate(d.dueDate)}</span></div>
    <div class="kv"><span class="muted">LPO / ref</span><span>${h(d.ref||'—')}</span></div><div class="kv"><span class="muted">VAT included</span><span class="num">${money(d.vat||0)}</span></div></div>
    ${d.notes?`<div class="muted">${h(d.notes)}</div>`:''}</div>`:`<div class="card preview-wrap"><div class="preview-scale">${renderSheet(d)}</div></div>`}
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
    ${d.type==='delivery'&&!(d.delivery&&d.delivery.signedAt)&&can('deliver')?`<button class="btn primary" id="dlv">${I.scan}${h(rep(d).act)}</button>`:''}
    ${d.type==='invoice'&&can('payments')&&paid<t.total?`<button class="btn primary" id="pay">${I.cash}Record payment</button>`:''}
    ${d.type==='quotation'&&can('quotation')?`<select id="qs" aria-label="Quotation status">${['draft','sent','accepted','rejected'].map(x=>`<option ${(d.status||'draft')===x?'selected':''} value="${x}">Mark as ${x}</option>`).join('')}</select>`:''}
    ${d.type==='quotation'&&can('invoice')?`<button class="btn" data-conv="invoice">Convert to invoice</button>`:''}
    ${!d.legacy&&(d.type==='quotation'||d.type==='invoice')&&can('delivery')?`<button class="btn" data-conv="delivery">Make delivery note</button>`:''}
    ${!d.legacy&&can(d.type)?`<button class="btn" id="dup">Duplicate</button>`:''}
    ${d.client&&d.clientId&&can('reports')?`<button class="btn" id="soa">Client statement (SOA)</button>`:''}
    ${can('delete')||isAdmin()?`<button class="btn danger" id="del">Delete</button>`:''}
   </div>
   ${(d.attachments||[]).length?`<div class="card pad"><h3 style="margin-bottom:8px">Attachments</h3><div class="attmini">${d.attachments.map((a,k)=>`<button class="am" data-openatt="${k}" title="${h(a.caption||a.name||'')}">${a.kind==='image'?img(a.ref):'<span>PDF</span>'}<small>${h(a.caption||a.name||'')}</small></button>`).join('')}</div></div>`:''}
   ${pays.length?`<div class="card pad"><h3 style="margin-bottom:6px">Payments</h3>${pays.map(p=>`<div class="kv"><span>${fdate(p.date)} · ${h(p.method||'')}</span><span class="row" style="gap:6px"><span class="num">${money(p.amount)}</span><button class="btn ghost sm" data-rcpt="${p.id}" title="Download receipt">${I.pdf}</button></span></div>`).join('')}</div>`:''}
  </aside></div>`;
};
VIEWS_AFTER.view=()=>{
  const d=S.docs.find(x=>x.id===S.params.id);$('#bk')&&($('#bk').onclick=()=>history.length&&S.params.back?go(S.params.back,S.params.backp||{}):go(d&&d.type==='delivery'&&!can('viewAll')?'deliveries':'docs',{tab:d&&d.type}));
  if(!d)return;
  $$('[data-open]').forEach(a=>a.onclick=e=>{e.preventDefault();go('view',{id:a.dataset.open})});
  $('#pdf')&&($('#pdf').onclick=()=>downloadPdf(renderSheet(d)+renderAnnex(d),`${d.number} ${(d.client&&d.client.name)||''}.pdf`
    .replace(/[\\/:*?"<>|]/g,'').trim(),pdfRefs(d)));
  $$('[data-openatt]').forEach(b=>b.onclick=()=>openAttachment(d.attachments[+b.dataset.openatt]));
  $$('[data-rcpt]').forEach(b=>b.onclick=()=>downloadReceipt(S.payments.find(x=>x.id===b.dataset.rcpt)));
  $('#ed')&&($('#ed').onclick=()=>d.legacy?legacyForm(d):go('edit',{id:d.id}));
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
  return {id:uid(),type,number:nextNumber(type,date),_auto:true,date,dueDate:type==='invoice'?addDays(date,S.cfg.dueDays):'',validUntil:type==='quotation'?addDays(date,S.cfg.validDays):'',
    clientId:'',client:null,ref:'',subject:'',salesperson:'',deliveryAddress:'',items:[{name:'',desc:'',qty:1,unit:'pcs',price:0,photo:''}],discount:0,taxRate:S.cfg.taxRate,
    notes:'',terms:S.cfg.terms[type]||'',status:type==='quotation'?'draft':'',createdBy:S.me.id,createdByName:S.me.name,contactName:S.me.name||'',contactMobile:(S.me.profile||{}).mobile||'',contactEmail:(S.me.profile||{}).email||'',createdAt:new Date().toISOString(),_new:true};
}
VIEWS.edit=()=>{
  const p=S.params;
  if(!ED||ED._key!==JSON.stringify(p)){
    if(p.id){ED=clone(S.docs.find(x=>x.id===p.id)||newDraft('invoice'))}
    else{ED=newDraft(p.type);const srcId=p.from||p.copy;const src=srcId&&S.docs.find(x=>x.id===srcId);
      if(src){Object.assign(ED,{clientId:src.clientId,client:src.client,ref:src.ref,subject:src.subject,salesperson:src.salesperson,items:clone(src.items||[]).map(i=>({...i,serials:p.type==='quotation'?[]:(i.serials||[])})),discount:src.discount,taxRate:src.taxRate,notes:src.notes});
        if(p.from)ED.sourceId=src.id; if(p.copy){ED.terms=src.terms;ED.attachments=clone(src.attachments||[])}}}
    ED._key=JSON.stringify(p);
  }
  const d=ED,isQ=d.type==='quotation',isDN=d.type==='delivery';
  const cls='item'+(isDN?' dn':'');const hasSN=!isQ;ED.attachments=ED.attachments||[];
  const SZ={S:'Small',M:'Med',L:'Large'};
  const t=totals(d);
  return `<div class="head"><div class="row"><button class="btn ghost sm" id="cx">${I.back}Cancel</button><div><h1>${d._new?'New':'Edit'} ${docTitle(d).replace('Tax ','').toLowerCase()}</h1><div class="sub num">${h(d.number)}</div></div></div><div class="row"><button class="btn primary" id="sv">Save</button></div></div>
  ${isDN?`<div class="card pad grid locard">
   <div class="grid g3"><label class="field"><span>Report type</span><select id="e-reportType">${Object.entries(REPORT).map(([k,r])=>`<option value="${k}" ${(d.reportType||'delivery')===k?'selected':''}>${h(r.t)}</option>`).join('')}</select></label>
    <div class="field" style="grid-column:span 2"><span>Location (GPS)</span><div class="gpsbox"><span id="gps-txt">${ED._gpsBusy?'Getting your location…':hasGPS(d.gps)?`<b class="num">${fmtGPS(d.gps)}</b> <span class="muted">±${h(d.gps.acc||0)} m</span>`:ED._gpsErr==='denied'?'<span style="color:var(--bad)">Location blocked. Allow location for this app, then tap Get location.</span>':ED._gpsErr?'<span style="color:var(--bad)">Location not available. Move outside or turn on GPS.</span>':'<span class="muted">Not captured yet</span>'}</span><button class="btn sm" id="gps-go" type="button">${hasGPS(d.gps)?'Refresh':'Get location'}</button></div></div></div>
   ${hasGPS(d.gps)?((ED._near||[]).length?`<div class="near"><span class="label">Nearby</span>${ED._near.map((m,k)=>`<button type="button" class="nchip ${ED._picked===k?'on':''}" data-near="${k}"><b>${h(m.client?m.client.name:'Site not linked to a client')}</b><span>${h(m.site||'Saved place')} · ${fmtDist(m.dist)}</span></button>`).join('')}</div>`
     :`<div class="muted" style="font-size:.84rem">No saved client at this spot. Pick a client below or add a new one. This place will be remembered for them.</div>`):''}
  </div>`:''}
  <div class="card pad grid">
   <div class="grid g4">
    <label class="field" style="grid-column:span 2"><span>Client</span><div class="row" style="flex-wrap:nowrap"><select id="e-client"><option value="">Choose a client…</option>${S.clients.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${c.id}" ${c.id===d.clientId?'selected':''}>${h(c.name)}</option>`).join('')}</select>${can('clients')?`<button class="btn" id="e-nc" title="Add client">${I.plus}</button>`:''}</div></label>
    <label class="field"><span>Number</span><input id="e-number" value="${h(d.number)}"></label>
    <label class="field"><span>Date</span><input type="date" id="e-date" value="${h(d.date)}"></label>
    ${d.type==='invoice'?`<label class="field"><span>Due date</span><input type="date" id="e-dueDate" value="${h(d.dueDate)}"></label>`:''}
    ${isQ?`<label class="field"><span>Valid until</span><input type="date" id="e-validUntil" value="${h(d.validUntil)}"></label>`:''}
    <label class="field"><span>${isQ?'Client reference':'LPO / reference'}</span><input id="e-ref" value="${h(d.ref)}"></label>
    <label class="field"><span>Salesperson</span><input id="e-salesperson" value="${h(d.salesperson)}"></label>
    <label class="field"><span>Contact person</span><input id="e-contactName" value="${h(d.contactName||'')}"></label>
    <label class="field"><span>Contact mobile</span><input id="e-contactMobile" inputmode="tel" value="${h(d.contactMobile||'')}"></label>
    <label class="field"><span>Contact email</span><input id="e-contactEmail" type="email" value="${h(d.contactEmail||'')}"></label>
    <label class="field" style="grid-column:span ${isDN?1:2}"><span>Subject</span><input id="e-subject" value="${h(d.subject)}" placeholder="e.g. Supply of CCTV equipment"></label>
    ${isDN?`<label class="field" style="grid-column:span 2"><span>Site / address</span><input id="e-deliveryAddress" value="${h(d.deliveryAddress)}"></label>`:''}
    ${isDN&&(d.reportType||'delivery')!=='delivery'?`<label class="field"><span>Technician</span><input id="e-technician" value="${h(d.technician||S.me.name||'')}"></label><label class="field"><span>Time in</span><input type="time" id="e-timeIn" value="${h(d.timeIn||'')}"></label><label class="field"><span>Time out</span><input type="time" id="e-timeOut" value="${h(d.timeOut||'')}"></label>
     <label class="field" style="grid-column:1/-1"><span>Complaint / request</span><textarea id="e-complaint" rows="2">${h(d.complaint||'')}</textarea></label><label class="field" style="grid-column:1/-1"><span>Work carried out</span><textarea id="e-workDone" rows="3">${h(d.workDone||'')}</textarea></label>`:''}
   </div>
  </div>
  <div class="card pad grid"><div class="row"><h2 class="grow">Items</h2><button class="btn sm" id="scan-add">${I.scan}Scan product</button></div>
   <datalist id="prodlist">${S.products.map(p=>`<option value="${h(p.name)}">`).join('')}</datalist>
   <div class="items">${d.items.map((i,n)=>`<div class="${cls}" data-i="${n}">
     ${isDN?'':`<div class="phw"><button class="photo" data-photo="${n}" type="button" aria-label="${i.photo?'Change':'Add'} product photo">${i.photo?img(i.photo):'+ Photo'}</button>${i.photo?`<select data-f="photoSize" aria-label="Photo size on document">${Object.entries(SZ).map(([k,l])=>`<option value="${k}" ${(i.photoSize||S.cfg.photoSize||'M')===k?'selected':''}>${l}</option>`).join('')}</select><button type="button" class="linkbtn" data-unphoto="${n}">Remove</button>`:''}</div>`}
     <div class="desc"><input list="prodlist" data-f="name" value="${h(i.name)}" placeholder="Item name"><textarea data-f="desc" rows="1" placeholder="Description, model, specs">${h(i.desc)}</textarea>
      ${hasSN?`<div class="snrow"><button class="btn sm ${(i.serials||[]).length?'':'ghost'}" type="button" data-serials="${n}">${I.scan}Serial nos ${(i.serials||[]).length?`· ${i.serials.length}/${h(i.qty||0)}`:''}</button>${(i.serials||[]).slice(0,3).map(x=>`<span class="chip">${h(x)}</span>`).join('')}${(i.serials||[]).length>3?`<span class="muted" style="font-size:.78rem">+${i.serials.length-3} more</span>`:''}</div>`:''}</div>
     <label class="field f-q"><span>Qty</span><input type="number" step="any" min="0" data-f="qty" value="${h(i.qty)}"></label>
     <label class="field f-u"><span>Unit</span><input data-f="unit" value="${h(i.unit)}"></label>
     ${isDN?`<label class="field f-s"><span>Status</span><select data-f="status">${rep(d).st.map(x=>`<option ${(i.status||rep(d).st[0])===x?'selected':''}>${h(x)}</option>`).join('')}</select></label>`:''}
     ${isDN?'':`<label class="field f-p"><span>Rate</span><input type="number" step="any" min="0" data-f="price" value="${h(i.price)}"></label><div class="amt"><span class="label">Amount</span><br><span data-amt="${n}">${money((+i.qty||0)*(+i.price||0))}</span></div>`}
     <button class="xbtn" data-rm="${n}" aria-label="Remove item">✕</button></div>`).join('')}</div>
   <div><button class="btn" id="add-item">${I.plus}Add item</button></div>
   ${isDN?'':`<div class="totals"><div class="tr"><span class="muted">Subtotal</span><span class="num" id="t-sub">${money(t.sub)}</span></div>
    <div class="tr" style="align-items:center"><span class="muted">Discount</span><input type="number" step="any" id="e-discount" value="${h(d.discount)}" style="width:120px;text-align:right"></div>
    <div class="tr" style="align-items:center"><span class="muted">${h(S.cfg.taxLabel)} %</span><input type="number" step="any" id="e-taxRate" value="${h(d.taxRate)}" style="width:120px;text-align:right"></div>
    <div class="tr"><span class="muted">${h(S.cfg.taxLabel)}</span><span class="num" id="t-tax">${money(t.tax)}</span></div>
    <div class="tr grand"><span>Total</span><span class="num" id="t-total">${cur(t.total)}</span></div></div>`}
  </div>
  <div class="card pad grid"><div class="row"><div class="hgrow"><h2>${isDN?h(rep(d).photos)+' photos':'Attachments'}</h2><div class="muted" style="font-size:.82rem">Photos print as extra pages after the document. Pick a size for each.${isDN?'':' PDF files (up to 700 KB each) are joined at the end.'}</div></div>
    <div class="row"><button class="btn" id="att-cam" type="button">${I.scan}Take photo</button><button class="btn" id="att-add" type="button">${I.plus}Upload${isDN?' photo':' photo or PDF'}</button></div></div>
   ${d.attachments.length?`<div class="atts">${d.attachments.map((a,k)=>attRow(a,k,'att',{inPdf:true})).join('')}</div>`:''}</div>
  <div class="card pad grid g2"><label class="field"><span>Notes (shown on document)</span><textarea id="e-notes">${h(d.notes)}</textarea></label><label class="field"><span>Terms & conditions</span><textarea id="e-terms" rows="4">${h(d.terms)}</textarea></label></div>
  <div class="row"><span class="grow"></span><button class="btn" id="cx2">Cancel</button><button class="btn primary" id="sv2">Save ${docTitle(d).replace('Tax ','').toLowerCase()}</button></div>`;
};
function readEditor(){
  const d=ED;
  ['number','date','dueDate','validUntil','ref','salesperson','subject','deliveryAddress','notes','terms','discount','taxRate','reportType','contactName','contactMobile','contactEmail','technician','timeIn','timeOut','complaint','workDone'].forEach(k=>{const el=$('#e-'+k);if(el)d[k]=el.type==='number'?(+el.value||0):el.value});
  $$('.items [data-i]').forEach(row=>{const it=d.items[+row.dataset.i];$$('[data-f]',row).forEach(el=>{it[el.dataset.f]=el.type==='number'?(el.value===''?'':+el.value):el.value})});
  readAtts(d.attachments||[],'att');
}
// Serial numbers for one line: type, paste a list, or scan with the camera.
function serialEditor(n){
  readEditor();const it=ED.items[n];it.serials=it.serials||[];let armed=false;
  const o=modal('Serial numbers',`<div><b>${h(it.name||'Item '+(n+1))}</b><div class="muted" id="sn-count"></div></div>
   <div class="scanrow"><input id="sn-in" placeholder="Type or scan, then Enter" autocomplete="off" autocapitalize="characters"><button class="btn" id="sn-add" type="button">Add</button><button class="btn primary" id="sn-cam" type="button">${I.scan}Camera</button></div>
   <div class="muted" style="font-size:.8rem">Tip: paste a list (one per line) to add many at once. A handheld barcode scanner also works in the box.</div>
   <div class="serials" id="sn-list"></div>`,`<button class="btn" id="sn-clear" type="button">Clear all</button><button class="btn" id="sn-qty" type="button">Set qty = count</button><span class="grow"></span><button class="btn primary" data-x>Done</button>`);
  const draw=()=>{$('#sn-count',o).textContent=`${it.serials.length} of ${it.qty||0} recorded`;
    $('#sn-list',o).innerHTML=it.serials.map((x,k)=>`<span class="chip">${h(x)}<button type="button" data-k="${k}" aria-label="Remove ${h(x)}">×</button></span>`).join('')||'<span class="muted">No serial numbers yet.</span>';
    $$('[data-k]',o).forEach(b=>b.onclick=()=>{it.serials.splice(+b.dataset.k,1);draw()})};
  const add=raw=>{const codes=String(raw||'').split(/[\n\r,;\t]+/).map(x=>x.trim()).filter(Boolean);let added=0;const dup=[];
    for(const code of codes){if(ED.items.some(x=>(x.serials||[]).includes(code))){dup.push(code);continue}it.serials.push(code);added++}
    if(dup.length)toast((dup.length===1?dup[0]+' is':dup.length+' serial numbers are')+' already on this document.',true);draw();return added>0};
  const inp=$('#sn-in',o);
  inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();add(inp.value);inp.value=''}};
  inp.addEventListener('paste',e=>{const t=(e.clipboardData||window.clipboardData).getData('text');if(/[\n,;\t]/.test(t)){e.preventDefault();add(t)}});
  $('#sn-add',o).onclick=()=>{add(inp.value);inp.value='';inp.focus()};
  $('#sn-cam',o).onclick=()=>openScanner(code=>add(code),{title:'Scan serials · '+(it.name||''),multi:true});
  $('#sn-qty',o).onclick=()=>{it.qty=it.serials.length;draw()};
  $('#sn-clear',o).onclick=e=>{if(!armed){armed=true;e.target.textContent='Tap again to clear';setTimeout(()=>{armed=false;e.target.textContent='Clear all'},2500);return}it.serials=[];armed=false;e.target.textContent='Clear all';draw()};
  o.addEventListener('click',e=>{if(e.target===o||e.target.closest('[data-x]'))setTimeout(render,0)});
  draw();setTimeout(()=>inp.focus(),50);
}
const PSZ=[['S','Small · 4 per page'],['M','Medium · 2 per page'],['L','Large · full page']];
function attRow(a,k,px,opts={}){
  return `<div class="att" data-${px}="${k}"><div class="ath">${a.kind==='image'?img(a.ref):'<span>PDF</span>'}</div><div class="atb">
   <input data-${px}f="caption" value="${h(a.caption||'')}" placeholder="${h(opts.ph||a.name||'Caption')}" aria-label="Caption">
   <div class="atc">${a.kind==='image'?`<select data-${px}f="size" aria-label="Size on the PDF">${PSZ.map(([v,l])=>`<option value="${v}" ${(a.size||'M')===v?'selected':''}>${l}</option>`).join('')}</select><button type="button" class="btn sm" data-${px}-rep="${k}">Replace</button>`:''}
   ${opts.inPdf?`<label class="check"><input type="checkbox" data-${px}f="inPdf" ${a.inPdf!==false?'checked':''}>In PDF</label>`:''}</div></div>
   <button class="xbtn" type="button" data-${px}-rm="${k}" aria-label="Delete">✕</button></div>`;
}
function readAtts(list,px){$$(`[data-${px}]`).forEach(row=>{const a=list[+row.dataset[px]];if(a)$$(`[data-${px}f]`,row).forEach(el=>{a[el.dataset[px+'f']]=el.type==='checkbox'?el.checked:el.value})})}
function pickFiles({accept='image/*',multiple=true,camera=false}={}){return new Promise(res=>{const inp=document.createElement('input');inp.type='file';inp.accept=accept;inp.multiple=multiple;if(camera)inp.setAttribute('capture','environment');
  inp.onchange=()=>res([...inp.files]);inp.click()})}
async function uploadFiles(files,{proof=false}={}){const out=[];
  for(const f of files){try{
    if(f.type==='application/pdf'||/\.pdf$/i.test(f.name)){
      if(f.size>700*1024){toast(f.name+' is larger than 700 KB. Compress it and try again.',true);continue}
      toast('Uploading '+f.name+'…');const data=await new Promise((r,j)=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.onerror=j;fr.readAsDataURL(f)});
      const id=uid();await Store.put('images',id,{data,name:f.name,mime:'application/pdf',createdBy:S.me.id,createdAt:new Date().toISOString()});IMG[id]=data;
      out.push({ref:'file:'+id,kind:'pdf',name:f.name,caption:'',inPdf:true});
    }else if(/^image\//.test(f.type)){toast('Uploading photo…');out.push({ref:await storeAttachmentImage(f),kind:'image',name:f.name,caption:'',inPdf:true,size:'M',...(proof?{proof:true}:{})})}
    else toast(f.name+' is not a photo or PDF.',true);
  }catch(e){toast('Could not upload '+f.name+': '+(e.message||e.code),true)}}
  if(out.length)toast(out.length+(out.length>1?' files':' file')+' added');return out;
}
async function replacePhoto(a){const [f]=await pickFiles({multiple:false});if(!f)return false;
  try{toast('Uploading photo…');const old=a.ref;a.ref=await storeAttachmentImage(f);a.name=f.name;if(isAdmin()&&old&&old.startsWith('img:'))Store.remove('images',old.slice(4)).catch(()=>{});toast('Photo replaced');return true}
  catch(e){toast('Could not upload: '+(e.message||e.code),true);return false}}
async function storeAttachmentImage(file){
  let data=await compress(file,1600,.82);if(data.length>900000)data=await compress(file,1200,.72);if(data.length>900000)data=await compress(file,900,.65);
  const id=uid();await Store.put('images',id,{data,name:file.name,mime:'image/jpeg',createdBy:S.me.id,createdAt:new Date().toISOString()});IMG[id]=data;return 'img:'+id;
}
async function addAttachments(camera){
  const files=await pickFiles({accept:camera||ED.type==='delivery'?'image/*':'image/*,application/pdf',camera});if(!files.length)return;
  readEditor();const added=await uploadFiles(files,{proof:ED.type==='delivery'});if(!ED)return;readEditor();ED.attachments.push(...added);render();
}
function updTotals(){readEditor();const t=totals(ED);if(!$('#t-sub'))return;$('#t-sub').textContent=money(t.sub);$('#t-tax').textContent=money(t.tax);$('#t-total').textContent=cur(t.total);ED.items.forEach((i,n)=>{const a=$(`[data-amt="${n}"]`);if(a)a.textContent=money((+i.qty||0)*(+i.price||0))})}
function addProduct(p){readEditor();const blank=ED.items.findIndex(i=>!i.name);const it={name:p.name,desc:p.desc||'',qty:1,unit:p.unit||'pcs',price:+p.price||0,photo:p.photo||'',pid:p.id};if(blank>=0)ED.items[blank]=it;else ED.items.push(it);render()}
VIEWS_AFTER.edit=()=>{
  const cancel=()=>{const d=ED;ED=null;d._new?go(d.sourceId?'view':'docs',d.sourceId?{id:d.sourceId}:{tab:d.type}):go('view',{id:d.id})};
  $('#cx').onclick=cancel;$('#cx2').onclick=cancel;
  $('#e-number').addEventListener('input',()=>{ED._auto=false});
  $('#e-date').addEventListener('change',()=>{if(ED._new&&ED._auto){readEditor();ED.number=nextNumber(ED.type,ED.date,ED.reportType);$('#e-number').value=ED.number}});
  if(ED.type==='delivery'){
    const applyNear=(k,auto)=>{const m=(ED._near||[])[k];if(!m)return;readEditor();ED._picked=k;
      if(m.client){ED.clientId=m.client.id;ED.client=clientSnap(m.client)}
      const place=[m.site,m.address].filter(Boolean).join(', ');if(place&&(!auto||!ED.deliveryAddress))ED.deliveryAddress=place;
      render();if(m.client)toast((auto?'Client picked from your location: ':'Client set: ')+m.client.name)};
    const locate=async()=>{readEditor();ED._gpsBusy=true;ED._gpsErr='';const tx=$('#gps-txt');if(tx)tx.textContent='Getting your location…';
      const g=await getGPS();if(!ED||ED.type!=='delivery'||!$('#e-reportType'))return;readEditor();ED._gpsBusy=false;
      if(!hasGPS(g)){ED._gpsErr=(g&&g.error)||'unavailable';render();return}
      ED.gps=g;ED._near=nearby(g);ED._picked=-1;
      const k=ED._near.findIndex(m=>m.client);
      if(!ED.clientId&&k>=0){applyNear(k,true);return}
      if(!ED.deliveryAddress&&ED._near[0]&&ED._near[0].site)ED.deliveryAddress=ED._near[0].site;
      render()};
    $('#gps-go').onclick=locate;
    $$('[data-near]').forEach(b=>b.onclick=()=>applyNear(+b.dataset.near));
    $('#e-reportType').onchange=()=>{readEditor();const st=rep(ED).st;ED.items.forEach(i=>{if(i.status&&!st.includes(i.status))i.status=st[0]});
      if(ED._new&&ED._auto)ED.number=nextNumber(ED.type,ED.date,ED.reportType);render()};
    if(ED._new&&!ED.gps&&!ED._gpsTried){ED._gpsTried=true;locate()}
  }
  $('#e-client').onchange=e=>{readEditor();ED.clientId=e.target.value;const c=S.clients.find(x=>x.id===ED.clientId);ED.client=c?clientSnap(c):null;if(c&&ED.type==='invoice'&&c.creditDays)ED.dueDate=addDays(ED.date,+c.creditDays);if(c&&ED.type==='delivery'&&!ED.deliveryAddress)ED.deliveryAddress=c.address||'';render()};
  $('#e-nc')&&($('#e-nc').onclick=()=>{readEditor();clientForm(null,c=>{ED.clientId=c.id;ED.client=clientSnap(c);render()})});
  $('#add-item').onclick=()=>{readEditor();ED.items.push({name:'',desc:'',qty:1,unit:'pcs',price:0,photo:''});render();const rows=$$('.items [data-i]');$('[data-f="name"]',rows[rows.length-1]).focus()};
  $$('[data-rm]').forEach(b=>b.onclick=()=>{readEditor();ED.items.splice(+b.dataset.rm,1);if(!ED.items.length)ED.items.push({name:'',qty:1,unit:'pcs',price:0});render()});
  $$('[data-serials]').forEach(b=>b.onclick=()=>serialEditor(+b.dataset.serials));
  $$('[data-unphoto]').forEach(b=>b.onclick=()=>{readEditor();ED.items[+b.dataset.unphoto].photo='';render()});
  $('#att-add').onclick=()=>addAttachments(false);$('#att-cam').onclick=()=>addAttachments(true);
  $$('[data-att-rep]').forEach(b=>b.onclick=async()=>{readEditor();if(await replacePhoto(ED.attachments[+b.dataset.attRep]))render()});
  $$('[data-att-rm]').forEach(b=>b.onclick=()=>{readEditor();ED.attachments.splice(+b.dataset.attRm,1);render()});
  $$('[data-photo]').forEach(b=>b.onclick=async()=>{const f=await pickImage();if(!f)return;readEditor();toast('Uploading photo…');ED.items[+b.dataset.photo].photo=await storeImage(f,800);render()});
  $$('.items input,.items textarea,#e-discount,#e-taxRate').forEach(el=>el.addEventListener('input',updTotals));
  $$('.items [data-f="name"]').forEach(el=>el.addEventListener('change',()=>{const p=S.products.find(x=>x.name===el.value);if(!p)return;readEditor();const it=ED.items[+el.closest('[data-i]').dataset.i];Object.assign(it,{desc:it.desc||p.desc||'',price:+p.price||it.price,unit:p.unit||it.unit,photo:it.photo||p.photo||'',pid:p.id});render()}));
  $('#scan-add').onclick=()=>openScanner(code=>{const p=S.products.find(x=>x.barcode===code||x.sku===code);if(p){addProduct(p);toast('Added '+p.name)}else{readEditor();ED.items.push({name:code,desc:'',qty:1,unit:'pcs',price:0});render();toast('Code '+code+' is not in your product list. Added as a new line.')}},{title:'Scan product'});
  const doSave=async()=>{readEditor();const d=clone(ED);
    if(!d.clientId){toast('Choose a client first.',true);return}
    d.items=d.items.filter(i=>i.name||i.desc);if(!d.items.length&&!(d.type==='delivery'&&(d.reportType||'delivery')!=='delivery')){toast('Add at least one item.',true);return}
    const b1=$('#sv'),b2=$('#sv2');b1.disabled=b2.disabled=true;
    try{
      if(d._new&&d._auto)d.number=await reserveNumber(d.type,d.date,d.reportType,d.number);
      if(S.docs.some(x=>x.id!==d.id&&x.number===d.number)){toast('Number '+d.number+' is already used.',true);return}
      const c=S.clients.find(x=>x.id===d.clientId);if(c)d.client=clientSnap(c);
      delete d._new;delete d._key;delete d._auto;['_gpsBusy','_gpsErr','_near','_gpsTried','_picked'].forEach(k=>delete d[k]);d.updatedAt=new Date().toISOString();
      if(await save('docs',d.id,d,'Saved '+d.number)){ED=null;syncProducts(d);rememberPlace(d);go('view',{id:d.id})}
    }finally{b1.disabled=b2.disabled=false}};
  $('#sv').onclick=doSave;$('#sv2').onclick=doSave;
};
// Every item typed on a document is kept in the product list for next time.
async function syncProducts(d){
  const seen=new Set();
  for(const i of d.items||[]){
    const name=String(i.name||'').trim();const key=name.toLowerCase();if(!name||seen.has(key))continue;seen.add(key);
    const p=S.products.find(x=>String(x.name||'').trim().toLowerCase()===key);
    try{
      if(!p){const np={name,desc:i.desc||'',unit:i.unit||'pcs',price:d.type==='delivery'?0:(+i.price||0),photo:i.photo||'',barcode:'',createdBy:S.me.id,createdAt:new Date().toISOString(),source:d.number};
        const id=uid();await Store.put('products',id,np);S.products.push({...np,id})}
      else if(can('clients')){const upd={};if(!p.photo&&i.photo)upd.photo=i.photo;if(!p.desc&&i.desc)upd.desc=i.desc;if(d.type!=='delivery'&&+i.price&&+i.price!==+p.price)upd.price=+i.price;
        if(Object.keys(upd).length)await Store.put('products',p.id,{...p,...upd,updatedAt:new Date().toISOString()})}
    }catch(e){console.warn('product save',e)}
  }
}
const clientSnap=c=>({name:c.name,contact:c.contact||'',address:c.address||'',phone:c.phone||'',email:c.email||'',taxId:c.taxId||''});

/* ----- delivery: scan serials + sign ----- */
let DV=null,pad=null;
VIEWS.deliver=()=>{
  const d=S.docs.find(x=>x.id===S.params.id);if(!d)return '<div class="empty"><b>Delivery note not found</b></div>';
  if(!DV||DV.id!==d.id)DV={id:d.id,items:clone(d.items||[]).map(i=>({...i,serials:i.serials||[]})),receiver:'',receiverPhone:'',photos:clone(d.attachments||[])};
  const need=DV.items.reduce((s,i)=>s+(+i.qty||0),0),got=DV.items.reduce((s,i)=>s+i.serials.length,0);
  return `<div class="head"><div class="row"><button class="btn ghost sm" id="bk">${I.back}Back</button><div><h1>${(d.reportType||'delivery')==='delivery'?'Deliver':'Sign off'} ${h(d.number)}</h1><div class="sub">${h(d.client&&d.client.name||'')}${d.deliveryAddress?' · '+h(d.deliveryAddress):''}</div><div class="sub" id="dv-gps" style="font-size:.8rem">${hasGPS(DV.gps)?'Location '+fmtGPS(DV.gps)+' ±'+DV.gps.acc+' m':'Getting location…'}</div></div></div></div>
  <div class="card pad grid"><div class="row"><h2 class="grow">1. Items, status & serial numbers</h2><span class="muted num">${got} of ${need} scanned</span></div>
   <div class="progress"><i style="width:${need?Math.min(100,got/need*100):0}%"></i></div>
   <p class="muted" style="margin:0">Tap <b>Camera</b> to photograph a barcode, or type it and press Enter. A handheld USB/Bluetooth scanner also works in the box.</p>
   <label class="field" style="max-width:280px"><span>Mark all items as</span><select id="st-all"><option value="">Choose…</option>${rep(d).st.map(x=>`<option>${h(x)}</option>`).join('')}</select></label>
   ${DV.items.map((i,n)=>`<div class="dl-item"><div class="row"><div class="grow" style="min-width:0"><b>${h(i.name)}</b><div class="muted" style="font-size:.8rem">${h(i.desc||'')}</div></div><span class="pill ${i.serials.length>=+i.qty?'good':'warn'} num">${i.serials.length}/${h(i.qty)}</span></div>
     <select data-st="${n}" aria-label="Status for ${h(i.name)}" style="max-width:280px">${rep(d).st.map(x=>`<option ${(i.status||rep(d).st[0])===x?'selected':''}>${h(x)}</option>`).join('')}</select>
     <div class="scanrow"><input id="sn-${n}" data-sn="${n}" placeholder="Scan or type serial number" autocomplete="off"><button class="btn" data-cam="${n}">${I.scan}Camera</button></div>
     ${i.serials.length?`<div class="serials">${i.serials.map((s,k)=>`<span class="chip">${h(s)}<button data-del="${n}:${k}" aria-label="Remove ${h(s)}">×</button></span>`).join('')}</div>`:''}</div>`).join('')}
  </div>
  <div class="card pad grid"><h2>2. Receiver</h2><div class="grid g2"><label class="field"><span>Received by (name)</span><input id="rc-name" value="${h(DV.receiver)}"></label><label class="field"><span>Mobile</span><input id="rc-phone" value="${h(DV.receiverPhone)}" inputmode="tel"></label></div>
   <div class="row"><h3 class="grow">Receiver signature</h3><button class="btn sm" id="sig-clr">Clear</button></div><div class="sigpad" id="sig"></div></div>
  <div class="card pad grid"><div class="row"><div class="hgrow"><h2>3. ${h(rep(d).photos)} photos</h2><div class="muted" style="font-size:.82rem">Optional. Photos print on the delivery note as extra pages.</div></div><div class="row"><button class="btn primary" id="pod-cam" type="button">${I.scan}Take photo</button><button class="btn" id="pod-up" type="button">${I.plus}Upload</button></div></div>
   ${DV.photos.length?`<div class="atts">${DV.photos.map((a,k)=>attRow(a,k,'pod',{ph:'Caption, e.g. Installed at reception'})).join('')}</div>`:''}</div>
  <div class="row"><span class="grow"></span><button class="btn" id="save-draft">Save without signing</button><button class="btn primary" id="confirm">Confirm delivery</button></div>`;
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
  if(!DV.gps&&!DV._gpsTried){DV._gpsTried=true;getGPS().then(g=>{if(!DV||DV.id!==d.id)return;const el=$('#dv-gps');if(hasGPS(g)){DV.gps=g;if(el)el.textContent='Location '+fmtGPS(g)+' ±'+g.acc+' m'}else if(el)el.textContent=g&&g.error==='denied'?'Location blocked. Allow location access to record where this was signed.':'Location not available.'})}
  $$('[data-st]').forEach(sel=>sel.onchange=()=>{DV.items[+sel.dataset.st].status=sel.value});
  $('#st-all').onchange=e=>{if(!e.target.value)return;keep();const sig=!pad.isEmpty()?pad.toData():null;DV.items.forEach(i=>i.status=e.target.value);render();if(sig)pad.load(sig)};
  const keepSig=fn=>{keep();readAtts(DV.photos,'pod');const sig=!pad.isEmpty()?pad.toData():null;fn();render();if(sig)pad.load(sig)};
  const podAdd=async camera=>{const files=await pickFiles({camera});if(!files.length)return;const added=await uploadFiles(files,{proof:true});if(added.length&&DV)keepSig(()=>DV.photos.push(...added))};
  $('#pod-cam').onclick=()=>podAdd(true);$('#pod-up').onclick=()=>podAdd(false);
  $$('[data-pod-rep]').forEach(b=>b.onclick=async()=>{readAtts(DV.photos,'pod');const a=DV.photos[+b.dataset.podRep];if(await replacePhoto(a))keepSig(()=>{})});
  $$('[data-pod-rm]').forEach(b=>b.onclick=()=>keepSig(()=>DV.photos.splice(+b.dataset.podRm,1)));
  $('#save-draft').onclick=async()=>{keep();readAtts(DV.photos,'pod');if(await save('docs',d.id,{...d,items:DV.items,attachments:DV.photos,updatedAt:new Date().toISOString()},'Saved'))go('view',{id:d.id})};
  $('#confirm').onclick=async()=>{keep();
    if(!DV.receiver.trim()){toast('Enter the receiver\'s name.',true);return}
    if(pad.isEmpty()){toast('Ask the receiver to sign in the box.',true);return}
    readAtts(DV.photos,'pod');
    const sigData=pad.toData();
    if(!DV.gps){toast('Recording location…');const g=await getGPS();if(hasGPS(g))DV.gps=g}
    const upd={...d,items:DV.items,attachments:DV.photos,updatedAt:new Date().toISOString(),delivery:{receiver:DV.receiver.trim(),receiverPhone:DV.receiverPhone.trim(),signature:sigData,signedAt:new Date().toISOString(),deliveredBy:S.me.id,deliveredByName:S.me.name,gps:DV.gps||null}};
    if(!hasGPS(d.gps)&&DV.gps)upd.gps=DV.gps;
    const btn=$('#confirm');btn.disabled=true;
    if(await save('docs',d.id,upd)){const who=DV.receiver.trim();DV=null;go('view',{id:d.id});thankYou(upd,who)}else btn.disabled=false};
};
function thankYou(d,who){
  const R=rep(d);const o=modal(R.done,`<div class="thanks"><div class="tick">✓</div><h2>Thank you${who?', '+h(who):''}!</h2>
   <p>${h(R.ty)}<br>We appreciate your business.</p><div class="from">${img(S.cfg.logo)}<div><b>${h(S.cfg.name)}</b><span class="num">${h(d.number)} · ${fdt(d.delivery.signedAt)}</span></div></div></div>`,
   `<button class="btn" id="ty-pdf">${I.pdf}${h(R.t)} PDF</button><span class="grow"></span><button class="btn primary" data-x>Done</button>`);
  $('#ty-pdf',o).onclick=()=>downloadPdf(renderSheet(d)+renderAnnex(d),`${d.number} ${(d.client&&d.client.name)||''}.pdf`.replace(/[\\/:*?"<>|]/g,'').trim());
}
function profileForm(){
  const p=S.me.profile||{};
  const o=modal('My contact details',`<p class="muted" style="margin:0">Printed on documents you create, after the reference, so clients can reach you directly.</p>
    <div class="grid g2"><label class="field" style="grid-column:1/-1"><span>Name</span><input value="${h(S.me.name)}" disabled></label>
    <label class="field"><span>Mobile</span><input id="pf-m" inputmode="tel" value="${h(p.mobile||'')}" placeholder="+971 50 000 0000"></label>
    <label class="field"><span>Email</span><input id="pf-e" type="email" value="${h(p.email||'')}" placeholder="name@llct.net"></label></div>`,
    `<button class="btn" data-x>Cancel</button><button class="btn primary" id="pf-s">Save</button>`);
  $('#pf-s',o).onclick=async()=>{const d={mobile:$('#pf-m',o).value.trim(),email:$('#pf-e',o).value.trim(),updatedAt:new Date().toISOString()};
    if(await save('profiles',S.me.id,d,'Contact details saved')){S.me.profile=d;closeModal()}};
}
/* ----- clients ----- */
VIEWS.clients=()=>{
  const q=(S.params.q||'').toLowerCase();
  const list=S.clients.filter(c=>!q||[c.name,c.contact,c.phone,c.email].join(' ').toLowerCase().includes(q)).map(c=>({c,b:clientBalance(c.id)})).sort((a,b)=>b.b-a.b||a.c.name.localeCompare(b.c.name));
  return `<div class="head"><div><h1>Clients & SOA</h1><div class="sub">${S.clients.length} clients${can('reports')?' · '+cur(list.reduce((s,x)=>s+x.b,0))+' receivable':''}</div></div>${can('clients')?`<div class="row"><button class="btn" id="imc">Import</button><button class="btn primary" id="nc">${I.plus}Add client</button></div>`:''}</div>
  <input class="search" id="cq" placeholder="Search clients" value="${h(S.params.q||'')}">
  <div class="card list">${list.length?list.map(({c,b})=>`<button class="li" data-c="${c.id}"><span class="ico q">${h(c.name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase())}</span><span style="min-width:0"><div class="t">${h(c.name)}</div><div class="s">${h([c.contact,c.phone].filter(Boolean).join(' · ')||'No contact details')}</div></span>
   <span class="r">${can('reports')?`<div class="num" style="${b>0?'font-weight:600':''}">${money(b)}</div><span class="pill ${b>0?'warn':'good'}">${b>0?'balance due':b<0?'in credit':'settled'}</span>`:''}</span></button>`).join(''):`<div class="empty"><b>No clients yet</b>Add a client to start quoting and invoicing.</div>`}</div>`;
};
VIEWS_AFTER.clients=()=>{
  $('#nc')&&($('#nc').onclick=()=>clientForm());$('#imc')&&($('#imc').onclick=()=>importForm('clients'));
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
   <div class="row">${can('clients')?`<button class="btn" id="ec">${I.pen}Edit</button>`:''}${can('invoice')?`<button class="btn" id="old-inv">${I.plus}Add previous invoices</button>`:''}${can('payments')?`<button class="btn" id="cp">${I.cash}Record payment</button>`:''}${can('reports')?`<button class="btn primary" id="soa">${I.pdf}SOA PDF</button>`:''}</div></div>
  ${can('reports')?`<div class="kpis"><div class="card kpi hl"><span class="label">Balance due</span><span class="v">${money(clientBalance(c.id))}<small>${h(S.cfg.currency)}</small></span></div>
   <div class="card kpi"><span class="label">Overdue 1–30</span><span class="v">${money(x.ag.a30)}</span></div><div class="card kpi"><span class="label">Overdue 31–90</span><span class="v">${money(x.ag.a60+x.ag.a90)}</span></div><div class="card kpi"><span class="label">Over 90 days</span><span class="v">${money(x.ag.a90p)}</span></div></div>
  <div class="card"><div class="pad row"><div class="hgrow"><h2>SOA</h2><div class="muted" style="font-size:.8rem">Statement of account · tap any line to edit</div></div><div class="dates"><label class="field"><span>From</span><input type="date" id="sf" value="${from}"></label><label class="field"><span>To</span><input type="date" id="st" value="${to}"></label></div></div>
   <div class="scroll-x"><table class="tbl"><thead><tr><th>Date</th><th>Transaction</th><th>Number</th><th>Reference</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead><tbody>
   <tr><td class="num">${fdate(from)}</td><td colspan="5"><b>Balance brought forward</b></td><td class="r num"><b>${money(x.open)}</b></td></tr>
   ${x.rows.map(r=>`<tr class="soarow" ${r.id?`data-sinv="${r.id}"`:r.pid?`data-spay="${r.pid}"`:r.open?'data-sopen="1"':''} tabindex="0"><td class="num">${fdate(r.date)}</td><td>${h(r.kind)}</td><td class="num">${h(r.no)}</td><td>${h(r.ref)}</td><td class="r num">${r.dr?money(r.dr):''}</td><td class="r num">${r.cr?money(r.cr):''}</td><td class="r num">${money(r.bal)}</td></tr>`).join('')}
   <tr><td colspan="4"><b>Closing balance</b></td><td class="r num"><b>${money(x.invd)}</b></td><td class="r num"><b>${money(x.recd)}</b></td><td class="r num"><b>${money(x.close)}</b></td></tr></tbody></table></div></div>`:''}
  <div class="card"><div class="pad"><h2>Documents</h2></div><div class="list">${docs.filter(d=>visibleDocs().includes(d)).map(docRow).join('')||'<div class="empty">No documents for this client yet.</div>'}</div></div>`;
};
VIEWS_AFTER.client=()=>{
  const c=S.clients.find(x=>x.id===S.params.id);$('#bk')&&($('#bk').onclick=()=>go('clients'));if(!c)return;
  $('#ec')&&($('#ec').onclick=()=>clientForm(c));
  $('#cp')&&($('#cp').onclick=()=>paymentForm({clientId:c.id}));
  $('#old-inv')&&($('#old-inv').onclick=()=>legacyBulk(c));
  $$('[data-sinv]').forEach(r=>r.onclick=()=>{const d=S.docs.find(x=>x.id===r.dataset.sinv);if(!d)return;d.legacy&&can('invoice')?legacyForm(d):go('view',{id:d.id})});
  $$('[data-spay]').forEach(r=>r.onclick=()=>{if(!can('payments')){toast('You don\'t have permission to edit payments.',true);return}const p=S.payments.find(x=>x.id===r.dataset.spay);if(p)paymentForm(p)});
  $$('[data-sopen]').forEach(r=>r.onclick=()=>can('clients')&&clientForm(c));
  $$('.soarow').forEach(r=>r.onkeydown=e=>{if(e.key==='Enter')r.click()});
  $$('[data-open]').forEach(a=>a.onclick=e=>{e.preventDefault();go('view',{id:a.dataset.open})});
  const sf=$('#sf'),st=$('#st');if(sf){const ch=()=>{S.params.sf=sf.value;S.params.st=st.value;render()};sf.onchange=ch;st.onchange=ch}
  $('#soa')&&($('#soa').onclick=()=>{const f=$('#sf').value,t=$('#st').value;downloadPdf(renderSOA(c.id,f,t),`SOA ${c.name} ${t}.pdf`.replace(/[\\/:*?"<>|]/g,''))});
};
/* ----- previous invoices (issued before this app) ----- */
function parseDate(v){v=String(v||'').trim();if(!v)return '';let m=v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);if(m)return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m=v.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);if(m){const y=m[3].length===2?'20'+m[3]:m[3];return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`}
  const t=new Date(v);return isNaN(t)?'':new Date(t-t.getTimezoneOffset()*6e4).toISOString().slice(0,10)}
const parseAmt=v=>{const n=parseFloat(String(v||'').replace(/[^0-9.\-]/g,''));return isNaN(n)?0:r2(n)};
function legacyBulk(c){
  let rows=[{no:'',date:'',due:'',ref:'',amount:'',paid:''}];
  const o=modal('Add previous invoices · '+c.name,`<div class="muted" style="font-size:.86rem">Invoices issued before you started this app. They count in the statement, ageing and receivables. <b>Paste from Excel</b> into any box: columns <b>Invoice no, Date, Amount, Paid</b> (Paid and LPO optional).</div>
    <div class="scroll-x"><table class="tbl lgt"><thead><tr><th>Invoice no.</th><th>Date</th><th>Due date</th><th>LPO / ref</th><th class="r">Amount incl. VAT</th><th class="r">Already paid</th><th></th></tr></thead><tbody id="lg-rows"></tbody></table></div>
    <div class="row"><button class="btn" id="lg-add" type="button">${I.plus}Add row</button><span class="grow"></span><span class="muted" id="lg-sum"></span></div>`,
    `<button class="btn" data-x>Cancel</button><button class="btn primary" id="lg-save">Save</button>`,true);
  const cd=+c.creditDays||S.cfg.dueDays;
  const read=()=>{$$('#lg-rows tr',o).forEach((tr,k)=>{$$('[data-lf]',tr).forEach(el=>rows[k][el.dataset.lf]=el.value)})};
  const sum=()=>{read();const ok=rows.filter(r=>r.no&&parseAmt(r.amount));const t=ok.reduce((s,r)=>s+parseAmt(r.amount)-Math.min(parseAmt(r.paid),parseAmt(r.amount)),0);
    $('#lg-sum',o).textContent=`${ok.length} invoice${ok.length===1?'':'s'} · balance ${cur(t)}`;$('#lg-save',o).textContent=ok.length?`Save ${ok.length} invoice${ok.length===1?'':'s'}`:'Save'};
  const draw=()=>{$('#lg-rows',o).innerHTML=rows.map((r,k)=>`<tr>
     <td><input data-lf="no" value="${h(r.no)}" placeholder="e.g. 2025/118" aria-label="Invoice number"></td>
     <td><input data-lf="date" type="date" value="${h(r.date)}" aria-label="Invoice date"></td>
     <td><input data-lf="due" type="date" value="${h(r.due)}" aria-label="Due date"></td>
     <td><input data-lf="ref" value="${h(r.ref)}" aria-label="LPO or reference"></td>
     <td><input data-lf="amount" inputmode="decimal" value="${h(r.amount)}" style="text-align:right" aria-label="Amount"></td>
     <td><input data-lf="paid" inputmode="decimal" value="${h(r.paid)}" style="text-align:right" placeholder="0" aria-label="Already paid"></td>
     <td><button class="xbtn" type="button" data-lrm="${k}" aria-label="Remove row">✕</button></td></tr>`).join('');
    $$('[data-lrm]',o).forEach(b=>b.onclick=()=>{read();rows.splice(+b.dataset.lrm,1);if(!rows.length)rows.push({no:'',date:'',due:'',ref:'',amount:'',paid:''});draw()});
    $$('[data-lf]',o).forEach(el=>{el.oninput=sum;el.onpaste=e=>{const t=(e.clipboardData||window.clipboardData).getData('text');if(!/[\t\n]/.test(t))return;e.preventDefault();read();
      const lines=t.split(/\r?\n/).map(l=>(l.includes('\t')?l.split('\t'):l.split(/;|,(?!\d{3}\b)/)).map(x=>x.trim())).filter(c=>c.some(Boolean));
      const add=lines.filter(c=>c[0]&&!/^inv|^no|^number/i.test(c[0])||parseAmt(c[2])).map(cl=>({no:cl[0]||'',date:parseDate(cl[1]),due:'',ref:cl[4]||'',amount:cl[2]?String(parseAmt(cl[2])):'',paid:cl[3]?String(parseAmt(cl[3])):''}));
      rows=rows.filter(r=>r.no||r.amount).concat(add);if(!rows.length)rows.push({no:'',date:'',due:'',ref:'',amount:'',paid:''});draw();toast(add.length+' row'+(add.length===1?'':'s')+' pasted')}});
    sum()};
  draw();
  $('#lg-add',o).onclick=()=>{read();rows.push({no:'',date:'',due:'',ref:'',amount:'',paid:''});draw();const ins=$$('[data-lf="no"]',o);ins[ins.length-1].focus()};
  $('#lg-save',o).onclick=async()=>{read();const good=[],bad=[];
    rows.forEach((r,k)=>{if(!r.no&&!r.amount)return;const amt=parseAmt(r.amount),date=parseDate(r.date);
      if(!r.no||!amt||!date){bad.push(k+1);return}
      if(S.docs.some(d=>d.number===r.no.trim())||good.some(g=>g.no===r.no.trim())){bad.push(k+1);toast('Invoice '+r.no+' already exists.',true);return}
      good.push({...r,no:r.no.trim(),amt,date})});
    if(bad.length){toast('Check row '+bad.join(', ')+': invoice no., date and amount are needed.',true);return}
    if(!good.length){toast('Enter at least one invoice.',true);return}
    const b=$('#lg-save',o);b.disabled=true;let n=0;
    for(const r of good){const id=uid(),now=new Date().toISOString();
      const doc={type:'invoice',legacy:true,number:r.no,date:r.date,dueDate:parseDate(r.due)||addDays(r.date,cd),ref:r.ref||'',amount:r.amt,vat:0,items:[],
        clientId:c.id,client:clientSnap(c),notes:'Previous invoice, entered manually',createdBy:S.me.id,createdByName:S.me.name,createdAt:now,updatedAt:now};
      if(!await save('docs',id,doc))break;n++;
      const paid=Math.min(parseAmt(r.paid),r.amt);
      if(paid>0&&can('payments'))await save('payments',uid(),{clientId:c.id,invoiceId:id,amount:paid,date:r.date,method:'Previous payment',ref:'',note:'Paid before using the app',createdBy:S.me.id,updatedAt:now});
    }
    b.disabled=false;if(n){toast(n+' previous invoice'+(n===1?'':'s')+' added');closeModal()}};
}
function legacyForm(d){
  const paid=paidOn(d.id);
  const o=modal('Previous invoice',`<div class="grid g2">
    <label class="field"><span>Invoice no.</span><input id="lf-no" value="${h(d.number)}"></label><label class="field"><span>LPO / ref</span><input id="lf-ref" value="${h(d.ref||'')}"></label>
    <label class="field" style="grid-column:1/-1"><span>Description</span><input id="lf-subj" value="${h(d.subject||'')}" placeholder="e.g. Water park CCTV"></label>
    <label class="field"><span>Date</span><input type="date" id="lf-date" value="${h(d.date)}"></label><label class="field"><span>Due date</span><input type="date" id="lf-due" value="${h(d.dueDate||'')}"></label>
    <label class="field"><span>Amount incl. VAT (${h(S.cfg.currency)})</span><input id="lf-amt" inputmode="decimal" value="${h(d.amount)}"></label><label class="field"><span>VAT included (optional)</span><input id="lf-vat" inputmode="decimal" value="${h(d.vat||'')}"></label>
    <label class="field" style="grid-column:1/-1"><span>Note</span><input id="lf-note" value="${h(d.notes||'')}"></label></div>
    <div class="kv"><span class="muted">Paid so far</span><span class="num">${money(paid)}</span></div>`,
    `${can('delete')||isAdmin()?'<button class="btn danger" id="lf-del">Delete</button>':''}${can('payments')?'<button class="btn" id="lf-pay">Record payment</button>':''}<span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="lf-save">Save</button>`);
  $('#lf-save',o).onclick=async()=>{const no=$('#lf-no',o).value.trim(),amt=parseAmt($('#lf-amt',o).value),date=$('#lf-date',o).value;
    if(!no||!amt||!date){toast('Invoice no., date and amount are needed.',true);return}
    if(S.docs.some(x=>x.id!==d.id&&x.number===no)){toast('Number '+no+' is already used.',true);return}
    const u={...d,number:no,ref:$('#lf-ref',o).value.trim(),subject:$('#lf-subj',o).value.trim(),date,dueDate:$('#lf-due',o).value||date,amount:amt,vat:parseAmt($('#lf-vat',o).value),notes:$('#lf-note',o).value.trim(),updatedAt:new Date().toISOString()};delete u.id;
    if(await save('docs',d.id,u,'Saved'))closeModal()};
  $('#lf-pay',o)&&($('#lf-pay',o).onclick=()=>paymentForm({clientId:d.clientId,invoiceId:d.id}));
  $('#lf-del',o)&&($('#lf-del',o).onclick=async()=>{if(!await confirmBox('Delete '+d.number+'?','Payments recorded against it stay on the client account.'))return;try{await Store.remove('docs',d.id);toast('Deleted')}catch(e){toast('Could not delete: '+(e.message||e.code),true)}});
}
function clientForm(c,after){
  const e=c||{};
  const o=modal(c?'Edit client':'New client',`<div class="grid g2">
   <label class="field" style="grid-column:1/-1"><span>Company / client name</span><input id="c-name" value="${h(e.name)}"></label>
   <label class="field"><span>Contact person</span><input id="c-contact" value="${h(e.contact)}"></label><label class="field"><span>Phone</span><input id="c-phone" value="${h(e.phone)}"></label>
   <label class="field"><span>Email</span><input id="c-email" value="${h(e.email)}"></label><label class="field"><span>${h(S.cfg.taxIdLabel)}</span><input id="c-taxId" value="${h(e.taxId)}"></label>
   <label class="field" style="grid-column:1/-1"><span>Address</span><textarea id="c-address">${h(e.address)}</textarea></label>
   <label class="field"><span>Credit days</span><input type="number" id="c-creditDays" value="${h(e.creditDays??S.cfg.dueDays)}"></label><span></span>
   <label class="field"><span>Old balance (before using this app)</span><input type="number" step="any" id="c-openingBalance" value="${h(e.openingBalance||'')}" placeholder="0.00"></label>
   <label class="field"><span>Old balance as of</span><input type="date" id="c-openingDate" value="${h(e.openingDate||today())}"></label>
   <div style="grid-column:1/-1;display:flex;flex-direction:column;gap:8px"><b>Saved locations</b><div class="muted" style="font-size:.8rem">Delivery notes and reports made at these places pick this client automatically.</div>
    <div id="c-places"></div><div class="scanrow"><input id="c-pname" placeholder="Place name, e.g. Head office"><button class="btn" id="c-here" type="button">Add my current location</button></div></div></div>`,
   `${c&&isAdmin()?'<button class="btn danger" id="c-del">Delete</button><span class="grow"></span>':''}<button class="btn" data-x>Cancel</button><button class="btn primary" id="c-save">Save client</button>`);
  let places=clone(e.places||[]);
  const drawPl=()=>{$('#c-places',o).innerHTML=places.length?places.map((pl,k)=>`<div class="kv"><span>${h(pl.name||'Place')} <span class="muted num" style="font-size:.78rem">${fmtGPS(pl)}</span></span><button class="btn ghost sm" type="button" data-plrm="${k}">Remove</button></div>`).join(''):'<span class="muted" style="font-size:.84rem">None yet.</span>';
    $$('[data-plrm]',o).forEach(b=>b.onclick=()=>{places.splice(+b.dataset.plrm,1);drawPl()})};drawPl();
  $('#c-here',o).onclick=async()=>{const b=$('#c-here',o);b.disabled=true;b.textContent='Getting location…';const g=await getGPS();b.disabled=false;b.textContent='Add my current location';
    if(!hasGPS(g)){toast(g&&g.error==='denied'?'Location is blocked. Allow location access and try again.':'Location not available.',true);return}
    places.push({name:$('#c-pname',o).value.trim()||'Site '+(places.length+1),lat:g.lat,lng:g.lng,radius:150,addedAt:new Date().toISOString()});$('#c-pname',o).value='';drawPl()};
  $('#c-save',o).onclick=async()=>{const d={...e,places};['name','contact','phone','email','taxId','address','openingDate'].forEach(k=>d[k]=$('#c-'+k,o).value.trim());d.creditDays=+$('#c-creditDays',o).value||0;d.openingBalance=+$('#c-openingBalance',o).value||0;
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
   return `<button class="li" data-p="${p.id}"><span class="ico p">PAY</span><span style="min-width:0"><div class="t">${h(c?c.name:'Unknown client')}</div><div class="s">${fdate(p.date)} · ${h(p.method||'')}${p.receiptNo?' · <span class="num">'+h(p.receiptNo)+'</span>':''}${p.ref?' · '+h(p.ref):''}${inv?' · '+h(inv.number):' · on account'}</div></span><span class="r num">${money(p.amount)}</span></button>`}).join(''):`<div class="empty"><b>No payments recorded</b>Record money received against an invoice or on account.</div>`}</div>`;
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
   <label class="field"><span>Method</span><select id="p-method">${['Bank transfer','Cash','Cheque','Card','PDC','Credit note','Adjustment','Previous payment','Other'].map(m=>`<option ${m===e.method?'selected':''}>${m}</option>`).join('')}</select></label>
   <label class="field"><span>Reference / cheque no.</span><input id="p-ref" value="${h(e.ref||'')}"></label>
   <label class="field"><span>Bank (cheque / transfer)</span><input id="p-bank" value="${h(e.bank||'')}"></label>
   <label class="field"><span>Cheque date</span><input type="date" id="p-chq" value="${h(e.chequeDate||'')}"></label>
   <label class="field" style="grid-column:1/-1"><span>Note (printed on receipt)</span><input id="p-note" value="${h(e.note||'')}"></label></div>`,
   `${e.id?'<button class="btn danger" id="p-del">Delete</button><button class="btn" id="p-rcpt">'+I.pdf+'Receipt</button><span class="grow"></span>':''}<button class="btn" data-x>Cancel</button><button class="btn primary" id="p-save">Save payment</button>`);
  $('#p-client',o).onchange=ev=>{e.clientId=ev.target.value;e.invoiceId='';$('#p-inv',o).innerHTML='<option value="">On account (not linked to one invoice)</option>'+invOpts(e.clientId)};
  $('#p-inv',o).onchange=ev=>{const op=ev.target.selectedOptions[0];if(op&&op.dataset.due&&!$('#p-amount',o).value)$('#p-amount',o).value=op.dataset.due};
  if(e.invoiceId&&!e.amount){const op=$('#p-inv',o).selectedOptions[0];if(op&&op.dataset.due)$('#p-amount',o).value=op.dataset.due}
  $('#p-rcpt',o)&&($('#p-rcpt',o).onclick=()=>downloadReceipt(S.payments.find(x=>x.id===e.id)||e));
  $('#p-save',o).onclick=async()=>{const base={...e};delete base.id;if(!e.id)base.createdAt=new Date().toISOString();const d={...base,bank:$('#p-bank',o).value.trim(),chequeDate:$('#p-chq',o).value,clientId:$('#p-client',o).value,invoiceId:$('#p-inv',o).value,amount:r2($('#p-amount',o).value),date:$('#p-date',o).value,method:$('#p-method',o).value,ref:$('#p-ref',o).value.trim(),note:$('#p-note',o).value.trim(),createdBy:e.createdBy||S.me.id,updatedAt:new Date().toISOString()};
    if(!d.clientId){toast('Choose the client.',true);return}if(!(d.amount>0)){toast('Enter an amount above zero.',true);return}
    const b=$('#p-save',o);b.disabled=true;const id=e.id||uid();
    if(!d.receiptNo&&!/credit|adjust|previous/i.test(d.method))d.receiptNo=await reserveNumber('receipt',d.date);
    if(await save('payments',id,d,e.id?'Payment saved':'Payment recorded')){closeModal();render();if(!e.id&&d.receiptNo)receiptPrompt({...d,id})}else b.disabled=false};
  $('#p-del',o)&&($('#p-del',o).onclick=async()=>{if(!await confirmBox('Delete payment?','This changes the client balance and invoice status.'))return;await Store.remove('payments',e.id);toast('Payment deleted');closeModal()});
}

function receiptPrompt(p){
  const o=modal('Payment recorded',`<div class="thanks"><div class="tick">✓</div><h2>${h(cur(p.amount))}</h2><p>Received from ${h((S.clients.find(c=>c.id===p.clientId)||{}).name||'')}<br>Receipt <b class="num">${h(p.receiptNo)}</b></p></div>`,
    `<button class="btn" data-x>Done</button><span class="grow"></span><button class="btn primary" id="rp-pdf">${I.pdf}Download receipt</button>`);
  $('#rp-pdf',o).onclick=()=>{closeModal();downloadReceipt(p)};
}
async function downloadReceipt(p){
  if(!p)return;
  if(!p.receiptNo){p={...p,receiptNo:await reserveNumber('receipt',p.date)};
    if(can('payments')&&p.id){const x={...p};delete x.id;await save('payments',p.id,x)}}
  const cl=S.clients.find(c=>c.id===p.clientId)||{};
  downloadPdf(renderReceipt(p),`Receipt ${p.receiptNo} ${cl.name||''}.pdf`.replace(/[\\/:*?"<>|]/g,'').trim());
}
function renderReceipt(p){
  const c=S.cfg,cl=S.clients.find(x=>x.id===p.clientId)||{},inv=S.docs.find(d=>d.id===p.invoiceId);
  const amt=r2(p.amount);
  // what was owed on the invoice before and after this payment
  let alloc='';
  if(inv){const tot=totals(inv).total;const before=r2(S.payments.filter(x=>x.invoiceId===inv.id&&x.id!==p.id&&(x.date<p.date||(x.date===p.date&&(x.createdAt||x.updatedAt||'')<(p.createdAt||p.updatedAt||'')))).reduce((s,x)=>s+(+x.amount||0),0));
    const bal=r2(tot-before-amt);
    alloc=`<table><thead><tr><th>Invoice</th><th style="width:100px">Invoice date</th><th class="r">Invoice total</th><th class="r">Paid before</th><th class="r">This payment</th><th class="r">Balance due</th></tr></thead>
     <tbody><tr><td><div class="it">${h(inv.number)}</div>${inv.ref?`<div class="idesc">${h(inv.ref)}</div>`:''}</td><td>${fdate(inv.date)}</td><td class="r m">${money(tot)}</td><td class="r m">${money(before)}</td><td class="r m b">${money(amt)}</td><td class="r m b">${money(Math.max(bal,0))}</td></tr></tbody></table>`}
  else alloc=`<table><thead><tr><th>Applied to</th><th class="r">Amount</th></tr></thead><tbody><tr><td><div class="it">Payment on account</div><div class="idesc">Not linked to a single invoice</div></td><td class="r m b">${money(amt)}</td></tr></tbody></table>`;
  // client balance straight after this payment (same-day payments counted in the order they were recorded)
  const stamp=x=>x.createdAt||x.updatedAt||'';
  const accBal=r2((+cl.openingBalance||0)+S.docs.filter(d=>d.type==='invoice'&&d.clientId===p.clientId&&d.date<=p.date).reduce((s2,d)=>s2+totals(d).total,0)
    -S.payments.filter(x=>x.clientId===p.clientId&&(x.id===p.id||x.date<p.date||(x.date===p.date&&stamp(x)<stamp(p)))).reduce((s2,x)=>s2+(+x.amount||0),0)-(S.payments.some(x=>x.id===p.id)?0:amt));
  const det=[['Receipt date',fdate(p.date)],['Payment method',p.method||'—']];
  if(p.ref)det.push([/cheque|pdc/i.test(p.method||'')?'Cheque no.':'Reference',p.ref]);
  if(p.bank)det.push(['Bank',p.bank]);
  if(p.chequeDate)det.push(['Cheque date',fdate(p.chequeDate)]);
  const by=nameOf(p.createdBy,'');if(by)det.push(['Received by',by]);
  const pdc=/pdc/i.test(p.method||'')||(p.chequeDate&&p.chequeDate>p.date);
  return `<div class="sheet receipt${docCls()}" data-client="${h(cl.name||'')}" data-site="${h(inv?'Against '+inv.number:'Payment on account')}" style="--b:${h(c.brand)};--c:${h(c.charcoal)}">${sheetHead('Receipt',p.receiptNo||'',isPrem()?'Thank you for your payment':'')}
  <div class="meta"><div class="box cbox">${isPrem()?`<span class="bico">${ico('building',c.brand)}</span>`:''}<div class="cbody"><div class="k">Received from</div><div class="cn">${h(cl.name||'—')}</div>
    <div class="ad" style="white-space:pre-line;color:#5d6168">${h([cl.address,cl.taxId?`${c.taxIdLabel}: ${cl.taxId}`:''].filter(Boolean).join('\n'))}</div></div></div>
    ${detHtml(det)}</div>
  <div class="rcamt"><div><div class="rk">Amount received</div><div class="rv"><small>${h(c.currency)}</small> ${money(amt)}</div><div class="rw">${h(numWords(amt))}</div></div>
    <div class="rst"><span class="stamp">${pdc?'CHEQUE RECEIVED':'PAID'}</span></div></div>
  ${alloc}
  <div class="foot"><div class="fl">${p.note?`<div class="note"><div class="hh">Note</div><div class="terms">${h(p.note)}</div></div>`:''}
    ${pdc?`<div class="terms">Payment by cheque is subject to realisation. This receipt is valid once the cheque is cleared.</div>`:''}</div>
    <div class="tot"><div class="tr"><span>This payment</span><span class="m">${money(amt)}</span></div>
      <div class="tr gr"><span>Account balance <small>${h(c.currency)}</small></span><span class="m">${money(accBal)}</span></div></div></div>
  <div class="sigs"><div class="sig"><div class="img">${c.stamp?img(c.stamp,'class="stampimg"'):''}${c.signature?img(c.signature,'class="sigimg"'):''}</div><div class="ln"><b>For ${h(c.name)}</b><br>${h(c.signName||'Authorised signatory')}</div></div>
    <div class="sig"><div class="img"></div><div class="ln"><b>Thank you for your payment</b><br>Please keep this receipt for your records.</div></div></div>
  ${sheetFoot()}</div>`;
}
/* ----- import lists (CSV from Excel / Google Sheets) ----- */
function parseCSV(t){
  t=String(t||'').replace(/^\uFEFF/,'');const delim=(t.split('\n')[0].match(/\t/g)||[]).length>(t.split('\n')[0].match(/,/g)||[]).length?'\t':',';
  const rows=[];let row=[],cell='',q=false;
  for(let i=0;i<t.length;i++){const ch=t[i];
    if(q){if(ch==='"'){if(t[i+1]==='"'){cell+='"';i++}else q=false}else cell+=ch}
    else if(ch==='"')q=true;else if(ch===delim){row.push(cell);cell=''}
    else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&t[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell=''}else cell+=ch}
  if(cell||row.length){row.push(cell);rows.push(row)}
  return rows.filter(r=>r.some(c=>String(c).trim()));
}
const IMPORT={
  clients:{title:'Import clients',cols:{name:/^(name|client|company|customer)/i,contact:/contact|attn/i,phone:/phone|mobile|tel/i,email:/mail/i,taxId:/trn|tax|vat/i,address:/address|location/i,creditDays:/credit|terms|days/i,lat:/^lat/i,lng:/^(lng|lon)/i,placeName:/place|site/i},
    hint:'Columns: name, contact, phone, email, TRN, address, credit days (optional: lat, lng, place name)',
    build:r=>{const d={name:r.name,contact:r.contact||'',phone:r.phone||'',email:r.email||'',taxId:r.taxId||'',address:(r.address||'').replace(/\s*\|\s*/g,'\n'),creditDays:parseInt(r.creditDays)||S.cfg.dueDays,openingBalance:0};
      const la=parseFloat(r.lat),ln=parseFloat(r.lng);if(!isNaN(la)&&!isNaN(ln))d.places=[{name:r.placeName||r.name,lat:la,lng:ln,radius:200,addedAt:new Date().toISOString()}];return d},
    exists:d=>S.clients.some(c=>String(c.name).trim().toLowerCase()===d.name.trim().toLowerCase()),col:'clients'},
  products:{title:'Import products',cols:{name:/^(name|item|product)/i,category:/categ|group|type/i,desc:/desc|spec|detail/i,unit:/unit|uom/i,price:/price|rate|amount/i,barcode:/barcode|sku|code|model/i},
    hint:'Columns: name, category, description, unit, price, barcode / SKU',
    build:r=>({name:r.name,category:r.category||'',desc:(r.desc||'').replace(/\s*\|\s*/g,'\n'),unit:r.unit||'pcs',price:parseAmt(r.price),barcode:r.barcode||'',photo:'',createdBy:S.me.id,createdAt:new Date().toISOString()}),
    exists:d=>S.products.some(p=>String(p.name).trim().toLowerCase()===d.name.trim().toLowerCase()),col:'products'}};
function importForm(kind){
  const K=IMPORT[kind];let items=[];
  const o=modal(K.title,`<div class="muted" style="font-size:.86rem">Choose a CSV file (Excel: <b>File → Save as → CSV</b>) or paste rows copied from Excel / Google Sheets. The first row must be the column headings. ${h(K.hint)}.</div>
    <div class="row"><button class="btn" id="im-file" type="button">${I.plus}Choose CSV file</button><span class="muted" id="im-name"></span></div>
    <textarea id="im-text" rows="6" placeholder="name,phone,email,address&#10;Example LLC,+971 4 000 0000,info@example.com,Office 1 | Business Bay | Dubai"></textarea>
    <div id="im-prev"></div>`,
    `<button class="btn" data-x>Cancel</button><button class="btn primary" id="im-go" disabled>Import</button>`,true);
  const preview=()=>{const rows=parseCSV($('#im-text',o).value);items=[];
    if(rows.length<2){$('#im-prev',o).innerHTML='';$('#im-go',o).disabled=true;return}
    const head=rows[0].map(x=>String(x).trim());const map={};
    Object.entries(K.cols).forEach(([k,re])=>{const i=head.findIndex(hd=>re.test(hd));if(i>=0&&!Object.values(map).includes(i))map[k]=i});
    if(map.name==null){$('#im-prev',o).innerHTML='<div class="notice">No "name" column found in the first row.</div>';$('#im-go',o).disabled=true;return}
    rows.slice(1).forEach(r=>{const x={};Object.entries(map).forEach(([k,i])=>x[k]=String(r[i]??'').trim());if(x.name){const d=K.build(x);items.push({d,dup:K.exists(d)})}});
    const nNew=items.filter(i=>!i.dup).length;
    $('#im-prev',o).innerHTML=`<div class="scroll-x"><table class="tbl"><thead><tr><th></th>${Object.keys(map).map(k=>`<th>${h(k)}</th>`).join('')}</tr></thead><tbody>${items.slice(0,60).map(i=>`<tr><td>${i.dup?'<span class="pill">already exists</span>':'<span class="pill good">new</span>'}</td>${Object.keys(map).map(k=>`<td>${h(String(i.d[k]??'')).slice(0,60)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="muted" style="font-size:.84rem">${nNew} new · ${items.length-nNew} already in the list (skipped)</div>`;
    $('#im-go',o).disabled=!nNew;$('#im-go',o).textContent=nNew?`Import ${nNew}`:'Import'};
  $('#im-text',o).oninput=preview;
  $('#im-file',o).onclick=async()=>{const [f]=await pickFiles({accept:'.csv,.tsv,.txt,text/csv',multiple:false});if(!f)return;$('#im-name',o).textContent=f.name;$('#im-text',o).value=await f.text();preview()};
  $('#im-go',o).onclick=async()=>{const todo=items.filter(i=>!i.dup);const b=$('#im-go',o);b.disabled=true;let n=0;
    for(const i of todo){b.textContent=`Importing ${n+1} of ${todo.length}…`;try{await Store.put(K.col,uid(),{...i.d,updatedAt:new Date().toISOString()});n++}catch(e){toast('Stopped: '+(e.message||e.code),true);break}}
    toast(n+' imported');closeModal()};
}
/* ----- products ----- */
VIEWS.products=()=>{
  const q=(S.params.q||'').toLowerCase(),cat=S.params.cat||'';
  const cats=[...new Set(S.products.map(p=>p.category||'Other'))].sort();
  const list=S.products.filter(p=>(!cat||(p.category||'Other')===cat)&&(!q||[p.name,p.desc,p.barcode,p.category].join(' ').toLowerCase().includes(q))).sort((a,b)=>String(a.category||'Other').localeCompare(String(b.category||'Other'))||a.name.localeCompare(b.name));
  return `<div class="head"><div><h1>Products</h1><div class="sub">${S.products.length} items · saved items fill in descriptions, prices and photos</div></div><div class="row"><button class="btn" id="imp">Import</button><button class="btn primary" id="npd">${I.plus}Add product</button></div></div>
  <div class="row"><input class="search" id="pq" placeholder="Search products, model or barcode" value="${h(S.params.q||'')}">${cats.length>1?`<select id="pcat" style="width:auto"><option value="">All categories</option>${cats.map(c=>`<option ${c===cat?'selected':''}>${h(c)}</option>`).join('')}</select>`:''}</div>
  <div class="card list">${list.length?list.map((p,k)=>`${(k===0||String(list[k-1].category||'Other')!==String(p.category||'Other'))?`<div class="pcat">${h(p.category||'Other')}</div>`:''}`+`<button class="li" data-pd="${p.id}">${p.photo?img(p.photo,'style="width:36px;height:36px;border-radius:8px;object-fit:cover"'):'<span class="ico q">ITEM</span>'}<span style="min-width:0"><div class="t">${h(p.name)}</div><div class="s">${h(p.desc||'')}${p.barcode?' · <span class="num">'+h(p.barcode)+'</span>':''}</div></span><span class="r num">${money(p.price)}<div class="muted" style="font-size:.75rem">per ${h(p.unit||'pcs')}</div></span></button>`).join(''):`<div class="empty"><b>No products saved</b>Add the items you sell most so quotations fill in by themselves.</div>`}</div>`;
};
VIEWS_AFTER.products=()=>{$('#npd').onclick=()=>productForm();$('#imp').onclick=()=>importForm('products');$('#pcat')&&($('#pcat').onchange=e=>{S.params.cat=e.target.value;render()});$$('[data-pd]').forEach(b=>b.onclick=()=>productForm(S.products.find(p=>p.id===b.dataset.pd)));
  const pq=$('#pq');pq.oninput=()=>{S.params.q=pq.value;clearTimeout(pq._t);pq._t=setTimeout(()=>{render();const n=$('#pq');n.focus();n.setSelectionRange(n.value.length,n.value.length)},250)}};
function productForm(p){
  const e={unit:'pcs',...(p||{})};
  const o=modal(p?'Edit product':'New product',`<div class="row" style="align-items:flex-start;flex-wrap:nowrap"><button class="photo" id="pd-ph" style="width:96px;height:96px;flex:none" type="button">${e.photo?img(e.photo):'+ Photo'}</button>
   <div class="grid grow"><label class="field"><span>Name</span><input id="pd-name" value="${h(e.name)}"></label><label class="field"><span>Description</span><textarea id="pd-desc">${h(e.desc)}</textarea></label></div></div>
   <div class="grid g3"><label class="field"><span>Price</span><input type="number" step="any" id="pd-price" value="${h(e.price||'')}"></label><label class="field"><span>Unit</span><input id="pd-unit" value="${h(e.unit)}"></label>
   <label class="field"><span>Category</span><input id="pd-category" list="pd-cats" value="${h(e.category||'')}" placeholder="e.g. CCTV Cameras"><datalist id="pd-cats">${[...new Set(S.products.map(p=>p.category).filter(Boolean))].map(c=>`<option value="${h(c)}">`).join('')}</datalist></label>
   <label class="field"><span>Barcode / SKU</span><div class="row" style="flex-wrap:nowrap"><input id="pd-barcode" value="${h(e.barcode||'')}"><button class="btn" id="pd-scan" aria-label="Scan barcode">${I.scan}</button></div></label></div>`,
   `${p?'<button class="btn danger" id="pd-del">Delete</button><span class="grow"></span>':''}<button class="btn" data-x>Cancel</button><button class="btn primary" id="pd-save">Save product</button>`);
  $('#pd-ph',o).onclick=async()=>{const f=await pickImage();if(!f)return;toast('Uploading photo…');e.photo=await storeImage(f,800);$('#pd-ph',o).innerHTML=img(e.photo)};
  $('#pd-scan',o).onclick=()=>openScanner(c=>{$('#pd-barcode',o).value=c},{title:'Scan product barcode'});
  $('#pd-save',o).onclick=async()=>{const d={...e,category:$('#pd-category',o).value.trim(),name:$('#pd-name',o).value.trim(),desc:$('#pd-desc',o).value.trim(),price:+$('#pd-price',o).value||0,unit:$('#pd-unit',o).value.trim(),barcode:$('#pd-barcode',o).value.trim()};
    if(!d.name){toast('Enter the product name.',true);return}if(await save('products',e.id||uid(),d,'Product saved'))closeModal()};
  $('#pd-del',o)&&($('#pd-del',o).onclick=async()=>{if(!await confirmBox('Delete product?',e.name+' will be removed from the list. Existing documents keep it.'))return;await Store.remove('products',e.id);closeModal()});
}

/* ----- accounts (admin only) — the SAME books as the attendance app (acctEntries) ----- */
// Categories and methods match LLCT Attendance exactly, so entries made in either app look the same.
const ACC_CAT={
  income:['Cheque deposit','Cash deposit','Bank transfer received','Client payment','Owner capital','Loan received','Refund received','Other income'],
  expense:['Purchase','Supplier payment','Salaries & wages','Labour supply','Rent','Utilities','Fuel','Vehicle & maintenance','Transport','Tools & equipment','Materials','Visa & PRO','Office expenses','Bank charges','Other expense']};
const ACC_METHODS=['Cash','Cheque','Bank transfer','Card','Online / app'];
const isBankM=m=>!!m&&m!=='Cash';
function accRange(){const p=S.params.per||'month',t=today();
  if(p==='month')return [t.slice(0,8)+'01',t];
  if(p==='last'){const d=new Date(t.slice(0,8)+'01T00:00:00');d.setMonth(d.getMonth()-1);const f=new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10);return [f,addDays(t.slice(0,8)+'01',-1)]}
  if(p==='year')return [t.slice(0,4)+'-01-01',t];
  if(p==='all')return ['2000-01-01','2999-12-31'];
  return [S.params.af||t.slice(0,8)+'01',S.params.at||t]}
// Manual entries + the automatic lines the attendance app adds: petty cash given to staff, and driver payments.
function accEntries(){
  const man=S.acct.map(e=>({...e,src:'manual',type:e.type==='income'?'income':'expense',amount:+e.amount||0,method:e.method||'Cash'}));
  const pet=S.petty.filter(x=>x.type==='credit'&&x.status!=='rejected').map(x=>({id:'petty_'+x.id,src:'petty',type:'expense',date:x.date||'',amount:+x.amount||0,category:'Petty cash given',
    method:'Cash',party:x.employeeName||'',note:[x.note,x.createdByName?'given by '+x.createdByName:''].filter(Boolean).join(' · '),siteId:x.siteId||'',siteName:x.siteName||''}));
  const drv=S.drv.map(x=>({id:'drv_'+x.id,src:'driver',type:'expense',date:x.date||'',amount:+x.amount||0,category:'Driver payment',method:x.method||'Cash',
    party:x.employeeName||'',note:[x.note,x.createdBy?'by '+x.createdBy:''].filter(Boolean).join(' · ')}));
  return man.concat(pet,drv).map(withProject);
}
// Entries saved with only a site (the attendance app's earlier "Site / project" box) take that site's project.
function projectOfSite(siteId){const si=siteId&&S.sites.find(x=>x.id===siteId);return si&&si.projectId?S.projects[si.projectId]||null:null}
function withProject(e){if(e.projectId)return e;const p=projectOfSite(e.siteId);return p?{...e,projectId:p.id,projectName:[p.code,p.name].filter(Boolean).join(' · ')}:e}
// Cash and bank balance at the end of a day: opening balance + everything from the opening date on.
function accBalance(upto){const o=S.acctOpen||{};const out={cash:0,bank:0,set:!!o.date};
  if(o.date&&o.date<=upto){out.cash=+o.cash||0;out.bank=+o.bank||0}const start=o.date||'2000-01-01';
  accEntries().forEach(e=>{if(e.date>=start&&e.date<=upto){out[isBankM(e.method)?'bank':'cash']+=e.type==='income'?e.amount:-e.amount}});
  out.cash=r2(out.cash);out.bank=r2(out.bank);return out}
const SRC_PILL={petty:'petty cash · attendance',driver:'driver payment · attendance'};
VIEWS.accounts=()=>{
  if(!isAdmin())return '<div class="empty"><b>Admins only</b></div>';
  const [from,to]=accRange(),tab=S.params.at2||'all',q=(S.params.q||'').toLowerCase(),cat=S.params.cat||'',mf=S.params.mf||'',pj=S.params.pj||'';
  const all=accEntries().filter(e=>e.date>=from&&e.date<=to&&(!mf||(mf==='bank')===isBankM(e.method))&&(!pj||e.projectId===pj));
  const sum=a=>r2(a.reduce((t,e)=>t+e.amount,0));
  const inc=sum(all.filter(e=>e.type==='income')),exp=sum(all.filter(e=>e.type==='expense'));
  const auto=sum(all.filter(e=>e.src!=='manual'));
  const bal=accBalance(to>today()?today():to);
  const coll=r2(S.payments.filter(p=>p.date>=from&&p.date<=to&&!/credit|adjust|previous/i.test(p.method||'')).reduce((t,p)=>t+(+p.amount||0),0));
  const list=all.filter(e=>(tab==='all'||e.type===tab)&&(!cat||e.category===cat)&&(!q||[e.category,e.party,e.note,e.reference,e.bank,e.siteName,e.projectName,e.method].join(' ').toLowerCase().includes(q)))
    .sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const byCat={};all.filter(e=>e.type==='expense').forEach(e=>byCat[e.category||'Other']=(byCat[e.category||'Other']||0)+e.amount);
  const cats=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);const maxC=cats.length?cats[0][1]:1;
  const allCats=[...new Set(all.map(e=>e.category).filter(Boolean))].sort();
  const outside=accEntries().filter(e=>(e.date<from||e.date>to)&&e.src==='manual').length;
  let lastDate='';
  return `<div class="head"><div><h1>Accounts</h1><div class="sub">Same accounts as the attendance app · ${fdate(from)} – ${fdate(to)}</div></div>
   <div class="row"><button class="btn" id="ac-csv">${I.pdf}Export</button><button class="btn" id="ac-in">${I.plus}Income</button><button class="btn primary" id="ac-ex">${I.plus}Expense</button></div></div>
  <div class="row"><div class="seg">${[['month','This month'],['last','Last month'],['year','This year'],['all','All'],['custom','Custom']].map(([k,l])=>`<button class="${(S.params.per||'month')===k?'on':''}" data-per="${k}">${l}</button>`).join('')}</div>
   ${(S.params.per)==='custom'?`<input type="date" id="ac-f" value="${from}" style="width:auto"><input type="date" id="ac-t" value="${to}" style="width:auto">`:''}
   <div class="seg">${[['','Cash & bank'],['cash','Cash'],['bank','Bank / cheque']].map(([k,l])=>`<button class="${mf===k?'on':''}" data-mf="${k}">${l}</button>`).join('')}</div>
   ${projList().length?`<select id="ac-pj" style="width:auto;max-width:220px"><option value="">All projects</option>${projList().map(x=>`<option value="${h(x.id)}" ${x.id===pj?'selected':''}>${h(projLabel(x))}</option>`).join('')}</select>`:''}</div>
  <div class="kpis"><div class="card kpi"><span class="label">Income</span><span class="v" style="color:var(--good)">${money(inc)}</span><span class="muted" style="font-size:.76rem">Customer payments in invoicing: ${money(coll)}</span></div>
   <div class="card kpi"><span class="label">Expenses</span><span class="v" style="color:var(--bad)">${money(exp)}</span><span class="muted" style="font-size:.76rem">incl. petty cash &amp; drivers ${money(auto)}</span></div>
   <div class="card kpi"><span class="label">Net for period</span><span class="v" style="color:${inc-exp<0?'var(--bad)':'inherit'}">${money(inc-exp)}</span></div>
   <button class="card kpi hl" id="ac-open" style="text-align:left;cursor:pointer;font:inherit;border:0"><span class="label">Balance ${fdate(to>today()?today():to)}</span>
     ${bal.set?`<span class="v" style="font-size:1.05rem">Cash ${money(bal.cash)}</span><span class="v" style="font-size:1.05rem">Bank ${money(bal.bank)}</span>`:`<span style="font-size:.85rem;opacity:.85">Set the opening balance to see cash in hand and bank balance →</span>`}</button></div>
  ${cats.length?`<div class="card pad"><h3 style="margin-bottom:10px">Where the money went</h3><div class="acbars">${cats.slice(0,8).map(([k,v])=>`<button class="acbar" data-cat="${h(k)}"><span class="t">${h(k)}</span><span class="b"><i style="width:${Math.max(2,v/maxC*100)}%"></i></span><span class="num">${money(v)}</span></button>`).join('')}</div></div>`:''}
  <div class="row"><div class="seg">${[['all','All'],['income','Income'],['expense','Expenses']].map(([k,l])=>`<button class="${tab===k?'on':''}" data-at2="${k}">${l}</button>`).join('')}</div>
   <select id="ac-cat" style="width:auto"><option value="">All categories</option>${allCats.map(c=>`<option ${c===cat?'selected':''}>${h(c)}</option>`).join('')}</select>
   <span class="grow"></span><input class="search" id="ac-q" placeholder="Search party, note, reference" value="${h(S.params.q||'')}"></div>
  ${outside&&S.params.per!=='all'?`<div class="notice">${outside} more ${outside===1?'entry is':'entries are'} dated outside ${fdate(from)} – ${fdate(to)}. <button class="btn sm" data-per="all">Show all dates</button></div>`:''}
  <div class="card list">${list.length?list.map(e=>{const hd=e.date!==lastDate?`<div class="pcat">${fdate(e.date)}</div>`:'';lastDate=e.date;
    return hd+`<button class="li" data-ac="${h(e.id)}"><span class="ico ${e.type==='income'?'d':'p'}" style="${e.type==='expense'?'background:var(--bad-soft);color:var(--bad)':''}">${e.type==='income'?'IN':'OUT'}</span>
      <span style="min-width:0"><div class="t">${h(e.category||'—')}${e.party?' · '+h(e.party):''}</div><div class="s">${e.projectName?`<b>${h(e.projectName)}</b> · `:''}${h([e.method,e.bank,e.reference,e.siteName,e.note].filter(Boolean).join(' · '))}${SRC_PILL[e.src]?` · <span class="pill">${SRC_PILL[e.src]}</span>`:''}${e.hasFile?' · 📎':''}</div></span>
      <span class="r num" style="color:${e.type==='income'?'var(--good)':'var(--bad)'}">${e.type==='income'?'+':'−'}${money(e.amount)}</span></button>`}).join('')
    :`<div class="empty"><b>No entries for this period</b>Add income such as cheque or cash deposits, and expenses such as supplier payments and salaries. Petty cash and driver payments from the attendance app appear here by themselves.</div>`}</div>`;
};
VIEWS_AFTER.accounts=()=>{
  if(!isAdmin())return;
  const set=(k,v)=>{S.params[k]=v;render()};
  $$('[data-per]').forEach(b=>b.onclick=()=>set('per',b.dataset.per));
  $$('[data-mf]').forEach(b=>b.onclick=()=>set('mf',b.dataset.mf));
  $$('[data-at2]').forEach(b=>b.onclick=()=>set('at2',b.dataset.at2));
  $$('[data-cat]').forEach(b=>b.onclick=()=>{S.params.at2='expense';set('cat',b.dataset.cat)});
  $('#ac-f')&&($('#ac-f').onchange=e=>set('af',e.target.value));$('#ac-t')&&($('#ac-t').onchange=e=>set('at',e.target.value));
  $('#ac-cat').onchange=e=>set('cat',e.target.value);$('#ac-pj')&&($('#ac-pj').onchange=e=>set('pj',e.target.value));
  const q=$('#ac-q');q.oninput=()=>{S.params.q=q.value;clearTimeout(q._t);q._t=setTimeout(()=>{render();const n=$('#ac-q');n.focus();n.setSelectionRange(n.value.length,n.value.length)},250)};
  $('#ac-in').onclick=()=>accForm({type:'income'});$('#ac-ex').onclick=()=>accForm({type:'expense'});$('#ac-open').onclick=openingForm;
  $$('[data-ac]').forEach(b=>b.onclick=()=>{const id=b.dataset.ac;
    if(id.startsWith('petty_')){toast('Petty cash given to staff comes from the attendance app (Petty cash). Change it there.');return}
    if(id.startsWith('drv_')){toast('Driver payments come from the attendance app (Trips). Change them there.');return}
    accForm(S.acct.find(e=>e.id===id))});
  $('#ac-csv').onclick=()=>{const [f,t]=accRange();const rows=accEntries().filter(e=>e.date>=f&&e.date<=t).sort((a,b)=>a.date.localeCompare(b.date));
    const esc=v=>{v=String(v??'');return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
    const csv=[['Date','Type','Category','Method','Paid to / Received from','Reference','Bank','Cheque date','Project','Site','Amount','Note','Source']].concat(rows.map(e=>[e.date,e.type,e.category,e.method,e.party,e.reference||'',e.bank||'',e.chequeDate||'',e.projectName||'',e.siteName||'',(e.type==='expense'?-1:1)*e.amount,e.note||'',{manual:'Accounts',petty:'Petty cash',driver:'Driver payment'}[e.src]])).map(r=>r.map(esc).join(',')).join('\n');
    saveFile(new TextEncoder().encode('﻿'+csv),`Accounts ${f} to ${t}.csv`,'text/csv','Save accounts').catch(()=>{})};
};
async function readAcctFile(id){const s2=await getDoc(doc(fdb,COL.acctFiles,id));return s2.exists()?s2.data():null}
async function showAcctFile(e){try{toast('Opening…');const f=await readAcctFile(e.id);if(!f||!f.base64){toast('Receipt copy not found.',true);return}
  if(/pdf/i.test(f.mime||'')){await saveFile(dataToBytes('data:application/pdf;base64,'+f.base64),f.name||'receipt.pdf','application/pdf','Open receipt');return}
  modal(h(f.name||'Receipt'),`<img src="data:${h(f.mime||'image/jpeg')};base64,${f.base64}" alt="" style="max-width:100%;border-radius:8px">`,'<button class="btn" data-x>Close</button>')}
  catch(x){toast('Could not open: '+(x.message||x.code),true)}}
const projList=()=>Object.values(S.projects||{}).filter(x=>x&&x.name).sort((a,b)=>((a.status||'active')!=='active')-((b.status||'active')!=='active')||String(a.name).localeCompare(String(b.name)));
const projLabel=x=>[x.code,x.name].filter(Boolean).join(' · ')+((x.status&&x.status!=='active')?' ('+x.status+')':'');
// Saved names: suppliers / payees for expenses, payers for income. Shared with the attendance app.
const PARTY_KEY=t=>t==='income'?'receivedFrom':'paidTo';
function savedParties(type){const saved=(S.acctParties&&S.acctParties[PARTY_KEY(type)])||[];
  const used=S.acct.filter(x=>x.type===type).map(x=>x.party);const extra=type==='income'?S.clients.map(c=>c.name):[];
  const seen=new Map();saved.concat(used,extra).forEach(n=>{n=String(n||'').trim();if(n&&!seen.has(n.toLowerCase()))seen.set(n.toLowerCase(),n)});
  return [...seen.values()].sort((a,b)=>a.localeCompare(b))}
function accForm(pre={}){
  const e={date:today(),...pre};const isInc=e.type==='income';e.method=e.method||(isInc?'Cheque':'Cash');
  if(!e.projectId){const sp=projectOfSite(e.siteId);if(sp)e.projectId=sp.id}
  let file=null;
  const o=modal((e.id?'Edit ':'Add ')+(isInc?'income':'expense'),`<div class="grid g2">
    <label class="field"><span>Date</span><input type="date" id="af-date" value="${h(e.date)}"></label>
    <label class="field"><span>Amount (${h(S.cfg.currency)})</span><input id="af-amt" inputmode="decimal" value="${h(e.amount||'')}" style="font-weight:700;color:${isInc?'var(--good)':'var(--bad)'}"></label>
    <label class="field"><span>Category</span><input id="af-cat" list="af-cats" value="${h(e.category||ACC_CAT[e.type][0])}"><datalist id="af-cats">${ACC_CAT[e.type].map(c=>`<option value="${h(c)}">`).join('')}</datalist></label>
    <label class="field"><span>${isInc?'Received from (client / bank / owner)':'Paid to (supplier / party)'}</span><input id="af-party" value="${h(e.party||'')}" autocomplete="off" placeholder="${isInc?'Type or pick':'Type a supplier or pick a saved one'}"></label>
    <div class="psug" id="af-sug" style="grid-column:1/-1"></div>
    <label class="field"><span>Method</span><select id="af-meth">${ACC_METHODS.map(m=>`<option ${m===e.method?'selected':''}>${m}</option>`).join('')}</select></label>
    <label class="field"><span id="af-ref-l">Reference</span><input id="af-ref" value="${h(e.reference||'')}"></label>
    <label class="field af-chq"><span>Bank</span><input id="af-bank" value="${h(e.bank||'')}" placeholder="e.g. RAK Bank"></label>
    <label class="field af-chq"><span>Cheque date</span><input type="date" id="af-cdate" value="${h(e.chequeDate||'')}"></label>
    <label class="field"><span>Project (optional)</span><select id="af-proj"><option value="">—</option>${projList().map(x=>`<option value="${h(x.id)}" ${x.id===e.projectId?'selected':''}>${h(projLabel(x))}</option>`).join('')}</select></label>
    <label class="field"><span>Site (optional)</span><select id="af-site"><option value="">—</option>${S.sites.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name))).map(x=>`<option value="${h(x.id)}" ${x.id===e.siteId?'selected':''}>${h(x.name)}</option>`).join('')}</select></label>
    <div class="field"><span>Receipt / invoice / cheque copy</span><div class="row"><button class="btn sm" id="af-rc" type="button">${I.plus}${e.hasFile?'Replace':'Attach'}</button>
      ${e.hasFile?`<button class="btn sm" id="af-view" type="button">View</button><button class="btn sm ghost" id="af-rm" type="button" style="color:var(--bad)">Remove</button>`:''}<span id="af-rcv" class="muted" style="font-size:.8rem"></span></div></div>
    <label class="field" style="grid-column:1/-1"><span>Note</span><input id="af-note" value="${h(e.note||'')}" placeholder="${isInc?'e.g. Project ABC — 2nd payment':'e.g. Cement 50 bags, invoice 1234'}"></label></div>`,
    `${e.id?'<button class="btn danger" id="af-del">Delete</button>':''}<span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="af-save">${e.id?'Save':'Add '+(isInc?'income':'expense')}</button>`);
  const sync=()=>{const m=$('#af-meth',o).value,chq=m==='Cheque';$$('.af-chq',o).forEach(x=>x.hidden=!chq);$('#af-ref-l',o).textContent=chq?'Cheque no.':m==='Cash'?'Receipt / voucher no.':'Transaction ref.'};
  $('#af-meth',o).onchange=sync;sync();
  const sug=()=>{const t=$('#af-party',o).value.trim().toLowerCase();const saved=new Set(((S.acctParties||{})[PARTY_KEY(e.type)]||[]).map(x=>String(x).toLowerCase()));
    const list=savedParties(e.type).filter(n=>!t||n.toLowerCase().includes(t)).filter(n=>n.toLowerCase()!==t).slice(0,14);
    $('#af-sug',o).innerHTML=list.map(n=>`<span class="pchip"><button type="button" data-pick="${h(n)}">${h(n)}</button>${saved.has(n.toLowerCase())?`<button type="button" class="x" data-unsave="${h(n)}" aria-label="Remove ${h(n)} from saved list">×</button>`:''}</span>`).join('')
      +(list.length?'':`<span class="muted" style="font-size:.78rem">${t?'New name — it will be saved for next time.':'Names you enter are saved here for next time.'}</span>`);
    $$('[data-pick]',o).forEach(b=>b.onclick=()=>{$('#af-party',o).value=b.dataset.pick;sug()});
    $$('[data-unsave]',o).forEach(b=>b.onclick=async()=>{const n=b.dataset.unsave;try{await setDoc(doc(fdb,COL.acctSettings,'parties'),{[PARTY_KEY(e.type)]:arrayRemove(n)},{merge:true});
      S.acctParties={...S.acctParties,[PARTY_KEY(e.type)]:((S.acctParties||{})[PARTY_KEY(e.type)]||[]).filter(x=>x!==n)};sug()}catch(x){toast('Could not remove: '+(x.message||x.code),true)}})};
  $('#af-party',o).oninput=sug;sug();
  $('#af-site',o).onchange=()=>{const sp=projectOfSite($('#af-site',o).value);if(sp&&!$('#af-proj',o).value)$('#af-proj',o).value=sp.id};
  $('#af-proj',o).onchange=()=>{const pr=S.projects[$('#af-proj',o).value];const ss=$('#af-site',o);if(pr&&Array.isArray(pr.siteIds)&&pr.siteIds.length===1&&!ss.value)ss.value=pr.siteIds[0]};
  $('#af-rc',o).onclick=async()=>{const [f]=await pickFiles({multiple:false,accept:'image/*,application/pdf'});if(!f)return;
    try{if(/pdf/i.test(f.type)){const d=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f)});if(d.length*.75>700*1024)throw new Error('PDF is larger than 700 KB');file={name:f.name,mime:'application/pdf',base64:d.split(',')[1]}}
      else{let d=await compress(f,1600,.82);if(d.length*.75>700*1024)d=await compress(f,1200,.7);if(d.length*.75>700*1024)d=await compress(f,900,.6);file={name:f.name.replace(/\.[^.]+$/,'')+'.jpg',mime:'image/jpeg',base64:d.split(',')[1]}}
      $('#af-rcv',o).textContent='✓ '+file.name}catch(x){file=null;toast(x.message||'Could not read the file',true)}};
  $('#af-view',o)&&($('#af-view',o).onclick=()=>showAcctFile(e));
  $('#af-rm',o)&&($('#af-rm',o).onclick=async()=>{try{const b=writeBatch(fdb);b.update(doc(fdb,COL.acct,e.id),{hasFile:false,fileName:'',fileMime:''});b.delete(doc(fdb,COL.acctFiles,e.id));await b.commit();e.hasFile=false;$('#af-rm',o).remove();$('#af-view',o)&&$('#af-view',o).remove();$('#af-rcv',o).textContent='Removed'}catch(x){toast('Could not remove: '+(x.message||x.code),true)}});
  $('#af-save',o).onclick=async()=>{const date=$('#af-date',o).value,amount=r2(parseAmt($('#af-amt',o).value)),category=$('#af-cat',o).value.trim(),method=$('#af-meth',o).value,chq=method==='Cheque';
    if(!date||!(amount>0)||!category){toast('Date, amount and category are required.',true);return}
    const siteId=$('#af-site',o).value,site=S.sites.find(x=>x.id===siteId),projectId=$('#af-proj',o).value,proj=S.projects[projectId];const party=$('#af-party',o).value.trim();
    const body={type:e.type,date,amount,category,party,method,reference:$('#af-ref',o).value.trim(),bank:chq?$('#af-bank',o).value.trim():'',chequeDate:chq?$('#af-cdate',o).value:'',
      siteId,siteName:site?site.name||'':'',projectId,projectName:proj?[proj.code,proj.name].filter(Boolean).join(' · '):'',note:$('#af-note',o).value.trim(),month:date.slice(0,7),
      ...(file?{hasFile:true,fileName:file.name,fileMime:file.mime}:{}),
      ...(e.id?{editedBy:S.me.name||'',editedAt:serverTimestamp()}:{createdBy:S.me.name||'',createdById:S.me.id,createdAt:serverTimestamp()})};
    const ref=e.id?doc(fdb,COL.acct,e.id):doc(collection(fdb,COL.acct));const btn=$('#af-save',o);btn.disabled=true;
    try{const b=writeBatch(fdb);b.set(ref,body,{merge:true});if(file)b.set(doc(fdb,COL.acctFiles,ref.id),file);
      if(party)b.set(doc(fdb,COL.acctSettings,'parties'),{[PARTY_KEY(e.type)]:arrayUnion(party)},{merge:true});await b.commit();toast(e.id?'Saved':(isInc?'Income':'Expense')+' added');closeModal()}
    catch(x){btn.disabled=false;toast(/permission/i.test(x.code||x.message||'')?'Not allowed — publish the latest Firestore rules.':'Save failed: '+(x.message||x.code),true)}};
  $('#af-del',o)&&($('#af-del',o).onclick=async()=>{if(!await confirmBox('Delete this entry?',(isInc?'Income':'Expense')+' of '+cur(e.amount)+' will be removed from the accounts in both apps.'))return;
    try{const b=writeBatch(fdb);b.delete(doc(fdb,COL.acct,e.id));if(e.hasFile)b.delete(doc(fdb,COL.acctFiles,e.id));await b.commit();toast('Deleted');closeModal()}catch(x){toast('Could not delete: '+(x.message||x.code),true)}});
}
// Entries saved by the earlier invoicing Accounts (inv_ledger, e.g. from an older app install) are moved
// into the shared accounts (acctEntries) with the same id, so nothing is counted twice.
const OLD_CAT={'Purchase / supplier payment':'Supplier payment','Utilities (DEWA)':'Utilities','Fuel & transport':'Fuel','Vehicle':'Vehicle & maintenance','Visa & government fees':'Visa & PRO','Customer payment':'Client payment','Owner / capital':'Owner capital'};
let moving=false;
async function moveOldLedger(rows){if(moving||!isAdmin())return;moving=true;let n=0;
  try{for(const e of rows){
    const user=S.users[e.createdBy];const note=[e.note,e.givenBy?'given by '+e.givenBy:'',+e.vat?'VAT '+money(e.vat):''].filter(Boolean).join(' · ');
    const body={type:e.type==='income'?'income':'expense',date:e.date||today(),amount:r2(+e.amount||0),category:OLD_CAT[e.category]||e.category||'Other expense',party:e.party||'',
      method:e.method||'Cash',reference:e.ref||'',bank:e.account&&e.account!=='Cash'?e.account:'',chequeDate:'',siteId:'',siteName:'',note,month:(e.date||today()).slice(0,7),
      createdBy:(user&&user.name)||S.me.name||'',createdById:e.createdBy||S.me.id,createdAt:serverTimestamp(),movedFrom:'invoicing'};
    let file=null;
    if(e.receipt&&String(e.receipt).startsWith('img:')){try{const im=await Store.get('images',e.receipt.slice(4));if(im&&im.data){file={base64:String(im.data).split(',')[1],mime:'image/jpeg',name:'receipt.jpg'};Object.assign(body,{hasFile:true,fileName:'receipt.jpg',fileMime:'image/jpeg'})}}catch(x){}}
    const b=writeBatch(fdb);b.set(doc(fdb,COL.acct,e.id),body,{merge:true});if(file)b.set(doc(fdb,COL.acctFiles,e.id),file);b.delete(doc(fdb,COL.ledger,e.id));await b.commit();n++}
    if(n)toast(`${n} earlier account ${n===1?'entry':'entries'} moved into the shared accounts`)}
  catch(x){console.warn('move ledger',x)}finally{moving=false}}
function openingForm(){const op=S.acctOpen||{};
  const o=modal('Opening balance',`<p class="muted" style="margin:0 0 10px">Cash in hand and bank balance on the day you start keeping accounts. Shared with the attendance app.</p><div class="grid g2">
    <label class="field" style="grid-column:1/-1"><span>As at date</span><input type="date" id="ob-d" value="${h(op.date||today().slice(0,8)+'01')}"></label>
    <label class="field"><span>Cash in hand (${h(S.cfg.currency)})</span><input id="ob-c" inputmode="decimal" value="${h(op.cash??'')}"></label>
    <label class="field"><span>Bank balance (${h(S.cfg.currency)})</span><input id="ob-b" inputmode="decimal" value="${h(op.bank??'')}"></label>
    <label class="field" style="grid-column:1/-1"><span>Note</span><input id="ob-n" value="${h(op.note||'')}"></label></div>`,
    `<span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="ob-s">Save</button>`);
  $('#ob-s',o).onclick=async()=>{const d=$('#ob-d',o).value;if(!d){toast('Choose the date.',true);return}
    try{await setDoc(doc(fdb,COL.acctSettings,'opening'),{date:d,cash:r2(parseAmt($('#ob-c',o).value)),bank:r2(parseAmt($('#ob-b',o).value)),note:$('#ob-n',o).value.trim(),updatedBy:S.me.name||'',updatedAt:serverTimestamp()});toast('Opening balance saved');closeModal()}
    catch(x){toast('Could not save: '+(x.message||x.code),true)}};
}

/* ----- staff & access (admin) ----- */
const LG_EV={login:['Signed in','good'],open:['Opened app','brand'],logout:['Signed out',''],denied:['Refused','bad']};
const ftime=iso=>iso?new Date(iso).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'';
function lastSeen(id){const l=S.logins.filter(x=>x.uid===id&&x.event!=='logout'&&x.event!=='denied').sort((a,b)=>b.at.localeCompare(a.at))[0];return l?'last in '+fdate(l.date)+' '+ftime(l.at):''}
VIEWS.logins=()=>{
  if(!isAdmin())return '<div class="empty"><b>Admins only</b></div>';
  const per=S.params.lp||'7',who=S.params.lu||'',ev=S.params.le||'';
  const from=per==='today'?today():addDays(today(),-(+per-1));
  const all=S.logins.filter(x=>x.date>=from);
  const list=all.filter(x=>(!who||x.uid===who)&&(!ev||x.event===ev)).sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  const people=[...new Map(S.logins.map(x=>[x.uid,x.name])).entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1])));
  const ins=all.filter(x=>x.event==='login'||x.event==='open');
  const last={};S.logins.filter(x=>x.event==='login'||x.event==='open').forEach(x=>{if(!last[x.uid]||x.at>last[x.uid].at)last[x.uid]=x});
  const lastL=Object.values(last).sort((a,b)=>b.at.localeCompare(a.at));
  const dev=x=>[x.app,x.model,x.os,x.browser].filter(Boolean).join(' · ');
  let lastDate='';
  return `<div class="head"><div><h1>Login log</h1><div class="sub">Who signed in to invoicing, when and from which device</div></div>
   <div class="row"><button class="btn" id="lg-csv">${I.pdf}Export</button></div></div>
  <div class="row"><div class="seg">${[['today','Today'],['7','7 days'],['30','30 days'],['120','120 days']].map(([k,l])=>`<button class="${per===k?'on':''}" data-lp="${k}">${l}</button>`).join('')}</div>
   <select id="lg-u" style="width:auto"><option value="">Everyone</option>${people.map(([id,n])=>`<option value="${h(id)}" ${id===who?'selected':''}>${h(n||id)}</option>`).join('')}</select>
   <select id="lg-e" style="width:auto"><option value="">All events</option>${Object.entries(LG_EV).map(([k,[l]])=>`<option value="${k}" ${k===ev?'selected':''}>${l}</option>`).join('')}</select></div>
  <div class="kpis"><div class="card kpi"><span class="label">Sign-ins &amp; opens</span><span class="v">${ins.length}</span></div>
   <div class="card kpi"><span class="label">People</span><span class="v">${new Set(ins.map(x=>x.uid)).size}</span></div>
   <div class="card kpi"><span class="label">Devices</span><span class="v">${new Set(ins.map(x=>x.device).filter(Boolean)).size}</span></div>
   <div class="card kpi"><span class="label">Refused</span><span class="v" style="${all.some(x=>x.event==='denied')?'color:var(--bad)':''}">${all.filter(x=>x.event==='denied').length}</span><span class="muted" style="font-size:.76rem">signed in without access</span></div></div>
  ${lastL.length?`<div class="card pad"><h3 style="margin-bottom:8px">Last seen</h3><div class="lgseen">${lastL.map(x=>`<button data-lu="${h(x.uid)}"><b>${h(x.name||'—')}</b><span>${fdate(x.date)} · ${ftime(x.at)}</span><span class="muted">${h(dev(x))}</span></button>`).join('')}</div></div>`:''}
  <div class="card list">${list.length?list.map(x=>{const hd=x.date!==lastDate?`<div class="pcat">${fdate(x.date)}</div>`:'';lastDate=x.date;const [l,c]=LG_EV[x.event]||[x.event,''];
    return hd+`<div class="li" style="cursor:default"><span class="ico q num" style="font-size:.72rem">${ftime(x.at)}</span>
      <span style="min-width:0"><div class="t">${h(x.name||'—')} <span class="pill ${c}">${h(l)}</span></div>
      <div class="s" style="white-space:normal">${h([dev(x),x.screen,x.reason].filter(Boolean).join(' · '))}${hasGPS(x.gps)?` · <a href="https://maps.google.com/?q=${x.gps.lat},${x.gps.lng}" target="_blank" rel="noopener">📍 ${fmtGPS(x.gps)}</a>`:''}</div></span><span></span></div>`}).join('')
    :`<div class="empty"><b>No sign-ins in this period</b>Each sign-in, app open and sign-out is recorded here from now on.</div>`}</div>
  <div class="muted" style="font-size:.78rem">Kept for 120 days on screen. Location is added only when that phone or browser has already allowed location for this app. Wrong-password attempts are not recorded, because nothing can be saved before a login succeeds.</div>`;
};
VIEWS_AFTER.logins=()=>{
  $$('[data-lp]').forEach(b=>b.onclick=()=>{S.params.lp=b.dataset.lp;render()});
  $$('[data-lu]').forEach(b=>b.onclick=()=>{S.params.lu=b.dataset.lu;render()});
  $('#lg-u')&&($('#lg-u').onchange=e=>{S.params.lu=e.target.value;render()});
  $('#lg-e')&&($('#lg-e').onchange=e=>{S.params.le=e.target.value;render()});
  $('#lg-csv')&&($('#lg-csv').onclick=()=>{const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
    const rows=[['Date','Time','Name','Event','App','Device model','OS','Browser','Screen','GPS','Reason','Device ID']].concat(S.logins.slice().sort((a,b)=>String(b.at).localeCompare(String(a.at))).map(x=>[x.date,ftime(x.at),x.name,(LG_EV[x.event]||[x.event])[0],x.app,x.model,x.os,x.browser,x.screen,hasGPS(x.gps)?fmtGPS(x.gps):'',x.reason,x.device]));
    saveFile(new TextEncoder().encode('\uFEFF'+rows.map(r=>r.map(q).join(',')).join('\r\n')),'LLCT login log '+today()+'.csv','text/csv','Save login log').catch(()=>{})});
};
VIEWS.staff=()=>{
  if(!isAdmin())return '<div class="empty"><b>Admins only</b></div>';
  const people=Object.values(S.users).filter(u=>u.id!==S.me.id&&u.active!==false).sort((a,b)=>(a.role==='admin')-(b.role==='admin')||String(a.name).localeCompare(String(b.name)));
  return `<div class="head"><div><h1>Staff & access</h1><div class="sub">Same logins as the attendance app</div></div></div>
  <div class="notice">Staff sign in with their attendance login ID and password. Add or remove logins in the attendance dashboard; here you decide what each person can do in invoicing. Attendance admins always have full access.</div>
  <div class="card">${people.length?people.map(u=>{const a=S.access[u.id]||{};const p=a.perms||{};const on=a.enabled!==false&&!!S.access[u.id];
   if(u.role==='admin')return `<div class="pad row" style="border-top:1px solid var(--line)"><b class="grow">${h(u.name)}</b><span class="pill brand">Admin · full access</span></div>`;
   return `<div class="pad" style="border-top:1px solid var(--line);display:flex;flex-direction:column;gap:10px" data-u="${u.id}">
    <div class="row"><div class="grow" style="min-width:0"><b>${h(u.name||'Unnamed')}</b><div class="muted" style="font-size:.8rem">${h([u.designation,u.loginId,lastSeen(u.id)].filter(Boolean).join(' · '))}</div></div>
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
  const sample=window.__sample={id:'_sample',type:'quotation',number:nextNumber('quotation',today()),date:today(),validUntil:addDays(today(),c.validDays),client:{name:'Example Client LLC',contact:'Attn: Purchasing',address:'Office 12, Example Tower',phone:'+000 000 0000'},
    ref:'RFQ-0001',subject:'Example quotation (preview only)',items:[{name:'Example item A',desc:'Shown to preview the layout',qty:2,unit:'pcs',price:450},{name:'Example service',desc:'Installation and testing',qty:1,unit:'lot',price:300}],discount:0,taxRate:c.taxRate,terms:c.terms.quotation};
  return `<div class="head"><div><h1>Company & template</h1><div class="sub">Shown on every quotation, invoice, delivery note and statement</div></div><button class="btn primary" id="s-save">Save settings</button></div>
  <div class="view-grid"><div style="display:flex;flex-direction:column;gap:16px;min-width:0">
  <div class="card pad grid"><h2>Company</h2>
   <div class="row" style="align-items:flex-start"><div class="field"><span style="font-size:.75rem;font-weight:600;color:var(--muted)">Logo</span><button class="logo-box" id="s-logo" type="button">${c.logo?img(c.logo):'Upload logo'}</button>${c.logo?'<button class="btn ghost sm" id="s-logo-x">Remove</button>':''}</div>
    <div class="grid grow g2" style="min-width:220px">${f('name','Company name')}${f('website','Website')}${f('phone','Phone')}${f('email','Email')}${f('taxIdLabel','Tax ID label')}${f('taxId','Tax ID number')}${f('tagline','Tagline (Premium style)',c.tagline,'text',true)}
     <label class="field" style="grid-column:1/-1"><span>Company GPS (shown in the header)</span><div class="row" style="flex-wrap:nowrap"><input id="s-gps" value="${h(c.gps||'')}" placeholder="25.2xxxxx, 55.3xxxxx"><button class="btn" id="s-gps-here" type="button">Use my location</button></div></label></div></div>
   <label class="field"><span>Address</span><textarea id="s-address">${h(c.address)}</textarea></label>
   <label class="field"><span>Bank details (printed on quotations, invoices, statements)</span><textarea id="s-bank" placeholder="Bank name&#10;Account name&#10;IBAN&#10;SWIFT">${h(c.bank)}</textarea></label></div>
  <div class="card pad grid"><h2>Money & numbering</h2><div class="grid g3">${f('currency','Currency code')}${f('currencyName','Currency in words')}${f('minorName','Cents in words')}${f('taxLabel','Tax name')}${f('taxRate','Tax rate %',c.taxRate,'number')}${f('dueDays','Invoice due (days)',c.dueDays,'number')}${f('validDays','Quotation valid (days)',c.validDays,'number')}
   </div><div class="label" style="margin-top:4px">Numbering · prefix + date (DDMMYY) + 3-digit random number, never repeated, e.g. ${h(nextNumber('quotation',today()))}</div><div class="grid g3">
   ${['quotation','invoice','delivery'].map(t=>`<label class="field"><span>${TYPE[t].t.replace('Tax ','')} prefix</span><input id="s-p-${t}" value="${h(numPrefix(t))}"></label>`).join('')}
</div>
   <label class="check"><input type="checkbox" id="s-dnp" ${c.showPricesOnDN?'checked':''}>Show prices on delivery notes</label></div>
  <div class="card pad grid"><h2>Default terms</h2>${['quotation','invoice','delivery'].map(t=>`<label class="field"><span>${TYPE[t].t}</span><textarea id="s-t-${t}" rows="3">${h(c.terms[t])}</textarea></label>`).join('')}</div>
  <div class="card pad grid"><h2>Look & signature</h2><div class="grid g2"><label class="field"><span>Accent colour</span><input type="color" id="s-brand" value="${h(c.brand)}" style="padding:2px;height:40px"></label><label class="field"><span>Dark colour</span><input type="color" id="s-charcoal" value="${h(c.charcoal)}" style="padding:2px;height:40px"></label>
   <label class="field"><span>Document style</span><select id="s-docStyle"><option value="clean" ${(c.docStyle||'clean')==='clean'?'selected':''}>Clean · black & white, minimal</option><option value="classic" ${c.docStyle==='classic'?'selected':''}>Classic · logo colours</option><option value="premium" ${c.docStyle==='premium'?'selected':''}>Premium · corporate, full colour</option></select></label>
   <label class="field"><span>Document font</span><select id="s-docFont">${[['gothic','Century Gothic style · clean, geometric'],['modern','Montserrat + Source Sans · professional'],['neutral','Inter · neutral, compact'],['plex','Archivo + IBM Plex · technical']].map(([k,l])=>`<option value="${k}" ${(c.docFont||'gothic')===k?'selected':''}>${l}</option>`).join('')}</select></label>
   <label class="field"><span>Default product photo size</span><select id="s-photoSize">${[['S','Small'],['M','Medium'],['L','Large']].map(([k,l])=>`<option value="${k}" ${(c.photoSize||'M')===k?'selected':''}>${l}</option>`).join('')}</select></label></div>
   ${f('signName','Signatory name & title',c.signName,'text',true)}
   <div class="row"><h3 class="grow">Company stamp</h3><button class="btn sm" id="s-stamp-up">Upload stamp</button><button class="btn sm" id="s-stamp-clr">Remove</button></div>
   <div id="s-stamp-pv">${c.stamp?`<img src="${h(src(c.stamp))}" alt="Company stamp" style="max-height:80px;background:#fff;border-radius:6px;padding:4px">`:'<span class="muted">No stamp. Upload a photo or scan of the round stamp (PNG with clear background looks best).</span>'}</div>
   <div class="row"><h3 class="grow">Authorised signature</h3><button class="btn sm" id="s-sig-up">Upload image</button><button class="btn sm" id="s-sig-clr">Clear</button></div>
   ${c.signature?`<div class="row"><img src="${h(src(c.signature))}" alt="Current signature" style="max-height:70px;background:#fff;border-radius:6px;padding:4px"><span class="muted">Current. Draw below to replace.</span></div>`:''}
   <div class="sigpad" id="s-sig"></div></div>
  </div>
  <div class="side"><div class="label">Template preview</div><div class="card preview-wrap"><div class="preview-scale">${renderSheet(sample)}</div></div></div></div>`;
};
VIEWS_AFTER.settings=()=>{
  if(!isAdmin())return;
  const sp=sigPad($('#s-sig'));
  const pv=()=>{const k1=S.cfg.docStyle,k2=S.cfg.docFont;S.cfg.docStyle=$('#s-docStyle').value;S.cfg.docFont=$('#s-docFont').value;$$('.preview-scale').forEach(x=>x.innerHTML=renderSheet(window.__sample));S.cfg.docStyle=k1;S.cfg.docFont=k2;setTimeout(()=>{$$('.preview-wrap').forEach(fitPreview);alignBrand()},50)};
  $('#s-docStyle').onchange=pv;$('#s-docFont').onchange=pv;const c=clone(S.cfg);
  $('#s-logo').onclick=async()=>{const f=await pickImage();if(!f)return;toast('Uploading logo…');c.logo=await storeImage(f,600,true);$('#s-logo').innerHTML=img(c.logo)};
  $('#s-logo-x')&&($('#s-logo-x').onclick=()=>{c.logo='';$('#s-logo').innerHTML='Upload logo'});
  $('#s-sig-up').onclick=async()=>{const f=await pickImage();if(!f)return;c.signature=await storeImage(f,600,true);toast('Signature image ready. Save settings to keep it.')};
  $('#s-gps-here').onclick=async()=>{const b=$('#s-gps-here');b.disabled=true;b.textContent='Getting location…';const g=await getGPS();b.disabled=false;b.textContent='Use my location';
    if(hasGPS(g)){$('#s-gps').value=fmtGPS(g);toast('Location filled in (±'+g.acc+' m). Save settings to keep it.')}else toast(g&&g.error==='denied'?'Location is blocked. Allow location access and try again.':'Location not available.',true)};
  $('#s-stamp-up').onclick=async()=>{const f=await pickImage();if(!f)return;c.stamp=await storeImage(f,500,true);$('#s-stamp-pv').innerHTML=`<img src="${h(src(c.stamp))}" alt="Company stamp" style="max-height:80px;background:#fff;border-radius:6px;padding:4px">`;toast('Stamp ready. Save settings to keep it.')};
  $('#s-stamp-clr').onclick=()=>{c.stamp='';$('#s-stamp-pv').innerHTML='<span class="muted">No stamp.</span>';toast('Stamp removed. Save settings to keep the change.')};
  $('#s-sig-clr').onclick=()=>{sp.clear();c.signature='';toast('Signature cleared. Save settings to keep the change.')};
  $('#s-save').onclick=async()=>{
    ['name','website','phone','email','taxIdLabel','taxId','address','bank','currency','currencyName','minorName','taxLabel','signName','brand','charcoal','photoSize','docStyle','docFont','tagline','gps'].forEach(k=>c[k]=$('#s-'+k).value.trim());
    ['taxRate','dueDays','validDays'].forEach(k=>c[k]=+$('#s-'+k).value||0);
    c.prefix={};c.seqStart={};['quotation','invoice','delivery'].forEach(t=>{c.prefix[t]=$('#s-p-'+t).value.trim().toUpperCase()||numPrefix(t);0});
    c.terms={quotation:$('#s-t-quotation').value,invoice:$('#s-t-invoice').value,delivery:$('#s-t-delivery').value};
    c.showPricesOnDN=$('#s-dnp').checked;if(!sp.isEmpty())c.signature=sp.toData();
    await save('config','company',c,'Settings saved');
  };
};

/* ================= starter lists bundled with the app (added once, by an admin) ================= */
const SEEDS=['data/seed-starter-20261023.json','data/seed-quote-cctv124-20261023.json','data/seed-lldubai-soa-20261023.json'];
async function runSeeds(){
  for(const url of SEEDS){
    try{
      const cfgSnap=await getDocFromServer(doc(fdb,COL.config,'company'));const done=(cfgSnap.exists()&&cfgSnap.data().seeds)||{};
      const seed=await (await fetch(url,{cache:'no-store'})).json();if(done[seed.id])continue;
      // read what is already there straight from the server, so nothing is added twice
      const names=async col=>new Set((await getDocsFromServer(collection(fdb,COL[col]))).docs.map(d=>String(d.data().name||'').trim().toLowerCase()));
      const cMap=new Map((await getDocsFromServer(collection(fdb,COL.clients))).docs.map(d=>[String(d.data().name||'').trim().toLowerCase(),{...d.data(),id:d.id}]));
      const haveC=new Set(cMap.keys()),haveP=await names('products');let nc=0,np=0;const now=new Date().toISOString();
      for(const c of seed.clients||[]){const k=c.name.trim().toLowerCase();if(haveC.has(k))continue;const cid=uid();
        const cd={...c,places:(c.places||[]).map(pl=>({...pl,addedAt:now})),updatedAt:now};await setDoc(doc(fdb,COL.clients,cid),cd);cMap.set(k,{...cd,id:cid});haveC.add(k);nc++}
      // previous invoices (kept with their original numbers) and payments already received
      const dMap=new Map();let nl=0,npay=0;
      if((seed.legacy||[]).length||(seed.payments||[]).length)(await getDocsFromServer(collection(fdb,COL.docs))).docs.forEach(d=>dMap.set(String(d.data().number||''),d.id));
      for(const L of seed.legacy||[]){if(dMap.has(L.number))continue;const cl=cMap.get(String(L.clientName||'').trim().toLowerCase());if(!cl)continue;const id=uid();
        await setDoc(doc(fdb,COL.docs,id),{type:'invoice',legacy:true,number:L.number,date:L.date,dueDate:L.dueDate||addDays(L.date,+cl.creditDays||S.cfg.dueDays),ref:L.ref||'',subject:L.subject||'',
          amount:+L.amount,vat:+L.vat||0,items:[],clientId:cl.id,client:clientSnap(cl),notes:L.notes||'Previous invoice, entered manually',createdBy:S.me.id,createdByName:S.me.name,createdAt:now,updatedAt:now});dMap.set(L.number,id);nl++}
      for(const P of seed.payments||[]){const invId=dMap.get(P.invoiceNumber);const cl=cMap.get(String(P.clientName||'').trim().toLowerCase());if(!cl)continue;
        await setDoc(doc(fdb,COL.payments,uid()),{clientId:cl.id,invoiceId:invId||'',amount:+P.amount,date:P.date,method:P.method||'Previous payment',ref:P.ref||'',note:P.note||'Paid before using the app',createdBy:S.me.id,createdAt:now,updatedAt:now});npay++}
      if(nl)setTimeout(()=>toast(`${nl} previous invoice${nl===1?'':'s'} and ${npay} payment${npay===1?'':'s'} added`),5200);
      for(const p of seed.products||[]){if(haveP.has(p.name.trim().toLowerCase()))continue;
        await setDoc(doc(fdb,COL.products,uid()),{...p,createdBy:S.me.id,createdAt:now,updatedAt:now});np++}
      const made=[];
      for(const d0 of seed.docs||[]){const date=today(),id=uid(),pf=S.me.profile||{};
        const number=await reserveNumber(d0.type,date,d0.reportType);
        const d={...d0,number,date,validUntil:d0.type==='quotation'?addDays(date,S.cfg.validDays):'',dueDate:d0.type==='invoice'?addDays(date,S.cfg.dueDays):'',ref:d0.ref||'',salesperson:S.me.name||'',
          status:d0.type==='quotation'?'draft':'',attachments:[],createdBy:S.me.id,createdByName:S.me.name,contactName:S.me.name||'',contactMobile:pf.mobile||'',contactEmail:pf.email||'',createdAt:now,updatedAt:now};
        await setDoc(doc(fdb,COL.docs,id),d);made.push(number);
        for(const i of d.items||[]){const k=String(i.name||'').trim().toLowerCase();if(!k||haveP.has(k))continue;haveP.add(k);
          await setDoc(doc(fdb,COL.products,uid()),{name:i.name,desc:i.desc||'',unit:i.unit||'pcs',price:+i.price||0,photo:'',barcode:'',category:'',createdBy:S.me.id,createdAt:now,updatedAt:now,source:number})}}
      await setDoc(doc(fdb,COL.config,'company'),{seeds:{...done,[seed.id]:now}},{merge:true});
      if(nc||np)toast(`Added ${nc} customer${nc===1?'':'s'} and ${np} product${np===1?'':'s'}`);
      if(made.length)setTimeout(()=>toast('Quotation '+made.join(', ')+' created. Open Documents → Quotations.'),2600);
    }catch(e){console.warn('seed',url,e)}
  }
}
/* ================= sign-in & data ================= */
function loginScreen(){
  const app=$('#app');
  app.innerHTML=`<div class="loading"><form class="card pad" id="lf" style="width:min(380px,100%);display:flex;flex-direction:column;gap:14px">
    <div class="brand" style="padding:0"><div class="mark"><img src="assets/mark.png" alt=""></div><div><b style="color:var(--ink)">${h(DEFAULT_CFG.name)}</b><small class="muted">Invoicing</small></div></div>
    <h2>Sign in</h2><p class="muted" style="margin:0">Use your attendance app login.</p>
    <label class="field"><span>Login ID or email</span><input id="lf-id" autocomplete="username" autocapitalize="none" required></label>
    <label class="field"><span>Password</span><input id="lf-pw" type="password" autocomplete="current-password" required></label>
    <div id="lf-err" class="pill bad" hidden style="text-transform:none;padding:8px 10px;border-radius:8px"></div>
    <button class="btn primary" id="lf-go">Sign in</button></form></div>`;
  $('#lf').onsubmit=async e=>{e.preventDefault();const b=$('#lf-go'),er=$('#lf-err');b.disabled=true;er.hidden=true;
    try{try{sessionStorage.setItem('ll_fresh','1')}catch(_){}await signInWithEmailAndPassword(auth,loginToEmail($('#lf-id').value),$('#lf-pw').value)}
    catch(x){er.hidden=false;er.textContent=/invalid|wrong|not-found|credential/i.test(x.code||'')?'Login ID or password is wrong.':/network/i.test(x.code||'')?'No internet connection.':'Could not sign in ('+(x.code||x.message)+').';b.disabled=false}};
}
function messageScreen(title,text,retry){
  $('#app').innerHTML=`<div class="loading"><div class="card pad" style="max-width:420px;text-align:center;display:flex;flex-direction:column;gap:10px"><h2>${h(title)}</h2><p class="muted" style="margin:0">${text}</p>
   <div class="row" style="justify-content:center">${retry?'<button class="btn primary" id="ms-retry">Check again</button>':''}<button class="btn" id="ms-out">Sign out</button></div></div></div>`;
  $('#ms-out').onclick=logOut;if(retry)$('#ms-retry').onclick=()=>location.reload();
}
const busyViews=['edit','deliver','settings'];
let rT;const soon=()=>{clearTimeout(rT);rT=setTimeout(()=>{if(!busyViews.includes(S.view))render()},80)};
/* ----- login log ----- */
function deviceId(){try{let d=localStorage.getItem('ll_dev');if(!d){d=uid();localStorage.setItem('ll_dev',d)}return d}catch(e){return ''}}
async function deviceInfo(){const u=navigator.userAgent||'';let m;
  let os=(m=/Android ([\d.]+)/.exec(u))?'Android '+m[1]:/iPhone|iPad|iPod/.test(u)?'iOS':/Windows/.test(u)?'Windows':/Mac OS X/.test(u)?'Mac':/CrOS/.test(u)?'ChromeOS':/Linux/.test(u)?'Linux':'Other';
  const br=/Edg\//.test(u)?'Edge':/OPR\//.test(u)?'Opera':/SamsungBrowser/.test(u)?'Samsung Internet':/Firefox\//.test(u)?'Firefox':/Chrome\//.test(u)?'Chrome':/Safari\//.test(u)?'Safari':'Browser';
  let model=(m=/Android [\d.]+; ([^;)]+)/.exec(u))&&m[1]!=='K'?m[1].trim():'';
  try{if(navigator.userAgentData&&navigator.userAgentData.getHighEntropyValues){const v=await Promise.race([navigator.userAgentData.getHighEntropyValues(['model','platformVersion']),new Promise(r=>setTimeout(()=>r({}),1500))]);if(v.model)model=v.model}}catch(e){}
  const app=isNative()?'Android app':'Web';
  return {app,os,browser:app==='Web'?br:'',model,screen:`${screen.width}×${screen.height}`,ua:u.slice(0,300)}}
// Location only when the person already allowed it, so signing in never pops up a request.
async function quietGPS(){try{if(!navigator.permissions||!navigator.geolocation)return null;const st=await navigator.permissions.query({name:'geolocation'});if(st.state!=='granted')return null;
  const g=await Promise.race([getGPS(),new Promise(r=>setTimeout(()=>r(null),8000))]);return hasGPS(g)?{lat:g.lat,lng:g.lng,acc:g.acc}:null}catch(e){return null}}
async function logEvent(event,extra){try{
  const id=uid(),now=new Date(),d={uid:auth.currentUser?auth.currentUser.uid:S.me.id,name:S.me.name||'',role:S.me.role||'',event,at:now.toISOString(),date:today(),device:deviceId(),...(await deviceInfo()),...(extra||{})};
  if(!d.uid)return;const w=Store.put('logins',id,d);
  if(event!=='logout')quietGPS().then(g=>{if(g)Store.put('logins',id,{...d,gps:g}).catch(()=>{})});await w}catch(e){console.warn('login log',e)}}
function logSession(){let fresh=false;try{fresh=sessionStorage.getItem('ll_fresh')==='1';sessionStorage.removeItem('ll_fresh')}catch(e){}
  if(fresh)return logEvent('login');
  // re-opened with a saved login: record at most once per 30 minutes per device
  try{const k='ll_open_'+S.me.id,t=+localStorage.getItem(k)||0;if(Date.now()-t<30*6e4)return;localStorage.setItem(k,String(Date.now()))}catch(e){}
  return logEvent('open')}
async function logOut(){await Promise.race([logEvent('logout'),new Promise(r=>setTimeout(r,1500))]);signOut(auth)}

function startData(){
  Store.subDoc('config','company',c=>{S.cfg={...clone(DEFAULT_CFG),...(c||{}),prefix:{...DEFAULT_CFG.prefix,...(c&&c.prefix||{})},seqStart:{...DEFAULT_CFG.seqStart,...(c&&c.seqStart||{})},terms:{...DEFAULT_CFG.terms,...(c&&c.terms||{})}};delete S.cfg.id;soon()});
  Store.sub('sites',r=>{S.sites=r},null,true);
  Store.sub('projects',r=>{S.projects=Object.fromEntries(r.map(x=>[x.id,x]))},null,true);
  Store.sub('clients',r=>{S.clients=r;soon()});
  Store.sub('products',r=>{S.products=r;soon()});
  if(isAdmin())setTimeout(runSeeds,1500);
  if(can('payments')||can('reports')||can('invoice'))Store.sub('payments',r=>{S.payments=r;soon()});
  const parts={};const merge=()=>{const m={};Object.values(parts).forEach(a=>a.forEach(d=>m[d.id]=d));S.docs=Object.values(m);soon()};
  if(can('viewAll'))Store.sub('docs',r=>{parts.all=r;merge()});
  else{Store.sub('docs',r=>{parts.mine=r;merge()},[where('createdBy','==',S.me.id)]);if(can('deliver'))Store.sub('docs',r=>{parts.dl=r;merge()},[where('type','==','delivery')])}
  if(isAdmin())Store.sub('logins',r=>{S.logins=r;if(S.view==='logins'||S.view==='staff')soon()},[where('date','>=',addDays(today(),-120))],true);
  if(isAdmin()){const ra=()=>{if(S.view==='accounts')soon()};
    Store.sub('acct',r=>{S.acct=r;ra()});Store.sub('ledger',r=>{if(r.length)moveOldLedger(r)},null,true);Store.sub('driverPay',r=>{S.drv=r;ra()},null,true);Store.subDoc('acctSettings','opening',o=>{S.acctOpen=o||{};ra()});Store.subDoc('acctSettings','parties',o=>{S.acctParties=o||{}});
    Store.sub('petty',r=>{S.petty=r;if(S.view==='accounts')soon()},[where('type','==','credit')],true)}
  if(isAdmin()){Store.sub('users',r=>{S.users=Object.fromEntries(r.map(u=>[u.id,u]));soon()});Store.sub('access',r=>{S.access=Object.fromEntries(r.map(a=>[a.id,a]));if(S.view==='staff')soon()})}
  Store.subDoc('access',S.me.id,a=>{if(isAdmin()||!a)return;const p=JSON.stringify(a.perms||{});if(a.enabled===false||p!==JSON.stringify(S.me.perms))location.reload()});
}
onAuthStateChanged(auth,async u=>{
  Store.stop();S.logins=[];S.acct=[];S.drv=[];S.acctOpen={};S.acctParties={};S.petty=[];S.sites=[];S.projects={};S.docs=[];S.clients=[];S.products=[];S.payments=[];S.users={};S.access={};
  if(!u){S.me={id:null,role:'login',perms:{}};loginScreen();return}
  S.me={id:u.uid,role:'loading',perms:{},name:''};render();
  try{
    const usr=await Store.get('users',u.uid);
    if(!usr||usr.active===false){S.me.name=(usr&&usr.name)||u.email;logEvent('denied',{reason:'Login not active'});messageScreen('Access turned off','This login is not active. Ask your admin.');return}
    S.me.name=usr.name||u.email;
    const pr=await Store.get('profiles',u.uid).catch(()=>null);
    S.me.profile={mobile:(pr&&pr.mobile)||usr.phone||'',email:(pr&&pr.email)||(usr.email&&!/staff\.attendance\.app$/i.test(usr.email)?usr.email:'')};
    if(usr.role==='admin')S.me.role='admin';
    else{const a=await Store.get('access',u.uid).catch(()=>null);
      if(!a||a.enabled===false){logEvent('denied',{reason:'No invoicing access'});messageScreen('No invoicing access yet',`Signed in as <b>${h(S.me.name)}</b>. Ask the admin to turn on invoicing access for you in Staff &amp; access.`,true);return}
      S.me.role='employee';S.me.perms=a.perms||{}}
  }catch(e){messageScreen('Could not load your account',h(e.code||e.message)+'<br>Check your internet connection and the Firestore rules.',true);return}
  S.view='home';S.params={};render();startData();logSession();
});
window.addEventListener('resize',()=>$$('.preview-wrap').forEach(fitPreview));
