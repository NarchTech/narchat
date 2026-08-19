#!/usr/bin/env python3
# NarChat — PATRON PANELİ (yalnız işletmeci; Tayfun'un "kaç üye, kim aktif, sunucu ne tutuyor,
# sistem ayakta mı?" panosu). TASARIM SINIRLARI:
#   • YALNIZ 127.0.0.1'e bağlanır — kamu yüzeyine yetki-ucu AÇMAZ (uyum-hattı ilkesiyle aynı:
#     işletmeci araçları çevrimdışı/yerel kalır; mesaj_server.py'ye tek satır dokunulmaz).
#   • veri/ dizinini SALT-OKUR okur. Sunucunun zaten gördüğü METADATA'yı gösterir —
#     mesaj İÇERİĞİ E2E şifreli olduğu için burada da yoktur, gösterilemez (bu bir özellik).
#   • Bağımlılık yok (stdlib); canlı sunucudan bağımsız süreç — panel çökse de sohbet sürer.
# Çalıştır: python3 patron_panel.py   (→ http://127.0.0.1:8779 ; PANEL_PORT env ile değişir)
# Tek-tık: MERKUR/CIKTILAR/patron-panel-ac.command
import json, os, time, subprocess, urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime, timedelta

KOK = os.path.dirname(os.path.abspath(__file__))
VERI = os.path.join(KOK, "veri")
PORT = int(os.environ.get("PANEL_PORT", "8779"))
CANLI_API = "http://127.0.0.1:8101/api/ben"          # 401 = sunucu ayakta (oturumsuz beklenen yanıt)
TUNEL = "https://chat.narchtech.com/api/ben"
LANDING = "https://chat.narch.tech/"
LOG = os.path.expanduser("~/Library/Logs/narchat-sunucu.log")

def _json(yol, varsayilan):
    try:
        with open(os.path.join(VERI, yol), encoding="utf-8") as f: return json.load(f)
    except Exception: return varsayilan

def _http_kod(url, zaman=4):
    try:
        # UA şart: Cloudflare, başlıksız urllib isteğini 403'ler (gerçek durumu maskeler)
        istek = urllib.request.Request(url, method="GET", headers={"User-Agent": "NarChat-PatronPanel/1"})
        with urllib.request.urlopen(istek, timeout=zaman) as r: return r.status
    except urllib.error.HTTPError as e: return e.code
    except Exception: return 0

def _gun(ts): return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")

def ozet():
    simdi = time.time()
    kull = _json("kullanicilar.json", {})
    odalar = _json("odalar.json", {})
    davet = _json("davetler.json", {})
    push = _json("push_aboneler.json", {})

    # mesaj metadata taraması (içerik değil: id/oda/gonderen/ts) — kullanıcı-başına son etkinlik + günlük seri
    son_aktivite, msj_sayisi, oda_msj, oda_son, gunluk = {}, {}, {}, {}, {}
    toplam_msj = 0
    mdir = os.path.join(VERI, "mesajlar")
    if os.path.isdir(mdir):
        for d in os.listdir(mdir):
            if not d.endswith(".jsonl"): continue
            oda_id = d[:-6]
            try:
                with open(os.path.join(mdir, d), encoding="utf-8") as f:
                    for satir in f:
                        try: m = json.loads(satir)
                        except Exception: continue
                        ts, g = m.get("ts", 0), m.get("gonderen", "?")
                        toplam_msj += 1
                        msj_sayisi[g] = msj_sayisi.get(g, 0) + 1
                        son_aktivite[g] = max(son_aktivite.get(g, 0), ts)
                        oda_msj[oda_id] = oda_msj.get(oda_id, 0) + 1
                        oda_son[oda_id] = max(oda_son.get(oda_id, 0), ts)
                        if ts > simdi - 30*86400: gunluk[_gun(ts)] = gunluk.get(_gun(ts), 0) + 1
            except Exception: pass

    def aktif(gun): return sum(1 for t in son_aktivite.values() if t > simdi - gun*86400)

    kullanicilar = [{
        "kullanici": ad, "gorunen": (b or {}).get("ad", ""),
        "kayit": (b or {}).get("olusturma", 0),
        "anahtar": bool((b or {}).get("pubkey")),
        "push": ad in push and bool(push[ad]),
        "mesaj": msj_sayisi.get(ad, 0),
        "son": son_aktivite.get(ad, 0),
    } for ad, b in sorted(kull.items(), key=lambda kv: -son_aktivite.get(kv[0], 0))]

    oda_listesi = [{
        "ad": (b or {}).get("ad") or "1:1", "tip": (b or {}).get("tip", "?"),
        "uyeler": (b or {}).get("uyeler", []), "mesaj": oda_msj.get(oid, 0), "son": oda_son.get(oid, 0),
    } for oid, b in sorted(odalar.items(), key=lambda kv: -oda_son.get(kv[0], 0))]

    medya_n, medya_b = 0, 0
    for r, _, fs in os.walk(os.path.join(VERI, "medya")):
        for f in fs:
            medya_n += 1
            try: medya_b += os.path.getsize(os.path.join(r, f))
            except Exception: pass
    disk_b = 0
    for r, _, fs in os.walk(VERI):
        for f in fs:
            try: disk_b += os.path.getsize(os.path.join(r, f))
            except Exception: pass

    # davetler.json: "kodlar" = elle-seedlenmiş havuz (kullanılan da listede kalır),
    # "kullanilmis" = harcananlar, "otokodlar" = kod.html'in ürettiği bekleyenler (mesaj_server.py:746+)
    kodlar = davet.get("kodlar", []) if isinstance(davet, dict) else []
    kullanilmis = davet.get("kullanilmis", {}) if isinstance(davet, dict) else {}
    oto = davet.get("otokodlar", {}) if isinstance(davet, dict) else {}
    bekleyen = [k for k in kodlar if k not in kullanilmis] + [k for k in oto if k not in kullanilmis]
    kullanilan = list(kullanilmis)
    try:
        lc = subprocess.run(["launchctl", "list", "com.narchviz.narchat-sunucu"],
                            capture_output=True, text=True, timeout=4)
        launchd = "çalışıyor" if lc.returncode == 0 and '"PID"' in lc.stdout else "KAYITLI DEĞİL / DURMUŞ"
    except Exception: launchd = "bilinmiyor"
    try:
        with open(LOG, encoding="utf-8", errors="replace") as f: log_son = f.readlines()[-12:]
    except Exception: log_son = []

    return {
        "an": simdi,
        "kullanici_toplam": len(kull), "kullanicilar": kullanicilar,
        "aktif": {"g1": aktif(1), "g7": aktif(7), "g30": aktif(30)},
        "odalar": oda_listesi, "oda_toplam": len(odalar),
        "mesaj_toplam": toplam_msj, "gunluk": gunluk,
        "medya": {"adet": medya_n, "bayt": medya_b}, "disk_bayt": disk_b,
        "davet": {"uretilen": len(kodlar) + len(oto), "bekleyen": len(bekleyen), "kullanilan": len(kullanilan)},
        "push_abone": sum(1 for v in push.values() if v),
        "saglik": {"origin": _http_kod(CANLI_API), "tunel": _http_kod(TUNEL), "landing": _http_kod(LANDING), "launchd": launchd},
        "log": log_son,
    }

SAYFA = """<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>NarChat — Patron Paneli</title>
<style>
:root{--z:#faf6f2;--k:#fff;--m:#2a1a1e;--s:#7a6a6e;--nar:#a51d35;--yesil:#2e7d4f;--cizgi:#e8dcd6}
@media(prefers-color-scheme:dark){:root{--z:#171114;--k:#221a1e;--m:#f4ece8;--s:#a89a9e;--cizgi:#3a2e33}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 -apple-system,system-ui,sans-serif;background:var(--z);color:var(--m);padding:22px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:26px 0 10px}.s{color:var(--s);font-size:13px}
.kutu{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:16px}
.kart{background:var(--k);border:1px solid var(--cizgi);border-radius:12px;padding:14px}
.kart b{font-size:26px;display:block}.kart span{font-size:12.5px;color:var(--s)}
table{width:100%;border-collapse:collapse;background:var(--k);border:1px solid var(--cizgi);border-radius:12px;overflow:hidden}
th,td{padding:8px 12px;text-align:left;font-size:13.5px;border-top:1px solid var(--cizgi)}th{border:0;color:var(--s);font-weight:600}
.tabsar{overflow-x:auto}.ok{color:var(--yesil);font-weight:700}.hata{color:var(--nar);font-weight:700}
.bar{display:flex;align-items:flex-end;gap:2px;height:70px;background:var(--k);border:1px solid var(--cizgi);border-radius:12px;padding:10px}
.bar div{flex:1;background:var(--nar);border-radius:2px 2px 0 0;min-height:2px}
pre{background:var(--k);border:1px solid var(--cizgi);border-radius:12px;padding:12px;font-size:11.5px;overflow-x:auto;white-space:pre-wrap}
.not{background:var(--k);border-left:4px solid var(--nar);border:1px solid var(--cizgi);border-left-width:4px;border-radius:10px;padding:10px 14px;font-size:13px;margin-top:14px}
</style></head><body>
<h1>🍎 NarChat — Patron Paneli</h1>
<div class="s">Yalnız bu Mac'ten görünür (127.0.0.1) · veri/ salt-okur · 30 sn'de bir tazelenir · son: <span id="an">—</span></div>
<div class="not">🔒 <b>E2E hatırlatması:</b> mesaj içerikleri uçtan-uca şifreli — sunucuda da bu panelde de YOKTUR.
Burada görünen her şey, sunucunun işleyebilmek için zaten tuttuğu metadata'dır (kim · ne zaman · hangi odaya · kaç adet).</div>
<div class="kutu" id="ozetKutu"></div>
<h2>📈 Son 30 gün — günlük mesaj adedi</h2><div class="bar" id="grafik"></div>
<h2>👥 Kullanıcılar (<span id="kn">0</span>)</h2><div class="tabsar"><table id="ktab"><thead><tr>
<th>kullanıcı</th><th>görünen ad</th><th>kayıt</th><th>mesaj</th><th>son etkinlik</th><th>anahtar</th><th>push</th></tr></thead><tbody></tbody></table></div>
<h2>💬 Odalar (<span id="on">0</span>)</h2><div class="tabsar"><table id="otab"><thead><tr>
<th>oda</th><th>tip</th><th>üyeler</th><th>mesaj</th><th>son mesaj</th></tr></thead><tbody></tbody></table></div>
<h2>🩺 Sağlık</h2><div class="kutu" id="saglik"></div>
<h2>📜 Sunucu günlüğü (son satırlar)</h2><pre id="log">—</pre>
<script>
const $=id=>document.getElementById(id);
const zam=t=>t? new Date(t*1000).toLocaleString('tr-TR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
const gore=t=>{if(!t)return '—';const f=(Date.now()/1000-t);if(f<3600)return Math.round(f/60)+' dk önce';if(f<86400)return Math.round(f/3600)+' sa önce';return Math.round(f/86400)+' gün önce';};
const mb=b=>b>1048576? (b/1048576).toFixed(1)+' MB' : Math.round(b/1024)+' KB';
async function tazele(){
  const d=await (await fetch('/api/ozet')).json();
  $('an').textContent=new Date(d.an*1000).toLocaleTimeString('tr-TR');
  $('ozetKutu').innerHTML=[
    ['Üye',d.kullanici_toplam,'kayıtlı hesap'],['Bugün aktif',d.aktif.g1,'son 24 saatte mesaj attı'],
    ['7 gün aktif',d.aktif.g7,'haftalık'],['30 gün aktif',d.aktif.g30,'aylık'],
    ['Toplam mesaj',d.mesaj_toplam,'şifreli zarf adedi'],['Medya',d.medya.adet,mb(d.medya.bayt)+' şifreli blob'],
    ['Davet',d.davet.bekleyen,'bekleyen kod ('+d.davet.kullanilan+' kullanılmış)'],
    ['Push abonesi',d.push_abone,'bildirim alan kullanıcı'],['Disk',mb(d.disk_bayt),'veri/ toplamı'],
  ].map(([a,b,c])=>`<div class="kart"><b>${b}</b>${a}<br><span>${c}</span></div>`).join('');
  const gunler=[...Array(30)].map((_,i)=>{const g=new Date(Date.now()-(29-i)*86400000);return g.toISOString().slice(0,10);});
  const mx=Math.max(1,...gunler.map(g=>d.gunluk[g]||0));
  $('grafik').innerHTML=gunler.map(g=>`<div style="height:${(d.gunluk[g]||0)/mx*100}%" title="${g}: ${d.gunluk[g]||0} mesaj"></div>`).join('');
  $('kn').textContent=d.kullanici_toplam;
  $('ktab').tBodies[0].innerHTML=d.kullanicilar.map(k=>`<tr><td><b>@${k.kullanici}</b></td><td>${k.gorunen||'—'}</td>
    <td>${zam(k.kayit)}</td><td>${k.mesaj}</td><td>${gore(k.son)}</td>
    <td>${k.anahtar?'<span class=ok>✓</span>':'<span class=hata>yok</span>'}</td><td>${k.push?'🔔':'—'}</td></tr>`).join('');
  $('on').textContent=d.oda_toplam;
  $('otab').tBodies[0].innerHTML=d.odalar.map(o=>`<tr><td>${o.ad}</td><td>${o.tip}</td>
    <td>${o.uyeler.map(u=>'@'+u).join(', ')}</td><td>${o.mesaj}</td><td>${gore(o.son)}</td></tr>`).join('');
  const S=d.saglik, r=(k,i)=>`<div class="kart"><b class="${i?'ok':'hata'}">${i?'✓':'✗'}</b>${k}<br><span>${i||'ulaşılamadı'}</span></div>`;
  $('saglik').innerHTML=r('Origin :8101',S.origin===401?'401 (beklenen)':S.origin)+r('Tünel chat.narchtech.com',S.tunel===401?'401 (beklenen)':S.tunel)
    +r('Landing chat.narch.tech',S.landing===200?200:0)+`<div class="kart"><b class="${S.launchd==='çalışıyor'?'ok':'hata'}">${S.launchd==='çalışıyor'?'✓':'✗'}</b>launchd<br><span>${S.launchd}</span></div>`;
  $('log').textContent=(d.log||[]).join('')||'— günlük okunamadı —';
}
tazele(); setInterval(tazele,30000);
</script></body></html>"""

class Panel(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _yaz(self, kod, tip, govde):
        self.send_response(kod)
        self.send_header("Content-Type", tip)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(govde)
    def do_GET(self):
        if self.path.startswith("/api/ozet"):
            self._yaz(200, "application/json; charset=utf-8", json.dumps(ozet()).encode())
        elif self.path in ("/", "/index.html"):
            self._yaz(200, "text/html; charset=utf-8", SAYFA.encode())
        else:
            self._yaz(404, "text/plain", b"yok")

if __name__ == "__main__":
    print(f"🍎 Patron paneli: http://127.0.0.1:{PORT}  (yalnız bu Mac; kapatmak: Ctrl-C)")
    HTTPServer(("127.0.0.1", PORT), Panel).serve_forever()
