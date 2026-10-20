"""Write web/js/config.js for the web dashboard.

Priority:
  1. FIREBASE_WEB_CONFIG env (the JSON "firebaseConfig" object from
     Firebase console → Project settings → Your apps → Web app)
  2. Derived from GOOGLE_SERVICES_JSON (the Android config) — works for Auth + Firestore.
"""
import json
import os
import re
import sys

out_path = sys.argv[1] if len(sys.argv) > 1 else "web/js/config.js"
web = os.environ.get("FIREBASE_WEB_CONFIG", "").strip()
gs = os.environ.get("GOOGLE_SERVICES_JSON", "").strip()

cfg = None
if web:
    # Accept either pure JSON or the JS snippet Firebase shows (const firebaseConfig = {...};)
    m = re.search(r"\{.*\}", web, re.S)
    body = m.group(0) if m else web
    try:
        cfg = json.loads(body)
    except json.JSONDecodeError:
        # turn JS object literal into JSON: quote keys, single->double quotes, drop trailing commas
        j = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', body)
        j = j.replace("'", '"')
        j = re.sub(r",\s*}", "}", j)
        cfg = json.loads(j)
elif gs:
    data = json.loads(gs)
    info = data["project_info"]
    client = data["client"][0]
    pid = info["project_id"]
    cfg = {
        "apiKey": client["api_key"][0]["current_key"],
        "authDomain": f"{pid}.firebaseapp.com",
        "projectId": pid,
        "storageBucket": info.get("storage_bucket", ""),
        "messagingSenderId": info["project_number"],
        "appId": client["client_info"]["mobilesdk_app_id"],
    }
else:
    sys.exit("ERROR: set FIREBASE_WEB_CONFIG or GOOGLE_SERVICES_JSON secret")

os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, "w", encoding="utf-8") as f:
    f.write("// Generated at deploy time by tools/gen_web_config.py\n")
    f.write(f"export const firebaseConfig = {json.dumps(cfg, indent=2)};\n")
    # Optional: Google Maps JavaScript API key (Maps JavaScript API + Places API (New) enabled).
    gkey = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    f.write(f"export const googleMapsApiKey = {json.dumps(gkey)};\n")
print(f"Wrote {out_path} for project {cfg.get('projectId')}")
gk = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
print(f"::notice title=Google Maps key::{'set (' + gk[:6] + '…' + gk[-4:] + ', ' + str(len(gk)) + ' chars)' if gk else 'NOT set - free OpenStreetMap search will be used'}")
