"""Render sample PDFs through the app's real export path (html2pdf) in headless Chromium.
Used by the 'PDF preview' workflow to check page layout; not part of the app."""
import base64, json, os, re, sys
from playwright.sync_api import sync_playwright
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
web = os.path.join(root, 'web')
s = open(os.path.join(web, 'js/app.js'), encoding='utf-8').read()
s = re.sub(r"^import .*?;\n", "", s, flags=re.M)
q = json.load(open(os.path.join(root, 'tools/sample-quote.json'), encoding='utf-8'))
stub = """const initializeApp=()=>({}),getAuth=()=>({}),onAuthStateChanged=()=>{},signInWithEmailAndPassword=async()=>{},signOut=()=>{},setPersistence=async()=>{},browserLocalPersistence={};
const initializeFirestore=()=>({}),persistentLocalCache=()=>({}),persistentMultipleTabManager=()=>({}),collection=()=>({}),doc=()=>({}),getDoc=async()=>({exists:()=>false}),setDoc=async()=>{},deleteDoc=async()=>{},onSnapshot=()=>()=>{},query=()=>({}),where=()=>({}),runTransaction=async()=>1,getDocsFromServer=async()=>({docs:[]}),getDocFromServer=async()=>({exists:()=>false});const firebaseConfig={};"""
test = """
S.me={id:'u1',role:'admin',perms:{},name:'Anwar'};
window.__make=async(style,short)=>{S.cfg.docStyle=style;const d={...__Q,...(short?{items:__Q.items.slice(0,4),notes:''}:{}),id:'Q',number:'QTN231026418',date:'2026-10-23',validUntil:'2026-11-07',salesperson:'Anwar',contactName:'Anwar',contactMobile:'+971 50 803 1282',contactEmail:'anwar@llct.net'};
  let out=null;saveFile=async(bytes)=>{out=bytes};await downloadPdf(renderSheet(d),'x.pdf');
  let b='';for(let i=0;i<out.length;i+=0x8000)b+=String.fromCharCode.apply(null,out.subarray(i,i+0x8000));return btoa(b)};
""".replace('__Q', json.dumps(q, ensure_ascii=False))
html = f"""<!doctype html><html><head><meta charset="utf-8"><base href="file://{web}/"><link rel="stylesheet" href="css/app.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
<style>body{{margin:0}}</style></head><body><div id="app" hidden></div><script>{stub}{s.replace('function saveFile','var saveFile=async function saveFile0').replace('async var saveFile','var saveFile')}{test}</script></body></html>"""
path = os.path.join(root, 'tools', '_preview.html'); open(path, 'w', encoding='utf-8').write(html)
out = sys.argv[1] if len(sys.argv) > 1 else 'pdf-preview'; os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    br = p.chromium.launch(args=['--allow-file-access-from-files'])
    pg = br.new_page(); pg.on('pageerror', lambda e: print('PAGE ERROR', e))
    pg.goto('file://' + path); pg.wait_for_timeout(3000)
    for st in ['classic', 'clean', 'premium']:
        for short in (False, True):
            b64 = pg.evaluate("([s,k])=>__make(s,k)", [st, short])
            name = f"quote-{st}{'-short' if short else ''}.pdf"
            open(os.path.join(out, name), 'wb').write(base64.b64decode(b64)); print('wrote', name)
    # delivery note with stamp, signatures and a proof photo (classic)
    b64 = pg.evaluate('''async()=>{S.cfg.docStyle='classic';S.cfg.stamp='assets/logo.png';S.cfg.signature='assets/icon-192.png';S.cfg.gps='25.255461,55.339173';
      const d={id:'D1',type:'delivery',number:'DLN231026465',date:'2026-10-23',client:{name:'Agility Logistics',address:'Jebel Ali Free Zone (South Zone)\\nPO Box 17713\\nDubai, United Arab Emirates',phone:'+971 4 813 1222',email:'dubai@agility.com'},
       gps:{lat:9.575836,lng:77.94433},contactName:'Anwar Hussain',contactMobile:'0508031282',terms:'Goods received in good condition. Please check serial numbers against this note.',
       items:[{name:'Dahua 4MP IR Turret IP Camera',desc:'WizSense, 2.8 mm fixed lens, IR 30 m, built-in mic, IP67, PoE',qty:2,unit:'pcs',serials:['8902080000333','608116-039-0237731'],status:'Delivered'}],
       attachments:[{ref:'assets/icon-512.png',kind:'image',caption:'Delivered at site',inPdf:true,size:'M'}],
       delivery:{receiver:'Marco',receiverPhone:'08855223648',signature:'assets/logo.png',signedAt:'2026-10-24T00:12:00',deliveredBy:'u1',deliveredByName:'Anwar Hussain',gps:{lat:9.57584,lng:77.94433}}};
      let out=null;saveFile=async(bytes)=>{out=bytes};await downloadPdf(renderSheet(d)+renderAnnex(d),'x.pdf');
      let b='';for(let i=0;i<out.length;i+=0x8000)b+=String.fromCharCode.apply(null,out.subarray(i,i+0x8000));return btoa(b)}''')
    open(os.path.join(out, 'dn-classic.pdf'), 'wb').write(base64.b64decode(b64)); print('wrote dn-classic.pdf')
    br.close()
