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
window.__make=async(style)=>{S.cfg.docStyle=style;const d={...__Q,id:'Q',number:'QTN231026418',date:'2026-10-23',validUntil:'2026-11-07',salesperson:'Anwar',contactName:'Anwar',contactMobile:'+971 50 803 1282',contactEmail:'anwar@llct.net'};
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
        b64 = pg.evaluate("s=>__make(s)", st)
        open(os.path.join(out, f'quote-{st}.pdf'), 'wb').write(base64.b64decode(b64)); print('wrote', st)
    br.close()
