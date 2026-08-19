// NarChat — app.js  ·  Faz-1 / Adım 4 (mobil-öncelikli sıcak-modern UI)
// E2E: TÜM şifreleme BURADA (cihazda). Sunucu yalnız opak ciphertext görür.
// Şema "e2e1" (uniform — 1:1 ve grup AYNI yol):
//   K = secretbox anahtarı (rastgele) ; msgCipher = secretbox(mesaj, n, K)
//   her üye M için: encKey_M = box(K, n2_M, M.pub, gonderenPriv)   (fan-out)
//   blob = {sema, msg, n, gonderenPub, anahtarlar:[{uye,n2,anahtar}]}
//   alıcı: K = box_open(encKey_me, n2_me, gonderenPub, benimPriv) → mesaj = secretbox_open(msg, n, K)

// -sumo build: crypto_pwhash (Argon2id) içerir — özel anahtar parola-koruması için gerekli.
// v44: self-host vendor (CDN bağımlılığı yok — offline/PWA + bundled APK önkoşulu; kaynak: esm.sh bundle 0.7.15, node-shim'leri inert)
import _sodium from './vendor/libsodium-sumo.js';
import { API_KOK } from './kok.js?v=1';
import { dogrulayiciUret, meydanImzala, KDF_VARSAYILAN } from './auth.js?v=2';
import { aramaInit, aramaBaslat, aramaCevapla, aramaReddet, sinyalGeldi, kapat as aramaKapat, durumu as aramaDurumu, videoMu as aramaVideoMu, arayan as aramaArayan, aktifOda as aramaAktifOda, mikrofonToggle, mikrofonKapali, hoparlorToggle, hoparlorAcikMi, kameraToggle, kameraKapaliMi, kameraCevir, yuzKameraTipi } from './arama.js?v=12';
import { grupInit, grupBaslat, grupKatil, grupReddet, grupKapat, grupSinyalGeldi, grupDurumu, grupVideoMu, grupOdasi, grupArayan, grupYerel, grupKatilimcilar, grupMikToggle, grupMikKapali, grupKameraToggle, grupKameraKapali, grupKameraCevir, grupYuz } from './grup-arama.js?v=3';
await _sodium.ready;
const S = _sodium;
const B64 = S.base64_variants.ORIGINAL;
const b64 = (u8) => S.to_base64(u8, B64);
const ub64 = (s) => S.from_base64(s, B64);

// ---------- durum ----------
let BEN = null;          // {kullanici, pubkey}
let PRIV = null;         // Uint8Array private key
let ODA = null;          // seçili oda id
let ODA_BILGI = {};      // oda -> {uyeler, tip, ad,...}
let ODALAR = [];         // oda listesi (önizleme+sıralama için)
let KISILER = [];        // kişi defterim (H3: gruba üye eklemek için aday liste)
let PUBKEYLER = {};      // kullanici -> pubkey(b64)
let PRESENCE = {};       // kullanici -> çevrimiçi mi (yalnız kişilerden)
let ADLAR = {};          // kullanici -> görünen ad (profil)
let AVATARLI = new Set();// profil fotoğrafı olan kullanıcılar
let SON_TS = 0;          // açık odadaki en yeni mesaj ts
const SAYFA = 50;        // H3 sayfalama: açılışta yüklenen son mesaj sayısı
let DAHA_VAR = false;    // daha eski mesaj var mı (sayfalama)
let MESAJ_MODEL = {};    // mid -> mesaj nesnesi (açık oda; G11 toplu ilet/sil için govde erişimi)
let TEPKILER = {};       // mid -> {kim: emoji} (açık oda; emoji E2E çözülmüş — sunucuda opak)
let SON_GUN = null;      // gün ayracı takibi
let SON_KIM = null;      // baloncuk zincirleme takibi
let ES = null;           // EventSource (açık oda — mesaj/okundu/yazıyor)
let ES_KISI = null;      // EventSource (kişisel çağrı kanalı — oturum boyu açık; gelen arama HER ekranda zil çalar)
let OKUNDU = {};         // mesaj id -> başkası okudu mu (tik)
const OKUNACAK = new Set();   // okundu olarak işaretlenecek id'ler (debounce)
let okunduZ = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// H3 cila: mesaj metnindeki http(s) linklerini tıklanabilir yap — XSS-GÜVENLİ (her parça esc'li; yalnız http/https şema;
// rel=noopener/noreferrer + target=_blank). javascript:/data: gibi şemalar EŞLEŞMEZ → güvenli.
function metinYaz(el, t){
  const url = /\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]}'"]/gi;
  let html = '', son = 0, m;
  while ((m = url.exec(t))){
    html += esc(t.slice(son, m.index));
    html += '<a href="' + esc(m[0]) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(m[0]) + '</a>';
    son = m.index + m[0].length;
  }
  html += esc(t.slice(son));
  el.innerHTML = html;
}
const api = async (yol, opt={}) => {
  // FAZ N3: native'de (API_KOK dolu) sunucu farklı origin'de → cross-origin çerezli istek 'include' ister;
  // webde (API_KOK boş) 'same-origin' aynen korunur (davranış DEĞİŞMEZ).
  const r = await fetch(API_KOK+yol, {credentials: API_KOK?'include':'same-origin', headers:{'Content-Type':'application/json', 'X-NarChat':'1'}, ...opt});   // D1/L2: CSRF özel-başlığı tüm authlu çağrılarda (tek choke-point)
  let d = null; try { d = await r.json(); } catch {}
  return {ok:r.ok, kod:r.status, d};
};

// ════════ anahtar yönetimi (cihazda, parolayla şifreli, IndexedDB) ════════
// Private key cihazdan ÇIKMAZ ve diskte DÜZ DURMAZ: paroladan Argon2id ile türetilen
// anahtarla secretbox'lanıp IndexedDB'de saklanır. Açmak parola gerektirir (XSS/çalıntı-disk savunması).
function _idb(){
  return new Promise((res, rej) => {
    const r = indexedDB.open('narchat', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('anahtarlar');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function _idbSet(k, v){ const db = await _idb(); return new Promise((res, rej) => {
  const t = db.transaction('anahtarlar', 'readwrite'); t.objectStore('anahtarlar').put(v, k);
  t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
async function _idbGet(k){ const db = await _idb(); return new Promise((res, rej) => {
  const t = db.transaction('anahtarlar', 'readonly'); const rq = t.objectStore('anahtarlar').get(k);
  rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); }

function _wrapKey(parola, salt){
  return S.crypto_pwhash(S.crypto_secretbox_KEYBYTES, parola, salt,
    S.crypto_pwhash_OPSLIMIT_INTERACTIVE, S.crypto_pwhash_MEMLIMIT_INTERACTIVE, S.crypto_pwhash_ALG_DEFAULT);
}
async function anahtarVarMi(kullanici){ return !!(await _idbGet('anahtar_'+kullanici)); }

// Cihaz sarmalama anahtarı: bu cihaza özel, rastgele, IndexedDB'de. Anahtarı her-açılış PAROLA SORMADAN
// açmak için kullanılır → cihazın kendi kilidine güvenir (telefon PIN/Face ID, bilgisayar girişi).
async function _cihazAnahtari(){
  let dk = await _idbGet('cihaz_dk');
  if (!dk){ dk = b64(S.randombytes_buf(S.crypto_secretbox_KEYBYTES)); await _idbSet('cihaz_dk', dk); }
  return ub64(dk);
}
// Private key'i sakla. parola verilirse PAROLA modu (Argon2id kilit — açılışta sorulur);
// verilmezse CİHAZ modu (parolasız auto-aç — VARSAYILAN; cihazın kendi kilidine güvenir).
async function _anahtarSakla(kullanici, privKey, pub, parola){
  const nonce = S.randombytes_buf(S.crypto_secretbox_NONCEBYTES);
  let rec;
  if (parola){
    const salt = S.randombytes_buf(S.crypto_pwhash_SALTBYTES);
    rec = {v:2, mod:'parola', salt:b64(salt), nonce:b64(nonce),
           cipher:b64(S.crypto_secretbox_easy(privKey, nonce, _wrapKey(parola, salt))), pub};
  } else {
    rec = {v:2, mod:'cihaz', nonce:b64(nonce),
           cipher:b64(S.crypto_secretbox_easy(privKey, nonce, await _cihazAnahtari())), pub};
  }
  await _idbSet('anahtar_'+kullanici, rec);
  PRIV = privKey;
  return pub;
}
// Yeni keypair üret → (varsayılan) cihaz modunda sakla → public döndür.
async function anahtarUret(kullanici){
  const kp = S.crypto_box_keypair();
  return _anahtarSakla(kullanici, kp.privateKey, b64(kp.publicKey));
}
// PAROLASIZ yükle. Döndürür: pub (cihaz modu) | 'KILITLI' (parola modu / eski kayıt) | null (yok).
async function anahtarYukle(kullanici){
  const rec = await _idbGet('anahtar_'+kullanici);
  if (!rec) return null;
  if (rec.mod === 'cihaz'){
    PRIV = S.crypto_secretbox_open_easy(ub64(rec.cipher), ub64(rec.nonce), await _cihazAnahtari());
    return rec.pub;
  }
  return 'KILITLI';   // parola-sarmalı (kullanıcı kilit açtı) ya da eski v1 kayıt → parola iste
}
// Parola-sarmalı kaydı aç. mod='parola' → kilitli kalır; eski v1 → parolasız cihaz moduna göç eder.
async function anahtarParolaAc(kullanici, parola){
  const rec = await _idbGet('anahtar_'+kullanici);
  const priv = S.crypto_secretbox_open_easy(ub64(rec.cipher), ub64(rec.nonce), _wrapKey(parola, ub64(rec.salt)));
  if (rec.mod === 'parola'){ PRIV = priv; return rec.pub; }     // kullanıcı kilit istemiş → şifreli kalsın
  return _anahtarSakla(kullanici, priv, rec.pub);               // eski v1 → cihaz moduna göç (parolasız)
}
// Ayarlar: kilit modu açık mı?
async function kilitModuAcikMi(kullanici){
  const rec = await _idbGet('anahtar_'+kullanici);
  return !!(rec && rec.mod !== 'cihaz');   // 'parola' ya da eski v1 = kilitli sayılır
}

// ════════ çok-cihaz: cihaz bağlama (anahtarı kayıpsız ikinci cihaza taşı) ════════
// Anahtar sunucuya DÜZ gitmez: PRIV, tek-kullanımlık bir parola-cümlesiyle şifrelenip (opak blob)
// kısa süreli kanala konur; yeni cihaz AYNI hesapla girip kanaldan çekip parola-cümlesiyle çözer.
let _SON_BAGLA_KOD = '';
function _rastgeleKod(n){    // okunur alfabe (karışan 0/O/1/I/l yok)
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const u = S.randombytes_buf(n); let s = '';
  for (let i = 0; i < n; i++) s += A[u[i] % A.length];
  return s;
}
function _kodWrap(parolaCumle, salt){
  return S.crypto_pwhash(S.crypto_secretbox_KEYBYTES, parolaCumle, salt,
    S.crypto_pwhash_OPSLIMIT_INTERACTIVE, S.crypto_pwhash_MEMLIMIT_INTERACTIVE, S.crypto_pwhash_ALG_DEFAULT);
}
// (anahtarı-olan cihaz) PRIV'i parola-cümlesiyle şifrele, kanala yükle, kullanıcıya kodu göster.
async function cihazBaglaUret(){
  if (!PRIV || !BEN){ toast('Önce kilidi aç'); return; }
  const kanal = _rastgeleKod(6);
  const parolaCumle = _rastgeleKod(15);               // ~75 bit — tek kullanımlık, ~10 dk geçerli
  const salt = S.randombytes_buf(S.crypto_pwhash_SALTBYTES);
  const nonce = S.randombytes_buf(S.crypto_secretbox_NONCEBYTES);
  const cipher = S.crypto_secretbox_easy(PRIV, nonce, _kodWrap(parolaCumle, salt));
  const blob = JSON.stringify({v:1, kull:BEN.kullanici, pub:BEN.pubkey,
    salt:b64(salt), nonce:b64(nonce), cipher:b64(cipher)});
  const {ok} = await api('/api/cihaz-aktar', {method:'POST', body:JSON.stringify({kanal, blob})});
  if (!ok){ toast('Bağlama kodu oluşturulamadı'); return; }
  _SON_BAGLA_KOD = kanal + '-' + parolaCumle;
  $('baglaKod').textContent = _SON_BAGLA_KOD;
  const link = location.origin + '/#k=' + kanal + '.' + parolaCumle;
  $('baglaLink').innerHTML = 'Bağlantı: <span style="word-break:break-all">' + esc(link) + '</span>';
  $('baglaKodPop').classList.remove('gizli');
}
// (yeni cihaz) kanaldan blob'u çek → parola-cümlesiyle çöz → bu cihazda login-parolasıyla sakla.
async function cihazAnahtarGetir(kanal, parolaCumle){
  const {ok, d} = await api('/api/cihaz-aktar?kanal=' + encodeURIComponent(kanal));
  if (!ok || !d || !d.blob) throw new Error('kanal yok/süre doldu');
  const o = JSON.parse(d.blob);
  const priv = S.crypto_secretbox_open_easy(ub64(o.cipher), ub64(o.nonce),
    _kodWrap(parolaCumle, ub64(o.salt)));            // yanlış parola-cümlesi → atar
  const pub = await _anahtarSakla(BEN.kullanici, priv, o.pub);   // bu cihaza sarmala (parolasız aç)
  // Sunucu pubkey'ini bu (kanonik) anahtara hizala — önceki sessiz anahtar-rotasyonu olduysa iyileştirir.
  await api('/api/anahtar', {method:'POST', body:JSON.stringify({pubkey: pub})});
  return pub;
}

// ════════ şif*le / çöz ════════
function sifrele(metin, uyeler, yanit){
  const K = S.crypto_secretbox_keygen();
  const n = S.randombytes_buf(S.crypto_secretbox_NONCEBYTES);
  const msg = S.crypto_secretbox_easy(S.from_string(metin), n, K);
  const anahtarlar = [];
  for (const uye of uyeler){
    const pub = PUBKEYLER[uye];
    if (!pub) continue; // anahtarı olmayan üye atlanır (henüz giriş yapmamış)
    const n2 = S.randombytes_buf(S.crypto_box_NONCEBYTES);
    const enc = S.crypto_box_easy(K, n2, ub64(pub), PRIV);
    anahtarlar.push({uye, n2:b64(n2), anahtar:b64(enc)});
  }
  const blob = {sema:'e2e1', msg:b64(msg), n:b64(n), gonderenPub:BEN.pubkey, anahtarlar};
  if (yanit && yanit.id){                       // alıntılı yanıt: önizleme metni AYNI K ile şifreli (E2E korunur; id+kim metadata sunucuda zaten var)
    const nOn = S.randombytes_buf(S.crypto_secretbox_NONCEBYTES);
    const on = S.crypto_secretbox_easy(S.from_string(String(yanit.onizleme||'').slice(0,120)), nOn, K);
    blob.yanit = { id: yanit.id, kim: yanit.kim, on: b64(on), nOn: b64(nOn) };
  }
  return blob;
}
function coz(blob){
  try{
    if (!blob || blob.sema!=='e2e1') return '⟨okunamadı⟩';
    const benim = (blob.anahtarlar||[]).find(a => a.uye===BEN.kullanici);
    if (!benim) return '⟨bana şifrelenmemiş⟩';
    const K = S.crypto_box_open_easy(ub64(benim.anahtar), ub64(benim.n2), ub64(blob.gonderenPub), PRIV);
    const msg = S.crypto_secretbox_open_easy(ub64(blob.msg), ub64(blob.n), K);
    return S.to_string(msg);
  }catch(e){ return '⟨çözme hatası⟩'; }
}
// alıntılı yanıt önizlemesini çöz (mesajın K'sıyla şifreli) → {id,kim,onizleme} ya da null
function cozYanit(blob){
  try{
    if (!blob || blob.sema!=='e2e1' || !blob.yanit) return null;
    const benim = (blob.anahtarlar||[]).find(a => a.uye===BEN.kullanici);
    if (!benim) return null;
    const K = S.crypto_box_open_easy(ub64(benim.anahtar), ub64(benim.n2), ub64(blob.gonderenPub), PRIV);
    const on = S.crypto_secretbox_open_easy(ub64(blob.yanit.on), ub64(blob.yanit.nOn), K);
    return { id: blob.yanit.id, kim: blob.yanit.kim, onizleme: S.to_string(on) };
  }catch(e){ return null; }
}
// ════════ G5: güvenlik numarası (safety number / parmak izi) ════════
// İki tarafın AÇIK anahtarından türetilen simetrik 60-haneli numara. Anahtarlar kanonik
// sıraya (küçük-bayt önce) konduğundan İKİ TARAF DA AYNI numarayı görür → telefonla/yüz yüze
// okuyup karşılaştırırlar. Eşleşiyorsa araya giren (MITM) yok; uyuşmuyorsa anahtar değişmiş/şüpheli.
function _baytKarsilastir(a, b){
  const n = Math.min(a.length, b.length);
  for (let i=0;i<n;i++){ if (a[i]!==b[i]) return a[i]-b[i]; }
  return a.length - b.length;
}
function guvenlikNumarasi(pubA, pubB){
  if (!pubA || !pubB) return '';
  try {
    let x = ub64(pubA), y = ub64(pubB);
    if (_baytKarsilastir(x, y) > 0){ const t=x; x=y; y=t; }   // kanonik sıra → simetrik
    const birlesik = new Uint8Array(x.length + y.length);
    birlesik.set(x, 0); birlesik.set(y, x.length);
    const h = S.crypto_generichash(60, birlesik);             // 60 bayt → 12 grup × 5 hane
    const gruplar = [];
    for (let i=0;i<12;i++){
      let v = 0; for (let j=0;j<5;j++) v = v*256 + h[i*5+j];   // 40-bit → güvenli double aralığı
      gruplar.push(String(v % 100000).padStart(5,'0'));
    }
    return gruplar;   // 12 elemanlı dizi (5'er hane)
  } catch(e){ return ''; }
}

// bir mesajdan kısa önizleme metni (yanıt barı + alıntı için)
function mesajOnizleMetni(m){
  if (!m) return '';
  if (m.silindi) return '🚫 silinen mesaj';
  if (m.govde && m.govde.sema==='e2e1m') return medyaOnizleEtiket(m.govde);
  return coz(m.govde);
}
// ── alıntılı yanıt durumu ──
let YANIT = null;   // {id, kim, onizleme} ya da null
function yanitBarGoster(y){   // YANIT nesnesinden yanıt barını göster (yeni yanıt + taslaktan geri-yükleme ortak)
  YANIT = y;
  $('yanitBarKim').textContent = gorAd(y.kim);
  $('yanitBarOn').textContent = y.onizleme || '(medya)';
  $('yanitBar').classList.remove('gizli');
}
function yanitlamayaBasla(m){
  if (!m || m.silindi) return;
  yanitBarGoster({ id: m.id, kim: m.gonderen, onizleme: String(mesajOnizleMetni(m)||'').slice(0,120) });
  const t=$('mesajIn'); if (t) t.focus();
}
function yanitIptal(){ YANIT = null; const b=$('yanitBar'); if (b) b.classList.add('gizli'); }

// ── G9: mesaj düzenleme durumu ──
let DUZENLE = null;   // düzenlenen mesaj nesnesi ya da null
function duzenlemeBasla(m){
  if (!m || m.silindi) return;
  if (m.govde && m.govde.sema==='e2e1m'){ toast('Medya mesajı düzenlenemez'); return; }
  const metin = coz(m.govde);
  if (!metin || metin.startsWith('⟨')){ toast('Bu mesaj düzenlenemez'); return; }
  yanitIptal();                                  // düzenleme ile yanıt aynı anda olmaz
  DUZENLE = m;
  const t=$('mesajIn'); t.value = metin; t.focus(); otoYukseklik();
  $('duzenleBarOn').textContent = metin.slice(0,120);
  $('duzenleBar').classList.remove('gizli');
}
function duzenleIptal(){ DUZENLE = null; const b=$('duzenleBar'); if (b) b.classList.add('gizli');
  taslakGeriYukle(ODA); }   // N7: düzenleme bitince kutu boşalır ve varsa gerçek taslak (+yanıt bağlamı) geri gelir

// ════════ emoji tepkileri (E2E — emoji şifreli; sunucu okuyamaz) ════════
const TEPKI_EMOJILER = ['👍','❤️','😂','😮','😢','🙏'];
async function tepkileriYukle(){
  TEPKILER = {};
  const {ok,d} = await api('/api/tepkiler?oda='+encodeURIComponent(ODA));
  if (!ok || !d) return;
  for (const mid in d){
    for (const kim in d[mid]){
      const e = coz(d[mid][kim]);                       // emoji'yi çöz (E2E); çözülemezse atla
      if (e && !e.startsWith('⟨')) (TEPKILER[mid]||(TEPKILER[mid]={}))[kim]=e;
    }
  }
  Object.keys(TEPKILER).forEach(tepkiSatiriCiz);
}
function tepkiOlayUygula(o){                              // SSE 'tepki' → yerel durum + satır güncelle
  if (!o.mid) return;
  const m = TEPKILER[o.mid] || (TEPKILER[o.mid]={});
  if (o.kaldir){ delete m[o.kim]; }
  else { const e = coz(o.blob); if (e && !e.startsWith('⟨')) m[o.kim]=e; }
  if (!Object.keys(m).length) delete TEPKILER[o.mid];
  tepkiSatiriCiz(o.mid);
}
function tepkiSatiriCiz(mid){                             // baloncuk altındaki tepki çiplerini (yeniden) çiz
  const el = document.querySelector(`#akis .msg[data-id="${mid}"]`); if (!el) return;
  const eski = el.querySelector('.tepki-satiri'); if (eski) eski.remove();
  const map = TEPKILER[mid]; if (!map || !Object.keys(map).length) return;
  const grup = {};                                        // emoji -> [kim...]
  for (const kim in map){ (grup[map[kim]]||(grup[map[kim]]=[])).push(kim); }
  const satir = document.createElement('div'); satir.className='tepki-satiri';
  for (const e in grup){
    const benim = grup[e].includes(BEN.kullanici);
    const chip = document.createElement('button'); chip.type='button';
    chip.className='tepki-chip'+(benim?' benim':'');
    chip.textContent = e + (grup[e].length>1 ? ' '+grup[e].length : '');
    chip.title = grup[e].map(gorAd).join(', ');
    chip.addEventListener('pointerdown', ev=>ev.stopPropagation());
    chip.onclick = (ev)=>{ ev.stopPropagation(); tepkiVer(mid, e); };
    satir.appendChild(chip);
  }
  el.appendChild(satir);
}
async function tepkiVer(mid, emoji){                      // toggle: aynı emoji → kaldır; farklı → değiştir
  if (!ODA) return; const od = ODA_BILGI[ODA]; if (!od) return;
  const mevcut = TEPKILER[mid] && TEPKILER[mid][BEN.kullanici];
  if (mevcut === emoji){                                  // kaldır (optimistik)
    if (TEPKILER[mid]){ delete TEPKILER[mid][BEN.kullanici]; if (!Object.keys(TEPKILER[mid]).length) delete TEPKILER[mid]; }
    tepkiSatiriCiz(mid);
    await api('/api/tepki', {method:'POST', body:JSON.stringify({oda:ODA, mid, kaldir:true})});
  } else {                                                // ekle/değiştir (optimistik)
    (TEPKILER[mid]||(TEPKILER[mid]={}))[BEN.kullanici]=emoji;
    tepkiSatiriCiz(mid);
    const blob = sifrele(emoji, od.uyeler);               // emoji E2E (mesaj gibi fan-out) — sunucu opak saklar
    await api('/api/tepki', {method:'POST', body:JSON.stringify({oda:ODA, mid, blob})});
  }
}
function tepkiSecAc(mid, anchor){                         // mesaja tepki için emoji seçici popup (hızlı 6 + ➕ ile genişleyen grid)
  document.querySelectorAll('.tepki-sec-pop').forEach(p=>p.remove());
  const pop = document.createElement('div'); pop.className='tepki-sec-pop';
  const yap = (e)=>{ pop.remove(); tepkiVer(mid, e); };
  const btnYap = (e)=>{ const b=document.createElement('button'); b.type='button'; b.textContent=e;
    b.addEventListener('pointerdown', ev=>ev.stopPropagation());
    b.onclick=(ev)=>{ ev.stopPropagation(); yap(e); }; return b; };
  const konumla = ()=>{ const r = anchor.getBoundingClientRect();
    pop.style.top = Math.max(8, r.top - pop.offsetHeight - 6) + 'px';
    pop.style.left = Math.max(8, Math.min(r.left - 50, window.innerWidth - pop.offsetWidth - 8)) + 'px'; };
  const hizli = document.createElement('div'); hizli.className='tepki-sec-hizli';
  TEPKI_EMOJILER.forEach(e=> hizli.appendChild(btnYap(e)));                 // hızlı 6 (davranış aynen)
  // ➕ → daha fazla emoji ile tepki (mevcut EMOJILER seti; hızlı-6 tekrarı hariç)
  const genis = document.createElement('div'); genis.className='tepki-sec-genis gizli';
  EMOJILER.filter(e=>!TEPKI_EMOJILER.includes(e)).forEach(e=> genis.appendChild(btnYap(e)));
  const arti = document.createElement('button'); arti.type='button'; arti.className='tepki-sec-arti';
  arti.textContent='➕'; arti.setAttribute('aria-label','Daha fazla emoji'); arti.setAttribute('aria-expanded','false');
  arti.addEventListener('pointerdown', ev=>ev.stopPropagation());
  arti.onclick=(ev)=>{ ev.stopPropagation(); const acik = genis.classList.toggle('gizli')===false;
    arti.setAttribute('aria-expanded', String(acik)); konumla(); };
  hizli.appendChild(arti);
  pop.append(hizli, genis);
  document.body.appendChild(pop);
  konumla();
  const kapat = (ev)=>{ if (!pop.contains(ev.target)){ pop.remove(); document.removeEventListener('pointerdown', kapat, true); } };
  setTimeout(()=>document.addEventListener('pointerdown', kapat, true), 0);
}

// ════════ medya (E2E foto/dosya) ════════
const MEDYA_MAX = 15 * 1024 * 1024;
function boyutStr(n){
  if (n < 1024) return n + ' B';
  if (n < 1024*1024) return (n/1024).toFixed(0) + ' KB';
  return (n/1024/1024).toFixed(1) + ' MB';
}
// dosya bytes → secretbox(K) ciphertext opak blob'a (POST /api/medya) + K her üyeye box fan-out (mesajda taşınır)
async function medyaGonder(file, ekstra={}){
  if (!file || !ODA) return;
  const od = ODA_BILGI[ODA]; if (!od) return;
  if (file.size > MEDYA_MAX){ toast('Dosya çok büyük (max 15MB)'); return; }
  toast('Gönderiliyor…');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const K = S.crypto_secretbox_keygen();
    const n = S.randombytes_buf(S.crypto_secretbox_NONCEBYTES);
    const cipher = S.crypto_secretbox_easy(bytes, n, K);
    const anahtarlar = [];
    for (const uye of od.uyeler){
      const pub = PUBKEYLER[uye]; if (!pub) continue;
      const n2 = S.randombytes_buf(S.crypto_box_NONCEBYTES);
      anahtarlar.push({uye, n2:b64(n2), anahtar:b64(S.crypto_box_easy(K, n2, ub64(pub), PRIV))});
    }
    const up = await fetch(API_KOK+'/api/medya', {method:'POST', credentials: API_KOK?'include':'same-origin',
      headers:{'content-type':'application/octet-stream', 'X-NarChat':'1'}, body: cipher});   // D1/L2: CSRF başlığı
    if (!up.ok){ toast(up.status===413 ? 'Dosya çok büyük' : 'Yükleme başarısız'); return; }
    const {medya_id} = await up.json();
    const blob = {sema:'e2e1m', medya_id, ad:file.name, mime:file.type||'application/octet-stream',
                  boyut:file.size, n:b64(n), gonderenPub:BEN.pubkey, anahtarlar, ...ekstra};
    await api('/api/mesaj', {method:'POST', body:JSON.stringify({oda:ODA, govde:blob, ...kaybolEk(ODA)})});
  } catch(e){ toast('Medya gönderilemedi'); }
}
// e2e1m mesajı → ciphertext'i çek + K'yı kendi anahtarınla çöz + secretbox_open → bytes
async function medyaCoz(blob){
  try {
    const benim = (blob.anahtarlar||[]).find(a=>a.uye===BEN.kullanici);
    if (!benim) return null;
    const K = S.crypto_box_open_easy(ub64(benim.anahtar), ub64(benim.n2), ub64(blob.gonderenPub), PRIV);
    const r = await fetch(API_KOK+'/api/medya?id='+encodeURIComponent(blob.medya_id), {credentials: API_KOK?'include':'same-origin'});
    if (!r.ok) return null;
    const cipher = new Uint8Array(await r.arrayBuffer());
    const bytes = S.crypto_secretbox_open_easy(cipher, ub64(blob.n), K);
    return {bytes, mime: blob.mime||'application/octet-stream', ad: blob.ad||'dosya', boyut: blob.boyut||bytes.length};
  } catch(e){ return null; }
}
// N7: sesli mesaj oynatma hızı — global (son seçilen sonraki notalara uygulanır), kalıcı
let SES_HIZ = 1; try { const v = parseFloat(localStorage.getItem('narchat_ses_hiz')); if ([1, 1.5, 2].includes(v)) SES_HIZ = v; } catch {}
const sesHizSonraki = (h) => h===1 ? 1.5 : h===1.5 ? 2 : 1;
const sesHizEtiket = (h) => h===1 ? '1×' : h===1.5 ? '1.5×' : '2×';
// N7: sesli mesaj dalga formu — WAV PCM'den (16-bit) N bar amplitüdü; WAV değilse nötr desen (yalnız görsel, işlevsiz)
function sesDalgaSeviyeleri(bytes, N){
  try {
    if (!bytes || bytes.length < 44) return null;
    const rif = String.fromCharCode(bytes[0],bytes[1],bytes[2],bytes[3]);
    const wav = String.fromCharCode(bytes[8],bytes[9],bytes[10],bytes[11]);
    if (rif!=='RIFF' || wav!=='WAVE') return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let off = 12, dataOff = -1, dataLen = 0, bits = 16;
    while (off + 8 <= bytes.length){
      const id = String.fromCharCode(bytes[off],bytes[off+1],bytes[off+2],bytes[off+3]);
      const sz = dv.getUint32(off+4, true);
      if (id==='fmt ') bits = dv.getUint16(off+22, true) || 16;
      if (id==='data'){ dataOff = off+8; dataLen = Math.min(sz, bytes.length-(off+8)); break; }
      off += 8 + sz + (sz & 1);
    }
    if (dataOff < 0 || bits !== 16) return null;
    const orn = Math.floor(dataLen/2); if (orn < N) return null;
    const seg = Math.floor(orn/N); const sev = new Array(N); let maks = 1;
    for (let b=0;b<N;b++){ let t=0,c=0; for (let i=0;i<seg;i++){ const s=dv.getInt16(dataOff+(b*seg+i)*2,true); t+=Math.abs(s); c++; } const o=c?t/c:0; sev[b]=o; if(o>maks)maks=o; }
    return sev.map(v=> Math.max(0.1, v/maks));
  } catch { return null; }
}
function sesDalgaCiz(bytes, N){
  const dalga = document.createElement('div'); dalga.className='ses-dalga';
  // a11y: klavye-erişilebilir seek slider'ı (native controls'un yerini tutar — universal tasarım)
  dalga.setAttribute('role','slider'); dalga.tabIndex=0; dalga.setAttribute('aria-label','Ses konumu');
  dalga.setAttribute('aria-valuemin','0'); dalga.setAttribute('aria-valuemax','100'); dalga.setAttribute('aria-valuenow','0');
  const sev = sesDalgaSeviyeleri(bytes, N) || Array.from({length:N},(_,i)=> 0.3 + 0.45*Math.abs(Math.sin(i*0.7)));
  sev.forEach(v=>{ const bar=document.createElement('span'); bar.className='ses-dalga-bar'; bar.style.height=Math.round(v*100)+'%'; dalga.appendChild(bar); });
  return dalga;
}

async function medyaGoster(kap, blob){
  const m = await medyaCoz(blob);
  if (!m){ kap.textContent = '⟨medya çözülemedi⟩'; return; }
  const url = URL.createObjectURL(new Blob([m.bytes], {type:m.mime}));
  kap.textContent = '';
  if ((m.mime||'').startsWith('image/')){
    const img = document.createElement('img'); img.className='medya-resim'; img.loading='lazy';
    img.src = url; img.alt = m.ad; img.onclick = ()=>lightboxAc(url, m.ad);   // FAZ G3: tam ekran görüntüleyici
    kap.appendChild(img);
  } else if (blob.sesli || (m.mime||'').startsWith('audio/')){
    const wrap = document.createElement('div'); wrap.className='ses-mesaj';
    // audio elementi playback MOTORU (native controls yok, gizli); özel oynatıcı sürer — "sohbet formatının en iyisi"
    const a = document.createElement('audio'); a.className='ses-oynatici'; a.hidden=true; a.preload='metadata'; a.src=url;
    a.playbackRate = SES_HIZ;
    a.addEventListener('play', ()=>{ a.playbackRate = SES_HIZ; });   // N7: bazı tarayıcılar oynatmada hızı sıfırlar
    // play/pause butonu
    const oynat = document.createElement('button'); oynat.type='button'; oynat.className='ses-oynat'; oynat.setAttribute('aria-label','Oynat'); oynat.textContent='▶';
    oynat.onclick = ()=>{ if (a.paused) a.play().catch(()=>{}); else a.pause(); };
    a.addEventListener('play',  ()=>{ oynat.textContent='⏸'; oynat.setAttribute('aria-label','Duraklat'); });
    a.addEventListener('pause', ()=>{ oynat.textContent='▶'; oynat.setAttribute('aria-label','Oynat'); });
    a.addEventListener('ended', ()=>{ oynat.textContent='▶'; oynat.setAttribute('aria-label','Oynat'); });
    // dalga formu (PCM'den) + oynatma ilerlemesi highlight + bara tıkla → seek
    const dalga = sesDalgaCiz(m.bytes, 32); const N = dalga.children.length;
    const seekOran = (oran)=>{ if (isFinite(a.duration) && a.duration) a.currentTime = Math.min(1,Math.max(0,oran))*a.duration; };
    dalga.addEventListener('click', (e)=>{ const r=dalga.getBoundingClientRect(); seekOran((e.clientX-r.left)/(r.width||1)); });
    dalga.addEventListener('keydown', (e)=>{                       // a11y: ok/Home/End ile klavye seek
      if (!(isFinite(a.duration) && a.duration)) return;
      const o = a.currentTime/a.duration;
      if (e.key==='ArrowRight') seekOran(o+0.05); else if (e.key==='ArrowLeft') seekOran(o-0.05);
      else if (e.key==='Home') seekOran(0); else if (e.key==='End') seekOran(1); else return;
      e.preventDefault(); });
    a.addEventListener('timeupdate', ()=>{ const oran=(isFinite(a.duration)&&a.duration)?a.currentTime/a.duration:0; const k=Math.round(oran*N);
      const bars=dalga.children; for (let i=0;i<bars.length;i++) bars[i].classList.toggle('calindi', i<k);
      dalga.setAttribute('aria-valuenow', String(Math.round(oran*100))); });
    wrap.append(a, oynat, dalga);
    if (blob.sure){ const s=document.createElement('span'); s.className='ses-mesaj-sure'; s.textContent=mmss(blob.sure); wrap.appendChild(s); }
    // N7: oynatma hızı — 1× → 1.5× → 2× döngü (uzun sesli notaları hızlı dinle); son hız global+kalıcı
    const hizBtn = document.createElement('button'); hizBtn.type='button'; hizBtn.className='ses-hiz'+(SES_HIZ!==1?' etkin':'');
    hizBtn.setAttribute('aria-label','Oynatma hızı'); hizBtn.textContent = sesHizEtiket(SES_HIZ);
    hizBtn.onclick = ()=>{ SES_HIZ = sesHizSonraki(SES_HIZ); try{ localStorage.setItem('narchat_ses_hiz', String(SES_HIZ)); }catch{}
      a.playbackRate = SES_HIZ; hizBtn.textContent = sesHizEtiket(SES_HIZ); hizBtn.classList.toggle('etkin', SES_HIZ!==1); };
    wrap.appendChild(hizBtn);
    kap.appendChild(wrap);
  } else {
    const a = document.createElement('a'); a.className='medya-dosya'; a.href = url; a.download = m.ad;
    a.textContent = '📎 '+m.ad+' · '+boyutStr(m.boyut);
    kap.appendChild(a);
  }
}
// FAZ G3: foto lightbox — baloncuktaki görsele dokun → tam ekran (tıkla→yakınlaştır, ✕/arka plan→kapat, ⬇ indir)
function lightboxKapat(){ const e=$('lightbox'); if (e) e.remove(); }
function lightboxAc(url, ad){
  lightboxKapat();
  const ov = document.createElement('div'); ov.className='lightbox'; ov.id='lightbox'; ov.onclick=lightboxKapat;
  const img = document.createElement('img'); img.className='lightbox-img'; img.src=url; img.alt=ad||'';
  let zoom=false; img.onclick=(e)=>{ e.stopPropagation(); zoom=!zoom; img.classList.toggle('zoom', zoom); };
  const kapat=document.createElement('button'); kapat.type='button'; kapat.className='lightbox-kapat'; kapat.setAttribute('aria-label','Kapat'); kapat.textContent='✕'; kapat.onclick=(e)=>{ e.stopPropagation(); lightboxKapat(); };
  const indir=document.createElement('a'); indir.className='lightbox-indir'; indir.href=url; indir.download=ad||'foto'; indir.setAttribute('aria-label','İndir'); indir.textContent='⬇'; indir.onclick=(e)=>e.stopPropagation();
  ov.append(img, kapat, indir); document.body.appendChild(ov);
}
// ════════ N7: MEDYA GALERİSİ — sohbet başına paylaşılan görsel + dosyalar (bilgi sheet'inden) ════════
// Tamamen YEREL: tüm geçmiş (since=0) çekilir, e2e1m medya mesajları burada çözülür (mevcut medyaCoz + lightboxAc
// yeniden kullanılır). Sunucuya/E2E'ye/mimariye DOKUNMAZ. Sesli notalar galeriye girmez. objectURL'ler kapanışta revoke.
function galeriKapat(urls){ const e=$('galeri'); if (e) e.remove(); (urls||[]).forEach(u=>{ try{ URL.revokeObjectURL(u); }catch{} }); }
// eşzamanlılık-sınırlı yükleyici: kalabalık galeride N medya için tek seferde en çok k çözme/fetch (thread/ağ patlamasını önle)
async function havuzKos(isler, k){
  let i = 0;
  const calis = async ()=>{ while (i < isler.length){ const j = isler[i++]; try { await j(); } catch {} } };
  await Promise.all(Array.from({length: Math.min(k, isler.length)}, calis));
}
async function medyaGaleriAc(oda){
  mesajMenuKapat();
  if (!oda) return;
  const eski=$('galeri'); if (eski) eski.remove();
  const URLS = [];
  const ov = document.createElement('div'); ov.className='galeri'; ov.id='galeri'; ov.tabIndex=-1;
  // Escape: galeri üstünde lightbox açıksa ÖNCE onu kapat (URL'leri revoke etme — açık lightbox bozulmasın); değilse galeriyi kapat
  ov.addEventListener('keydown', e=>{ if (e.key!=='Escape') return;
    if ($('lightbox')){ lightboxKapat(); return; } galeriKapat(URLS); });
  const bas = document.createElement('div'); bas.className='galeri-bas';
  const kapat = document.createElement('button'); kapat.type='button'; kapat.className='galeri-kapat'; kapat.setAttribute('aria-label','Kapat'); kapat.textContent='‹';
  kapat.onclick = ()=>galeriKapat(URLS);
  const bslk = document.createElement('b'); bslk.className='galeri-baslik'; bslk.textContent='Medya';
  bas.append(kapat, bslk); ov.appendChild(bas);
  const govde = document.createElement('div'); govde.className='galeri-govde';
  const yuk = document.createElement('p'); yuk.className='galeri-bos'; yuk.textContent='Yükleniyor…'; govde.appendChild(yuk);
  ov.appendChild(govde); document.body.appendChild(ov); ov.focus();
  // tüm geçmiş (since=0) — galeri açık sohbetin son sayfasıyla sınırlı kalmasın. Ağ hatası fetch'i fırlatabilir → sarmala.
  let r; try { r = await api('/api/mesajlar?oda='+encodeURIComponent(oda)+'&since=0'); } catch { r = {ok:false}; }
  if ($('galeri')!==ov) return;                          // kullanıcı bu arada kapattı/yeniden açtı
  if (!r.ok){                                            // ağ/sunucu hatası — gerçekten-boş odadan AYIR (sessizce "medya yok" deme)
    govde.innerHTML='';
    const kap=document.createElement('div'); kap.className='galeri-bos-kap';
    const t=document.createElement('p'); t.className='galeri-bos'; t.textContent='Medya yüklenemedi.';
    const yb=document.createElement('button'); yb.type='button'; yb.className='galeri-yeniden'; yb.textContent='Yeniden dene'; yb.onclick=()=>medyaGaleriAc(oda);
    kap.append(t, yb); govde.appendChild(kap); return;
  }
  const medyalar = (Array.isArray(r.d) ? r.d : [])
    .filter(m=> m && m.govde && m.govde.sema==='e2e1m' && !m.silindi
             && !m.govde.sesli && !(m.govde.mime||'').startsWith('audio/'))   // sesli notalar galeriye girmez
    .sort((a,b)=>(b.ts||0)-(a.ts||0));                    // en yeni önce
  const gorseller = medyalar.filter(m=>(m.govde.mime||'').startsWith('image/'));
  const dosyalar  = medyalar.filter(m=>!(m.govde.mime||'').startsWith('image/'));
  govde.innerHTML='';
  if (!gorseller.length && !dosyalar.length){
    const kap=document.createElement('div'); kap.className='galeri-bos-kap';
    const im=document.createElement('img'); im.className='galeri-bos-im'; im.src='/bos-durum.svg'; im.alt='';
    const t=document.createElement('p'); t.className='galeri-bos'; t.textContent='Bu sohbette henüz medya paylaşılmadı.';
    kap.append(im,t); govde.appendChild(kap); return;
  }
  const isler = [];                                       // çözme/fetch işleri — havuzla sınırlı eşzamanlılıkta koşulur
  if (gorseller.length){
    const bl=document.createElement('div'); bl.className='galeri-bolum-bas'; bl.textContent='Görseller ('+gorseller.length+')'; govde.appendChild(bl);
    const grid=document.createElement('div'); grid.className='galeri-grid'; govde.appendChild(grid);
    gorseller.forEach(m=>{
      const tile=document.createElement('button'); tile.type='button'; tile.className='galeri-gorsel'; tile.setAttribute('aria-label', m.govde.ad||'görsel'); grid.appendChild(tile);
      isler.push(()=>{ if ($('galeri')!==ov) return; return medyaCoz(m.govde).then(res=>{
        if ($('galeri')!==ov) return;
        if (!res){ tile.classList.add('yok'); return; }   // çözülemedi → görünür uyarı (::after ⚠)
        const url=URL.createObjectURL(new Blob([res.bytes],{type:res.mime})); URLS.push(url);
        const img=new Image(); img.loading='lazy'; img.src=url; img.alt=res.ad||''; tile.appendChild(img);
        tile.onclick=()=>lightboxAc(url, res.ad);
      }); });
    });
  }
  if (dosyalar.length){
    const bl=document.createElement('div'); bl.className='galeri-bolum-bas'; bl.textContent='Dosyalar ('+dosyalar.length+')'; govde.appendChild(bl);
    const lst=document.createElement('div'); lst.className='galeri-dosyalar'; govde.appendChild(lst);
    dosyalar.forEach(m=>{
      const row=document.createElement('a'); row.className='galeri-dosya'; row.download=m.govde.ad||'dosya';
      const ik=document.createElement('span'); ik.className='galeri-dosya-ik'; ik.textContent='📎';
      const ad=document.createElement('span'); ad.className='galeri-dosya-ad'; ad.textContent=m.govde.ad||'dosya';
      const by=document.createElement('span'); by.className='galeri-dosya-boyut'; by.textContent=m.govde.boyut?boyutStr(m.govde.boyut):'';
      row.append(ik,ad,by); lst.appendChild(row);
      isler.push(()=>{ if ($('galeri')!==ov) return; return medyaCoz(m.govde).then(res=>{
        if ($('galeri')!==ov) return;
        if (!res){ row.classList.add('yok'); ik.textContent='⚠'; return; }   // çözülemedi → ölü link yerine görünür uyarı
        const url=URL.createObjectURL(new Blob([res.bytes],{type:res.mime})); URLS.push(url);
        row.href=url;
      }); });
    });
  }
  await havuzKos(isler, 4);
}
// ════════ FAZ G4: bildirim sesi + okunmamış rozet ════════
let SES_UYARI = true; try { SES_UYARI = localStorage.getItem('narchat_ses_uyari')!=='0'; } catch {}
let ONCEKI_OKUNMAMIS = 0;
function bipCal(){
  if (!SES_UYARI) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = new AC(); const o=c.createOscillator(), g=c.createGain();
    o.type='sine'; o.connect(g); g.connect(c.destination);
    const t=c.currentTime; g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.13, t+0.02);
    o.frequency.setValueAtTime(660,t); o.frequency.setValueAtTime(880,t+0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.3);
    o.start(t); o.stop(t+0.32); setTimeout(()=>{ try{c.close();}catch{} }, 600);
  } catch {}
}
function okunmamisToplam(sessizHaric){
  let n=0; for (const od of (ODALAR||[])){
    if (sessizHaric && sessizMi(od.oda)) continue;                                   // N7: ses kararında sessiz odaları sayma
    if (od.son_ts && od.son_ts>(GORULEN[od.oda]||0) && od.son_gonderen!==BEN.kullanici) n++; }
  return n;
}
function okunmamisGuncelle(){
  const n = okunmamisToplam();                                // başlık/rozet = TÜM okunmamış (sessiz dahil — görsel kalır)
  document.title = n>0 ? `(${n}) NarChat` : 'NarChat — özel ekip sohbeti';
  try { if (navigator.setAppBadge){ n>0 ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } } catch {}
  const nSesli = okunmamisToplam(true);                        // N7: ses YALNIZ sessiz-olmayan odalar için
  if (nSesli > ONCEKI_OKUNMAMIS && document.hidden) bipCal();  // arka-plan sohbetinde yeni okunmamış → ses
  ONCEKI_OKUNMAMIS = nSesli;
  try { window.__okunmamis = { toplam: n, sesli: nSesli }; } catch {}   // izole test kancası (sessize-al ses-kararı doğrulaması)
}
function sesUyariGuncelle(){ const b=$('sesUyariBtn'); if (b) b.textContent = SES_UYARI ? 'Açık' : 'Kapalı'; }
function sesUyariToggle(){ SES_UYARI = !SES_UYARI; try{ localStorage.setItem('narchat_ses_uyari', SES_UYARI?'1':'0'); }catch{} sesUyariGuncelle(); }

// G8: gizlilik tercih düğmeleri (Ayarlar) — etiketleri tazele
function gizlilikGuncelle(){
  const bs=$('gizliSonBtn'); if (bs) bs.textContent = GIZLILIK.son ? 'Açık' : 'Kapalı';
  const bo=$('gizliOkunduBtn'); if (bo) bo.textContent = GIZLILIK.okundu ? 'Açık' : 'Kapalı';
}
async function gizlilikDegistir(alan){
  const yeni = !GIZLILIK[alan]; GIZLILIK[alan] = yeni; gizlilikGuncelle();   // iyimser
  const {ok,d} = await api('/api/gizlilik', {method:'POST', body:JSON.stringify({[alan]:yeni})});
  if (ok && d && d.gizlilik){ GIZLILIK = {son:d.gizlilik.son!==false, okundu:d.gizlilik.okundu!==false}; }
  else { GIZLILIK[alan] = !yeni; toast('Kaydedilemedi'); }   // geri al
  gizlilikGuncelle();
  if (alan==='okundu' && ODA) { try { odaAc(ODA); } catch {} }   // açık sohbette ✓✓ görünürlüğünü tazele (tam yeniden çiz)
}

function medyaOnizleEtiket(blob){
  if (blob.sesli || (blob.mime||'').startsWith('audio/')) return '🎤 Sesli mesaj';
  return (blob.mime||'').startsWith('image/') ? '🖼 Foto' : '📎 '+(blob.ad||'Dosya');
}
function mmss(s){ s=Math.max(0,Math.round(s)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }

// ════════ FAZ F1: SESLİ MESAJ (bas-kaydet, E2E) ════════
// Kayıt = WAV 16kHz mono PCM (Web Audio). NEDEN WAV: MediaRecorder webm/opus üretir, iOS Safari onu
// ÇALAMAZ → cross-platform kırılır. WAV her tarayıcıda çalar (interop garantisi). Ses, mevcut E2E medya
// pipeline'ından gider (secretbox+fan-out, /api/medya opak blob) → sunucu düz ses GÖRMEZ.
const SES_MAX_SN = 240;                  // max 4 dk (~7.7MB @16kHz mono PCM16 < 15MB)
let SES = null;                          // aktif kayıt durumu
async function sesKayitBaslat(){
  if (SES || !ODA) return;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({audio:true}); }
  catch { toast('Mikrofon izni gerekli'); return; }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx){ toast('Tarayıcı ses kaydını desteklemiyor'); try{stream.getTracks().forEach(t=>t.stop());}catch{} return; }
  const ctx = new Ctx(); try { await ctx.resume(); } catch {}
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const sessiz = ctx.createGain(); sessiz.gain.value = 0;   // grafiği canlı tut ama hoparlöre verme (echo yok)
  const parcalar = [];
  proc.onaudioprocess = (e)=>{ parcalar.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
  src.connect(proc); proc.connect(sessiz); sessiz.connect(ctx.destination);
  SES = { ctx, src, proc, sessiz, stream, parcalar, oran: ctx.sampleRate, baslangic: performance.now(), timer:null };
  $('komp').classList.add('kayitta'); $('sesKayitBar').classList.remove('gizli'); $('sesKayitSure').textContent='0:00';
  SES.timer = setInterval(()=>{ if(!SES) return; const s=(performance.now()-SES.baslangic)/1000;
    $('sesKayitSure').textContent = mmss(s); if (s>=SES_MAX_SN) sesKayitBitir(true); }, 250);
}
function sesKayitTemizle(){
  if (!SES) return;
  if (SES.timer) clearInterval(SES.timer);
  try { SES.proc.disconnect(); SES.src.disconnect(); SES.sessiz.disconnect(); } catch {}
  try { SES.stream.getTracks().forEach(t=>t.stop()); } catch {}
  try { SES.ctx.close(); } catch {}
  $('komp').classList.remove('kayitta'); $('sesKayitBar').classList.add('gizli');
}
async function sesKayitBitir(gonder){
  if (!SES) return;
  const { parcalar, oran, baslangic } = SES;
  const sure = (performance.now()-baslangic)/1000;
  sesKayitTemizle(); SES = null;
  if (!gonder) return;
  if (sure < 1){ toast('Çok kısa'); return; }
  const wav = wavYap(parcalar, oran, 16000);
  if (wav.size > MEDYA_MAX){ toast('Sesli mesaj çok uzun'); return; }
  const dosya = new File([wav], 'ses-mesaji.wav', {type:'audio/wav'});
  await medyaGonder(dosya, {sesli:true, sure:Math.round(sure)});
}
// Float32 parçaları → (downsample) → 16-bit PCM WAV blob
function wavYap(parcalar, oranGiris, oranHedef){
  let uz=0; for (const p of parcalar) uz+=p.length;
  const tum = new Float32Array(uz); let o=0; for (const p of parcalar){ tum.set(p,o); o+=p.length; }
  const dusur = oranHedef && oranHedef < oranGiris;
  const veri = dusur ? sesDownsample(tum, oranGiris, oranHedef) : tum;
  const oran = dusur ? oranHedef : oranGiris;
  const buf = new ArrayBuffer(44 + veri.length*2), dv = new DataView(buf);
  const yaz=(off,s)=>{ for(let i=0;i<s.length;i++) dv.setUint8(off+i, s.charCodeAt(i)); };
  yaz(0,'RIFF'); dv.setUint32(4, 36+veri.length*2, true); yaz(8,'WAVE');
  yaz(12,'fmt '); dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,1,true);
  dv.setUint32(24,oran,true); dv.setUint32(28,oran*2,true); dv.setUint16(32,2,true); dv.setUint16(34,16,true);
  yaz(36,'data'); dv.setUint32(40, veri.length*2, true);
  let off=44; for(let i=0;i<veri.length;i++){ let s=Math.max(-1,Math.min(1,veri[i])); dv.setInt16(off, s<0?s*0x8000:s*0x7FFF, true); off+=2; }
  return new Blob([buf], {type:'audio/wav'});
}
function sesDownsample(veri, giris, hedef){
  const oran = giris/hedef, uz = Math.round(veri.length/oran), cik = new Float32Array(uz);
  for (let i=0;i<uz;i++){ const bas=Math.floor(i*oran), son=Math.min(veri.length, Math.floor((i+1)*oran));
    let t=0,c=0; for(let j=bas;j<son;j++){ t+=veri[j]; c++; } cik[i]=c?t/c:0; }
  return cik;
}

// ════════ Web Push (offline bildirim) ════════
function _urlB64ToU8(s){
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const raw = atob((s + pad).replace(/-/g,'+').replace(/_/g,'/'));
  const arr = new Uint8Array(raw.length);
  for (let i=0;i<raw.length;i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
// Var olan izinle sessiz abone (otomatik izin İSTEMEZ — Marcus/Tayfun kararı). İzin = açık buton.
async function pushAboneSessiz(){
  try{
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    await _pushKur();
  }catch(e){}
}
async function _pushKur(){
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub){
    const {ok,d} = await api('/api/vapid');
    if (!ok || !d.pubkey) return false;
    sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:_urlB64ToU8(d.pubkey)});
  }
  await api('/api/push-abone', {method:'POST', body:JSON.stringify({subscription: sub.toJSON()})});
  return true;
}
// Açık bildirim isteği (kullanıcı butona basınca).
async function bildirimIste(){
  if (!('Notification' in window)){ toast('Bu tarayıcı bildirim desteklemiyor'); return; }
  if (Notification.permission === 'denied'){ toast('Bildirim izni reddedilmiş — tarayıcı ayarından aç'); bildirimDurumGuncelle(); return; }
  let izin = Notification.permission;
  if (izin !== 'granted') izin = await Notification.requestPermission();
  if (izin === 'granted'){ await _pushKur(); toast('🔔 Bildirimler açık'); }
  else toast('Bildirime izin verilmedi');
  bildirimDurumGuncelle();
}
function bildirimDurumGuncelle(){
  const izin = ('Notification' in window) ? Notification.permission : 'default';
  const ac = ('Notification' in window) && izin === 'granted';
  const dEl = $('bildirimDurum'), bEl = $('bildirimAyarBtn');
  if (dEl) dEl.textContent = ac ? 'Açık — yeni mesajlarda uyarılırsın' : 'Kapalı — yeni mesajları kaçırma';
  if (bEl){ bEl.textContent = ac ? 'Açık ✓' : 'Aç'; bEl.disabled = ac; }
}

// ════════ Ayarlar: uygulama kilidi (açılışta parola iste) — OPSİYONEL, varsayılan KAPALI ════════
async function kilitDurumGuncelle(){
  if (!BEN) return;
  const acik = await kilitModuAcikMi(BEN.kullanici);
  const dEl = $('kilitDurum'), bEl = $('kilitToggleBtn');
  if (dEl) dEl.textContent = acik ? 'Açık — her açılışta parola sorulur' : 'Kapalı — açılışta parola sorulmaz';
  if (bEl){ bEl.textContent = acik ? 'Kapat' : 'Aç'; bEl.dataset.acik = acik ? '1' : ''; }
  if (!acik) $('kilitKurPanel')?.classList.add('gizli');
}
async function kilitToggle(){
  if (!PRIV){ toast('Önce uygulamayı aç'); return; }
  if ($('kilitToggleBtn').dataset.acik){
    await _anahtarSakla(BEN.kullanici, PRIV, BEN.pubkey);        // KAPAT → cihaz modu (parolasız)
    toast('Uygulama kilidi kapatıldı');
    kilitDurumGuncelle();
  } else {
    $('kilitKurPanel').classList.toggle('gizli');               // AÇ → parola belirleme paneli
    if (!$('kilitKurPanel').classList.contains('gizli')) $('kilitParolaIn').focus();
  }
}
async function kilitKaydet(){
  const p = $('kilitParolaIn').value;
  if (p.length < 4){ toast('En az 4 haneli parola'); return; }
  if (!PRIV){ toast('Önce uygulamayı aç'); return; }
  await _anahtarSakla(BEN.kullanici, PRIV, BEN.pubkey, p);       // parola modu (Argon2id kilit)
  $('kilitParolaIn').value=''; $('kilitKurPanel').classList.add('gizli');
  toast('🔒 Uygulama kilidi açıldı — sonraki açılışta parola sorulacak');
  kilitDurumGuncelle();
}

// ════════ UI yardımcıları ════════
function avatarRenk(ad){
  let h = 0; for (let i=0;i<ad.length;i++) h = (h*31 + ad.charCodeAt(i)) % 360;
  return `hsl(${h} 58% 48%)`;
}
function basHarf(ad){ return (ad||'?').replace(/^@/,'').slice(0,1).toUpperCase(); }
function gorAd(kullanici){ return ADLAR[kullanici] || ('@'+kullanici); }   // görünen ad ya da @kullanıcı
function avatarKur(el, ad, grup, kullanici, odAvatar){
  el.classList.remove('foto', 'grup'); el.style.backgroundImage = '';
  el.textContent = grup ? '' : basHarf(ad);
  el.style.setProperty('--av', grup ? 'var(--gold)' : avatarRenk(ad));
  if (grup){
    if (odAvatar){ el.classList.add('foto'); el.textContent=''; el.style.backgroundImage = 'url('+odAvatar+')'; }   // H3: grup fotoğrafı
    else { el.classList.add('grup'); el.textContent = '👥'; }
    return;
  }
  if (kullanici && AVATARLI.has(kullanici)){   // profil fotoğrafı varsa onu göster
    el.classList.add('foto'); el.textContent = '';
    if (API_KOK){
      // FAZ N3: native'de CSS background-image cross-origin isteği çerez taşımayabilir →
      // authlu fetch+ObjectURL (grup fotoğrafı zaten data-URL olduğu için yukarıdaki dal etkilenmez).
      fetch(API_KOK+'/api/avatar?u='+encodeURIComponent(kullanici), {credentials:'include'})
        .then(r => r.ok ? r.blob() : null)
        .then(b => { if (b) el.style.backgroundImage = 'url('+URL.createObjectURL(b)+')'; })
        .catch(()=>{});
    } else {
      el.style.backgroundImage = 'url(/api/avatar?u='+encodeURIComponent(kullanici)+')';
    }
  }
}
function pad2(n){ return String(n).padStart(2,'0'); }
function zamanStr(ts){ const d = new Date(ts*1000); return pad2(d.getHours())+':'+pad2(d.getMinutes()); }
function gunKey(ts){ const d = new Date(ts*1000); return d.getFullYear()+'-'+d.getMonth()+'-'+d.getDate(); }
function gunStr(ts){
  const d = new Date(ts*1000), b = new Date(); b.setHours(0,0,0,0);
  const fark = Math.round((b - new Date(d).setHours(0,0,0,0)) / 86400000);
  if (fark === 0) return 'Bugün';
  if (fark === 1) return 'Dün';
  return pad2(d.getDate())+'.'+pad2(d.getMonth()+1)+'.'+d.getFullYear();
}
function toast(msg){
  let t = document.querySelector('.toast');
  if (t) t.remove();
  t = document.createElement('div'); t.className='toast'; t.textContent=msg;
  t.setAttribute('role','status'); t.setAttribute('aria-live','polite');   // erişilebilirlik: ekran-okuyucu duyurusu
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2600);
}
try { window.__toast = toast; } catch {}   // izole test kancası (toast ARIA doğrulaması)

// ════════ tema ════════
function temaUygula(t){
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  document.querySelectorAll('#temaSegment button').forEach(b =>
    b.classList.toggle('aktif', b.dataset.tema === t));
  try { localStorage.setItem('narchat_tema', t); } catch {}
}
function temaYukle(){ let t='auto'; try{ t = localStorage.getItem('narchat_tema')||'auto'; }catch{} temaUygula(t); }

// ════════ erişilebilirlik: yazı boyu + yüksek kontrast (universal tasarım) ════════
function yaziUygula(boy){
  const b = ['kucuk','normal','buyuk'].includes(boy) ? boy : 'normal';
  if (b === 'normal') document.documentElement.removeAttribute('data-yazi');
  else document.documentElement.setAttribute('data-yazi', b);
  document.querySelectorAll('#yaziSegment button').forEach(x =>
    x.classList.toggle('aktif', x.dataset.yazi === b));
  try { localStorage.setItem('narchat_yazi', b); } catch {}
}
function yaziYukle(){ let b='normal'; try{ b = localStorage.getItem('narchat_yazi')||'normal'; }catch{} yaziUygula(b); }
function kontrastUygula(on){
  if (on) document.documentElement.setAttribute('data-kontrast','yuksek');
  else document.documentElement.removeAttribute('data-kontrast');
  const btn = $('kontrastBtn');
  if (btn){ btn.textContent = on ? 'Açık' : 'Kapalı'; btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  try { localStorage.setItem('narchat_kontrast', on ? '1' : '0'); } catch {}
}
function kontrastYukle(){ let on=false; try{ on = localStorage.getItem('narchat_kontrast')==='1'; }catch{} kontrastUygula(on); }
// N7: renk teması varyantı (nar/okyanus/orman) — yalnız aksan; localStorage + boot (yazı boyu deseni)
function paletUygula(p){
  const gecerli = ['okyanus','orman'].includes(p) ? p : 'nar';
  if (gecerli === 'nar') document.documentElement.removeAttribute('data-palet');
  else document.documentElement.setAttribute('data-palet', gecerli);
  document.querySelectorAll('#paletSegment button').forEach(x =>
    x.classList.toggle('aktif', x.dataset.palet === gecerli));
  try { localStorage.setItem('narchat_palet', gecerli); } catch {}
}
function paletYukle(){ let p='nar'; try{ p = localStorage.getItem('narchat_palet')||'nar'; }catch{} paletUygula(p); }

// ════════ görünüm navigasyonu ════════
function gorunumGec(ad){
  ['sohbetler','aramalar','kisiler','ayarlar'].forEach(g => {
    const el = $('gorunum-'+g);
    if (el) el.classList.toggle('gizli', g !== ad);
  });
  document.querySelectorAll('#altNav button').forEach(b =>
    b.classList.toggle('aktif', b.dataset.gor === ad));
  $('altNav').classList.remove('gizli');
  if (ad === 'aramalar') {
    aramaRozetiGuncelle(true);
    aramaGecmisiCiz();
  }
}
function odaGorunumAc(){ $('gorunum-oda').classList.remove('gizli'); $('altNav').classList.add('gizli'); }
function odaGorunumKapat(){
  $('gorunum-oda').classList.add('gizli'); $('altNav').classList.remove('gizli');
  if (ES){ ES.close(); ES = null; } ODA = null;
}

// ════════ N5: NarcOsystem vitrini (tanıtım/reklam motoru — ayrı ürünlerimiz, misyonun kalbi) ════════
function narcosystemAc(){
  $('gorunum-narcosystem').classList.remove('gizli'); $('altNav').classList.add('gizli');
  narcosystemYukle();
}
function narcosystemKapat(){
  $('gorunum-narcosystem').classList.add('gizli'); $('altNav').classList.remove('gizli');
}
async function narcosystemYukle(){
  const {ok, d} = await api('/api/duyurular');
  narcosystemCiz((ok && d && Array.isArray(d.urunler)) ? d.urunler : []);
}
// N5: yalnız http(s) şemasına izin — javascript:/data: gibi şemalar engellenir (metinYaz/link.mjs ile aynı XSS disiplini)
const guvenliUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
function narcosystemCiz(urunler){
  const liste = (urunler || []).filter(u => u && typeof u === 'object');   // bozuk/null öğe → atla (map çökmesin)
  $('narcosystemBos').classList.toggle('gizli', liste.length > 0);
  $('narcosystemListe').innerHTML = liste.map(u =>
    '<a class="satir" href="' + esc(guvenliUrl(u.url)) + '" target="_blank" rel="noopener noreferrer">' +
      '<div class="avatar">' + esc(u.ikon || '🔹') + '</div>' +
      '<div class="govde"><div class="ust"><span class="ad">' + esc(u.ad || '') + '</span>' +
        (u.etiket ? '<span class="saat">' + esc(u.etiket) + '</span>' : '') + '</div>' +
      '<small>' + esc(u.aciklama || '') + '</small></div>' +
    '</a>'
  ).join('');
}

// ════════ giriş / kayıt ════════
async function girisYap(yeni){
  const kullanici = $('gKullanici').value.trim().toLowerCase();
  const parola = $('gParola').value;
  const davet = $('gDavet').value.trim();
  $('gHata').textContent='';
  if (!kullanici || parola.length < 4){ $('gHata').textContent = 'kullanıcı + en az 4 hane parola'; return; }
  let ok, d;
  if (yeni){
    // FAZ N1: kayıt hep sıfır-bilgi (v2) — parola sunucuya HİÇ gitmez, yalnız paroladan türetilmiş
    // Ed25519 public "doğrulayıcı" gider (auth.js). Bu, mesaj-şifreleme anahtarından (PRIV) ayrıdır.
    const dogrulayici = dogrulayiciUret(kullanici, parola);   // D1/M1: varsayılan = en güçlü KDF profili
    ({ok,d} = await api('/api/kayit', {method:'POST', body:JSON.stringify({kullanici, dogrulayici, kdf: KDF_VARSAYILAN, davet})}));
  } else {
    // Giriş: önce sunucudan meydan+hesabın şeması alınır. v2 → imzala (parola gitmez);
    // v1 (henüz göçmemiş eski hesap) → fallback olarak parola gönderilir, başarılı girişte yükseltilir.
    const meydanIstek = await api('/api/giris-meydan?kullanici='+encodeURIComponent(kullanici));
    if (!meydanIstek.ok){ $('gHata').textContent = 'sunucuya ulaşılamadı'; return; }
    const m = meydanIstek.d;
    if (m.surum === 2){
      // D1/M1: hesabın KENDİ profiliyle imzala. Profil eskiyse (INTERACTIVE), aynı istekte yeni-profil
      // doğrulayıcısını da yolla → sunucu imzayı (parola kanıtı) doğrulayınca profili güvenle yükseltir.
      const profil = m.kdf || 1;
      const imza = meydanImzala(kullanici, parola, m.meydan, profil);
      const govde = {kullanici, meydan:m.meydan, imza};
      if (profil < KDF_VARSAYILAN){
        govde.yeni_dogrulayici = dogrulayiciUret(kullanici, parola, KDF_VARSAYILAN);
        govde.yeni_kdf = KDF_VARSAYILAN;
      }
      ({ok,d} = await api('/api/giris', {method:'POST', body:JSON.stringify(govde)}));
    } else {
      ({ok,d} = await api('/api/giris', {method:'POST', body:JSON.stringify({kullanici, parola})}));
    }
  }
  if (!ok){ $('gHata').textContent = (d&&d.hata)||'hata'; return; }
  BEN = {kullanici:d.kullanici, pubkey:d.pubkey};
  if (!yeni && d.surum === 1){
    // Göç: v1 hesap başarıyla girdi → aynı paroladan v2 doğrulayıcı türetip sessizce yükselt (sıfır kesinti).
    try { await api('/api/auth-yukselt', {method:'POST', body:JSON.stringify({dogrulayici: dogrulayiciUret(kullanici, parola), kdf: KDF_VARSAYILAN})}); } catch {}   // D1/M1: doğrulayıcı KDF_VARSAYILAN profiliyle türetildi → aynı profili kaydet
  }
  try {
    if (yeni){
      BEN.pubkey = await anahtarUret(kullanici);                  // varsayılan: cihaz modu (parolasız aç)
      await api('/api/anahtar', {method:'POST', body:JSON.stringify({pubkey:BEN.pubkey})});
    } else {
      const r = await anahtarYukle(kullanici);
      if (r === 'KILITLI'){
        try { BEN.pubkey = await anahtarParolaAc(kullanici, parola); }   // kilit parolası = hesap parolası ise açar
        catch { return kilitGoster(); }                                  // farklı kilit parolası → kilit ekranı
        if (!d.pubkey) await api('/api/anahtar', {method:'POST', body:JSON.stringify({pubkey:BEN.pubkey})});
      } else if (r){
        BEN.pubkey = r;                                           // cihaz modu → parolasız yüklendi
        if (!d.pubkey) await api('/api/anahtar', {method:'POST', body:JSON.stringify({pubkey:BEN.pubkey})});
      } else if (d.pubkey){
        return baglaGoster();                                    // anahtar başka cihazda → CİHAZ BAĞLA (üretme!)
      } else {
        BEN.pubkey = await anahtarUret(kullanici);               // ilk cihaz → üret
        await api('/api/anahtar', {method:'POST', body:JSON.stringify({pubkey:BEN.pubkey})});
      }
    }
  } catch(e){ $('gHata').textContent = 'anahtar açılamadı'; return; }
  acilisYap();
}

async function oturumKontrol(){
  const {ok,d} = await api('/api/ben');
  if (!ok) return girisGoster();   // oturum yok → giriş ekranını AÇ (splash kapanır)
  BEN = d;
  const r = await anahtarYukle(BEN.kullanici);
  if (r === 'KILITLI') return kilitGoster();             // kilit modu (ya da eski kayıt) → parola iste
  if (r){ BEN.pubkey = r; return acilisYap(); }          // cihaz modu → PAROLASIZ aç (her-açılış sormaz)
  if (BEN.pubkey) return baglaGoster();                  // anahtar başka cihazda → cihaz bağla
  girisGoster();                                         // (kenar) anahtar ne burada ne sunucuda → giriş
}
function girisGoster(){
  ['splash','kilitEkran','baglaEkran','sohbet'].forEach(id => $(id).classList.add('gizli'));
  $('girisEkran').classList.remove('gizli');
}

function kilitGoster(){
  ['splash','girisEkran','baglaEkran','sohbet'].forEach(id => $(id).classList.add('gizli'));
  $('kilitEkran').classList.remove('gizli');
  $('kKullanici').textContent = '@'+BEN.kullanici;
  $('kParola').value=''; $('kHata').textContent=''; $('kParola').focus();
}
async function kilitAc(){
  const parola = $('kParola').value;
  $('kHata').textContent='';
  try { BEN.pubkey = await anahtarParolaAc(BEN.kullanici, parola); }
  catch(e){ $('kHata').textContent = 'hatalı parola'; return; }
  acilisYap();
}

// ── cihaz-bağlama ekranı (yeni cihaz: hesabın anahtarını buraya getir) ──
function baglaGoster(){
  ['splash','girisEkran','kilitEkran','sohbet'].forEach(id => $(id).classList.add('gizli'));
  $('baglaEkran').classList.remove('gizli');
  $('bKullanici').textContent = '@'+BEN.kullanici;
  $('bKod').value = (window.__BEKLEYEN_KOD || ''); window.__BEKLEYEN_KOD = '';
  $('bHata').textContent = '';
  if ($('bKod').value) return baglaGonder();   // bağlantı (#k=) ile gelindi → oto-dene
  $('bKod').focus();
}
function _kodAyikla(ham){
  const parts = String(ham).toUpperCase().replace(/[.·]/g,'-').split(/[-\s]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const kanal = parts[0], cumle = parts.slice(1).join('');
  if (kanal.length < 5 || cumle.length < 10) return null;
  return {kanal, cumle};
}
async function baglaGonder(){
  $('bHata').textContent = '';
  const k = _kodAyikla($('bKod').value.trim());
  if (!k){ $('bHata').textContent = 'bağlama kodu hatalı görünüyor'; return; }
  try {
    BEN.pubkey = await cihazAnahtarGetir(k.kanal, k.cumle);
  } catch(e){ $('bHata').textContent = 'kod geçersiz ya da süresi dolmuş'; return; }
  acilisYap();
}
async function baglaYeniAnahtar(){
  $('bHata').textContent = '';
  if (!confirm('Bu cihazda YENİ bir anahtar oluşturulacak. Hesabının eski mesajları ve diğer cihazları artık okunamayabilir. Devam edilsin mi?')) return;
  try {
    BEN.pubkey = await anahtarUret(BEN.kullanici);
    await api('/api/anahtar', {method:'POST', body:JSON.stringify({pubkey:BEN.pubkey})});
  } catch(e){ $('bHata').textContent = 'anahtar oluşturulamadı'; return; }
  acilisYap();
}

function acilisYap(){
  // tüm giriş ekranlarını gizle — baglaEkran DAHİL (yoksa bağlama sonrası ekran ikiye bölünür)
  ['splash','girisEkran','kilitEkran','baglaEkran'].forEach(id => $(id).classList.add('gizli'));
  $('sohbet').classList.remove('gizli');
  $('benKim').textContent = '@'+BEN.kullanici;
  avatarKur($('benAvatar'), BEN.kullanici, false, BEN.kullanici);
  gorunumGec('sohbetler');
  bildirimDurumGuncelle();
  kilitDurumGuncelle();          // Ayarlar: uygulama kilidi durumu
  const sinyalGonderFn = (oda, s) => api('/api/sinyal', {method:'POST', body:JSON.stringify({oda, sinyal:s})});
  aramaInit({
    sinyalGonderFn,
    benKullanici: BEN.kullanici, uiGuncelle: aramaUI, uzakSes: $('uzakSes'),
    uzakVideo: $('uzakVideo'), yerelVideo: $('yerelVideo'),
  });
  grupInit({ sinyalGonderFn, benKullanici: BEN.kullanici, uiGuncelle: grupUI });   // H2: grup mesh arama
  kisiselAkisBagla();        // gelen arama her ekranda çalsın (açık oda gerekmez)
  yenile();
  pushAboneSessiz();         // yalnız izin zaten verildiyse (otomatik İSTEMEZ)
  nabizBasla();              // çevrimiçi nabzı (hafif, açıkken)
  if (KUYRUK.length){ kuyrukDene(); kuyrukZamanla(); }   // FAZ G1: önceki oturumdan bekleyen mesajları gönder
}

// ════════ FAZ E: arama UI ════════
// Gelen ekranı (#gelenArama) + TAM EKRAN arama ekranı (#aramaSahne, ses / #videoSahne, görüntü)
// + app-düzeyi 'devam eden arama' mini şeridi (#aramaMini). Geri/küçült aramayı KAPATMAZ; ses #uzakSes
// body düzeyinde yaşar. Süre 'konusuyor'da başlar. Kontroller: mute (track.enabled) + hoparlör/ahize.
let ARAMA_KUCUK = false;                       // arama ekranı küçültüldü mü (mini şeride indi mi)
let aramaSure0 = 0, aramaSureTimer = null;     // görüşme başlangıç ts + saniye sayacı

function aramaSureMetin(){
  if (!aramaSure0) return '00:00';
  const s = Math.max(0, Math.floor((Date.now() - aramaSure0) / 1000));
  return String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0');
}
function aramaSureCiz(){
  const t = aramaSureMetin();
  ['aramaSahneSure','aramaMiniSure','videoSure'].forEach(id => { const el = $(id); if (el) el.textContent = t; });
}
function aramaSureBaslat(){ if (!aramaSure0) aramaSure0 = Date.now(); if (!aramaSureTimer) aramaSureTimer = setInterval(aramaSureCiz, 1000); aramaSureCiz(); }
function aramaSureDur(){ if (aramaSureTimer){ clearInterval(aramaSureTimer); aramaSureTimer = null; } }

// kiminle konuşuyoruz: gelen aramada arayan; gidende aktif odanın diğer (1:1) üyesi
function aramaKarsi(){
  try { const g = aramaArayan(); if (g) return g; } catch {}
  let oda = null; try { oda = aramaAktifOda(); } catch {}
  const od = oda && ODA_BILGI[oda];
  if (od && od.tip !== 'grup') return (od.uyeler||[]).find(u => u !== BEN.kullanici) || null;
  return null;
}

// mute + hoparlör buton durumlarını (ses + video ekranları) yansıt
function aramaButonDurum(){
  let kapali = false; try { kapali = mikrofonKapali(); } catch {}
  const mb = $('muteBtn'); if (mb){ mb.classList.toggle('aktif', kapali);
    if (mb.querySelector('.ikn')) mb.querySelector('.ikn').textContent = kapali ? '🔇' : '🎤';
    if (mb.querySelector('.etk')) mb.querySelector('.etk').textContent = kapali ? 'Açık değil' : 'Sustur'; }
  const vmb = $('videoMuteBtn'); if (vmb){ vmb.classList.toggle('aktif', kapali);
    if (vmb.querySelector('.ikn')) vmb.querySelector('.ikn').textContent = kapali ? '🔇' : '🎤'; }
  let hop = true; try { hop = hoparlorAcikMi(); } catch {}
  const hb = $('hoparlorBtn'); if (hb){ hb.classList.toggle('aktif', !hop);
    if (hb.querySelector('.ikn')) hb.querySelector('.ikn').textContent = hop ? '🔊' : '🎧';
    if (hb.querySelector('.etk')) hb.querySelector('.etk').textContent = hop ? 'Hoparlör' : 'Ahize'; }
  const vhb = $('videoHoparlorBtn'); if (vhb){ vhb.classList.toggle('aktif', !hop);
    if (vhb.querySelector('.ikn')) vhb.querySelector('.ikn').textContent = hop ? '🔊' : '🎧'; }
  // H1: kamera aç/kapa durumu (görüntülü ekranda)
  let kamKapali = false; try { kamKapali = kameraKapaliMi(); } catch {}
  const vkb = $('videoKameraBtn'); if (vkb){ vkb.classList.toggle('aktif', kamKapali);
    if (vkb.querySelector('.ikn')) vkb.querySelector('.ikn').textContent = kamKapali ? '📵' : '📹'; }
}

// Merkezî arama görünümü: doğru ekranı (tam/küçük · ses/görüntü) göster + içeriği doldur
function aramaSeritGuncelle(){
  const d = aramaDurumu(), video = aramaVideoMu();
  const sahne = $('aramaSahne'), mini = $('aramaMini'), vsahne = $('videoSahne');
  const aktif = d === 'ariyor' || d === 'baglaniyor' || d === 'konusuyor';   // etkin çağrı (geçici reddedildi/mesgul/geliyor/bos hariç)
  if (!aktif){
    sahne && sahne.classList.add('gizli');
    mini && mini.classList.add('gizli');
    vsahne && vsahne.classList.add('gizli');
    document.body.classList.remove('arama-mini-acik');
    ARAMA_KUCUK = false;                             // çağrı bitti → sonraki çağrı tam ekran açılsın
    return;
  }
  const kim = aramaKarsi(), ad = kim ? gorAd(kim) : 'arama';
  const etiket = { ariyor:'Aranıyor…', baglaniyor:'Bağlanılıyor…',
                   konusuyor: video ? 'Görüntülü görüşme' : 'Görüşülüyor' };
  if (sahne){
    if ($('aramaSahneAd')) $('aramaSahneAd').textContent = ad;
    if ($('aramaSahneAvatar')){ avatarKur($('aramaSahneAvatar'), kim||'?', false, kim);
      $('aramaSahneAvatar').classList.toggle('pulse', d !== 'konusuyor'); }
    if ($('aramaSahneDurum')) $('aramaSahneDurum').textContent = etiket[d] || d;
    if ($('aramaSahneSure')) $('aramaSahneSure').classList.toggle('gizli', d !== 'konusuyor');
  }
  if (mini){
    if ($('aramaMiniAd')) $('aramaMiniAd').textContent = ad;
    if ($('aramaMiniDurum')){ $('aramaMiniDurum').textContent = d === 'konusuyor' ? '' : (etiket[d] || ''); }
    if ($('aramaMiniSure')) $('aramaMiniSure').classList.toggle('gizli', d !== 'konusuyor');
  }
  if ($('videoSure')) $('videoSure').classList.toggle('gizli', d !== 'konusuyor');
  // hangi ekran görünür: video çağrı → #videoSahne; ses çağrı → #aramaSahne; küçükse mini
  if (video){
    vsahne && vsahne.classList.toggle('gizli', ARAMA_KUCUK);
    sahne && sahne.classList.add('gizli');
  } else {
    sahne && sahne.classList.toggle('gizli', ARAMA_KUCUK);
    vsahne && vsahne.classList.add('gizli');
  }
  mini && mini.classList.toggle('gizli', !ARAMA_KUCUK);
  document.body.classList.toggle('arama-mini-acik', ARAMA_KUCUK);   // mini şerit açıkken oda/liste başlığını aşağı kaydır
  aramaSureCiz();
  aramaButonDurum();
}

let aramaKayit = null;
let grupAramaKayit = null;
let ARAMA_GECMISI = [];
try { ARAMA_GECMISI = JSON.parse(localStorage.getItem('narchat_arama_gecmisi') || '[]'); } catch {}
let KACIRILAN_ARAMALAR = 0;
try { KACIRILAN_ARAMALAR = parseInt(localStorage.getItem('narchat_kacirilan_arama_sayisi') || '0', 10); } catch {}

function aramaRozetiGuncelle(sifirla = false) {
  if (sifirla) KACIRILAN_ARAMALAR = 0;
  try { localStorage.setItem('narchat_kacirilan_arama_sayisi', String(KACIRILAN_ARAMALAR)); } catch {}
  const el = $('aramaRozeti');
  if (el) {
    el.textContent = KACIRILAN_ARAMALAR;
    el.classList.toggle('gizli', KACIRILAN_ARAMALAR <= 0);
  }
}

function aramaGecmisiYaz() {
  try { localStorage.setItem('narchat_arama_gecmisi', JSON.stringify(ARAMA_GECMISI)); } catch {}
  aramaGecmisiCiz();
}

function aramaGecmisineEkle(kayit) {
  if (!kayit) return;
  ARAMA_GECMISI.unshift(kayit);
  if (ARAMA_GECMISI.length > 100) ARAMA_GECMISI.pop();
  if (kayit.durum === 'kacirilan') {
    KACIRILAN_ARAMALAR++;
    aramaRozetiGuncelle();
  }
  aramaGecmisiYaz();
}

function aramaGecmisiCiz() {
  const kap = $('aramalar');
  if (!kap) return;
  kap.innerHTML = '';
  const bosEl = $('aramalarBos');
  if (!ARAMA_GECMISI.length) {
    bosEl && bosEl.classList.remove('gizli');
    return;
  }
  bosEl && bosEl.classList.add('gizli');
  
  ARAMA_GECMISI.forEach(kayit => {
    const el = document.createElement('div');
    el.className = 'satir oda';
    
    const a = document.createElement('div');
    a.className = 'avatar';
    
    let ad = '';
    if (kayit.tip === 'grup') {
      const od = ODA_BILGI[kayit.oda];
      ad = od ? od.ad : 'Grup';
      avatarKur(a, ad, true, null, od ? od.avatar : null);
    } else {
      const peer = kayit.gonderen === BEN.kullanici ? kayit.karsi : kayit.gonderen;
      ad = peer ? gorAd(peer) : 'Kullanıcı';
      avatarKur(a, peer || ad, false, peer);
    }
    
    const g = document.createElement('div');
    g.className = 'govde';
    g.onclick = () => odaAc(kayit.oda);
    
    const ust = document.createElement('div');
    ust.className = 'ust';
    const adEl = document.createElement('span');
    adEl.className = 'ad';
    adEl.textContent = ad;
    ust.appendChild(adEl);
    
    if (kayit.ts) {
      const s = document.createElement('span');
      s.className = 'saat';
      s.textContent = zamanStr(kayit.ts);
      ust.appendChild(s);
    }
    g.appendChild(ust);
    
    const p = document.createElement('div');
    p.className = 'onizle';
    p.style.display = 'flex';
    p.style.alignItems = 'center';
    p.style.gap = '4px';
    
    const iconSpan = document.createElement('span');
    iconSpan.style.fontSize = '12px';
    if (kayit.durum === 'giden') {
      iconSpan.textContent = '↗';
      iconSpan.style.color = 'var(--text-2)';
    } else if (kayit.durum === 'gelen') {
      iconSpan.textContent = '↙';
      iconSpan.style.color = '#2fbf71';
    } else if (kayit.durum === 'kacirilan') {
      iconSpan.textContent = '↙';
      iconSpan.style.color = 'var(--danger)';
    } else if (kayit.durum === 'reddedildi') {
      iconSpan.textContent = '↙';
      iconSpan.style.color = 'var(--danger)';
    } else if (kayit.durum === 'mesgul') {
      iconSpan.textContent = '↗';
      iconSpan.style.color = 'var(--danger)';
    }
    p.appendChild(iconSpan);
    
    const labelSpan = document.createElement('span');
    let label = (kayit.video ? 'Görüntülü' : 'Sesli') + ' arama';
    if (kayit.durum === 'kacirilan') label = 'Kaçırılan ' + (kayit.video ? 'görüntülü' : 'sesli') + ' arama';
    else if (kayit.durum === 'reddedildi') label = 'Reddedilen ' + (kayit.video ? 'görüntülü' : 'sesli') + ' arama';
    else if (kayit.durum === 'mesgul') label = 'Meşgul';
    labelSpan.textContent = label;
    if (kayit.durum === 'kacirilan' || kayit.durum === 'reddedildi') {
      labelSpan.style.color = 'var(--danger)';
    }
    p.appendChild(labelSpan);
    g.appendChild(p);
    
    el.appendChild(a);
    el.appendChild(g);
    
    const sag = document.createElement('div');
    sag.className = 'sag';
    sag.style.display = 'flex';
    sag.style.alignItems = 'center';
    sag.style.gap = '12px';
    sag.style.paddingRight = '12px';
    
    if (kayit.sure > 0) {
      const durSpan = document.createElement('small');
      durSpan.style.color = 'var(--text-2)';
      const dk = Math.floor(kayit.sure / 60);
      const sn = kayit.sure % 60;
      durSpan.textContent = dk > 0 ? `${dk} dk ${sn} sn` : `${sn} sn`;
      sag.appendChild(durSpan);
    }
    
    const cbBtn = document.createElement('button');
    cbBtn.className = 'sil-btn';
    cbBtn.style.color = 'var(--accent)';
    cbBtn.style.fontSize = '16px';
    cbBtn.style.border = 'none';
    cbBtn.style.background = 'none';
    cbBtn.style.cursor = 'pointer';
    cbBtn.style.padding = '4px 8px';
    cbBtn.innerHTML = kayit.video ? '📹' : '📞';
    cbBtn.onclick = (e) => {
      e.stopPropagation();
      const od = ODA_BILGI[kayit.oda];
      if (od) {
        odaAc(kayit.oda);
        aramaButonTikla(kayit.video);
      }
    };
    sag.appendChild(cbBtn);
    el.appendChild(sag);
    
    kap.appendChild(el);
  });
}

function aramaUI(d, ek){
  if (d === 'mesaj') return;                  // datachannel verisi — UI gerekmez
  window.__ARAMA_DURUM = d;                   // (izole test kancası — arama.js'teki __ARAMA_* ile tutarlı)
  const _L = (window.__ARAMA_LOG = window.__ARAMA_LOG || []); _L.push(d); if (_L.length > 40) _L.shift();
  const gelen = $('gelenArama'), video = aramaVideoMu();

  // gelen arama: tam ekran Cevapla/Reddet
  if (d === 'geliyor'){
    aramaKayit = {
      oda: aramaAktifOda(),
      tip: 'ikili',
      video: video,
      gonderen: ek,
      karsi: BEN.kullanici,
      ts: Math.floor(Date.now() / 1000),
      durum: 'kacirilan',
      sure: 0
    };
    if (gelen){
      $('gelenAd').textContent = ek ? gorAd(ek) : 'bilinmeyen';
      avatarKur($('gelenAvatar'), ek || '?', false, ek);
      if ($('gelenAlt')) $('gelenAlt').textContent = video ? '📹 Görüntülü arama…' : '📞 Sesli arama…';
      gelen.classList.remove('gizli');
    }
    aramaSeritGuncelle();
    return;
  }
  if (d === 'ariyor'){
    aramaKayit = {
      oda: aramaAktifOda(),
      tip: 'ikili',
      video: video,
      gonderen: BEN.kullanici,
      karsi: aramaKarsi(),
      ts: Math.floor(Date.now() / 1000),
      durum: 'giden',
      sure: 0
    };
  }
  if (gelen) gelen.classList.add('gizli');     // gelen ekranını her diğer durumda kapat

  if (d === 'konusuyor') {
    aramaSureBaslat();    // süre: bağlandığında başlat
    if (aramaKayit) {
      if (aramaKayit.gonderen !== BEN.kullanici) aramaKayit.durum = 'gelen';
    }
  }
  if (d === 'reddedildi') {
    toast('Arama reddedildi');
    if (aramaKayit) aramaKayit.durum = 'reddedildi';
  }
  if (d === 'mesgul') {
    toast('Kişi meşgul');
    if (aramaKayit) aramaKayit.durum = 'mesgul';
  }
  if (d === 'bos'){
    aramaSureDur();
    let finalSure = 0;
    if (aramaSure0) {
      finalSure = Math.max(0, Math.floor((Date.now() - aramaSure0) / 1000));
    }
    aramaSure0 = 0;     // kapanınca durdur + sıfırla
    if (aramaKayit) {
      aramaKayit.sure = finalSure;
      aramaGecmisineEkle(aramaKayit);
      aramaKayit = null;
    }
    try { $('yerelVideo')?.classList.remove('arka'); } catch {}
  }

  aramaSeritGuncelle();
}

// arama ekranı: küçült (mini şeride in) / büyüt (tam ekrana dön) — arama SÜRER
function aramaKucult(){ if (aramaDurumu() === 'bos') return; ARAMA_KUCUK = true; aramaSeritGuncelle(); }
function aramaBuyut(){ if (aramaDurumu() === 'bos') return; ARAMA_KUCUK = false; aramaSeritGuncelle(); }
function muteToggleUI(){ try { mikrofonToggle(); } catch {} aramaButonDurum(); }
async function hoparlorToggleUI(){
  let r = { acik:true, destekli:false };
  try { r = await hoparlorToggle(); } catch {}
  aramaButonDurum();
  if (!r.destekli) toast('Hoparlör/ahize geçişi bu cihazda sınırlı (web). Tam kontrol native uygulamada.');
}
// H1: kamera aç/kapa + ön/arka çevir (görüntülü arama)
function kameraToggleUI(){ let k=false; try { k = kameraToggle(); } catch {} aramaButonDurum(); if (k) toast('Kamera kapalı'); }
async function kameraCevirUI(){
  let y = 'user'; try { y = await kameraCevir(); } catch {}
  try { const yv = $('yerelVideo'); if (yv) yv.classList.toggle('arka', y === 'environment'); } catch {}  // arka kamera → ayna kapat
  aramaButonDurum();
}

// ════════ FAZ H2: grup arama (mesh) UI ════════
// arama.js (1:1) ile aynı buton — sohbet tipine göre dallanır. Grup = grup-arama.js mesh.
function aramaButonTikla(video){
  if (!ODA) return;
  const grup = ODA_BILGI[ODA]?.tip === 'grup';
  if (grup){ if (grupDurumu()==='bos') grupBaslat(ODA, {video}); }
  else { if (aramaDurumu()==='bos') aramaBaslat(ODA, {video}); }
}
let GRUP_KUCUK = false, grupSure0 = 0, grupSureTimer = null;
function grupSureMetin(){
  if (!grupSure0) return '00:00';
  const s = Math.max(0, Math.floor((Date.now() - grupSure0)/1000));
  return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
}
function grupSureCiz(){ const t = grupSureMetin(); const el=$('grupSure'); if (el) el.textContent = t; }
function grupSureBaslat(){ if (!grupSure0) grupSure0 = Date.now(); if (!grupSureTimer) grupSureTimer = setInterval(grupSureCiz, 1000); grupSureCiz(); }
function grupSureDur(){ if (grupSureTimer){ clearInterval(grupSureTimer); grupSureTimer = null; } }

// gelen grup araması → #gelenArama overlay'i grup etiketiyle paylaşır (1:1 ile aynı, cevapla/reddet grup-farkında)
function grupUI(){
  const d = grupDurumu(), gelen = $('gelenArama');
  window.__GRUP_UI_DURUM = d;   // izole test kancası
  if (d === 'geliyor'){
    const arayan = grupArayan(), odaId = grupOdasi();
    grupAramaKayit = {
      oda: odaId,
      tip: 'grup',
      video: grupVideoMu(),
      gonderen: arayan,
      ts: Math.floor(Date.now() / 1000),
      durum: 'kacirilan',
      sure: 0
    };
    if (gelen){
      const odaAd = odaAdGoster(ODA_BILGI[odaId]||{}) || 'Grup';
      $('gelenAd').textContent = odaAd;
      avatarKur($('gelenAvatar'), odaAd, true);
      if ($('gelenAlt')) $('gelenAlt').textContent = (grupVideoMu()?'📹':'📞') + ' Grup araması · ' + (arayan?gorAd(arayan):'');
      gelen.classList.remove('gizli');
    }
    grupSahneGuncelle();
    return;
  }
  if (d === 'ariyor'){
    grupAramaKayit = {
      oda: grupOdasi(),
      tip: 'grup',
      video: grupVideoMu(),
      gonderen: BEN.kullanici,
      ts: Math.floor(Date.now() / 1000),
      durum: 'giden',
      sure: 0
    };
  }
  if (gelen && aramaDurumu()!=='geliyor') gelen.classList.add('gizli');   // 1:1 gelen ekranını ezme
  if (d === 'konusuyor') {
    grupSureBaslat();
    if (grupAramaKayit) {
      if (grupAramaKayit.gonderen !== BEN.kullanici) grupAramaKayit.durum = 'gelen';
    }
  }
  if (d === 'bos'){
    grupSureDur();
    let finalSure = 0;
    if (grupSure0) {
      finalSure = Math.max(0, Math.floor((Date.now() - grupSure0)/1000));
    }
    grupSure0 = 0;
    GRUP_KUCUK = false;
    if (grupAramaKayit) {
      grupAramaKayit.sure = finalSure;
      aramaGecmisineEkle(grupAramaKayit);
      grupAramaKayit = null;
    }
    try { $('yerelVideo')?.classList.remove('arka'); } catch {}
  }
  grupSahneGuncelle();
}
function grupSahneGuncelle(){
  const d = grupDurumu(), video = grupVideoMu();
  const sahne = $('grupSahne'), mini = $('aramaMini');
  const aktif = d === 'ariyor' || d === 'baglaniyor' || d === 'konusuyor';
  if (!aktif){
    sahne && sahne.classList.add('gizli');
    if (aramaDurumu()==='bos'){ mini && mini.classList.add('gizli'); document.body.classList.remove('arama-mini-acik'); }
    return;
  }
  const odaAd = odaAdGoster(ODA_BILGI[grupOdasi()]||{}) || 'Grup araması';
  const durumEt = { ariyor:'Aranıyor…', baglaniyor:'Bağlanılıyor…', konusuyor:'' }[d] || '';
  if ($('grupBaslik')) $('grupBaslik').textContent = durumEt ? (odaAd+' · '+durumEt) : odaAd;
  if ($('grupSure')) $('grupSure').classList.toggle('gizli', d!=='konusuyor');
  // mini şerit (küçültülünce)
  if (mini){
    if ($('aramaMiniAd')) $('aramaMiniAd').textContent = odaAd;
    if ($('aramaMiniDurum')) $('aramaMiniDurum').textContent = durumEt;
    if ($('aramaMiniSure')) $('aramaMiniSure').classList.add('gizli');
  }
  sahne && sahne.classList.toggle('gizli', GRUP_KUCUK);
  mini && mini.classList.toggle('gizli', !GRUP_KUCUK);
  document.body.classList.toggle('arama-mini-acik', GRUP_KUCUK);
  if (!GRUP_KUCUK) grupGridCiz();
  grupButonDurum();
}
// grid: kendi tile + her eş tile'ı (video varsa <video>, yoksa avatar). Eş seti değişince yeniden kur.
let GRUP_GRID_IMZA = '';
function grupGridCiz(){
  const grid = $('grupGrid'); if (!grid) return;
  const esler = grupKatilimcilar();             // [{peer, akis}]
  const imza = ['__ben__', ...esler.map(e=>e.peer)].sort().join('|');
  if (imza !== GRUP_GRID_IMZA){                  // tile seti değişti → yeniden kur
    grid.innerHTML = '';
    grid.appendChild(grupTileEl('__ben__'));
    esler.forEach(e => grid.appendChild(grupTileEl(e.peer)));
    GRUP_GRID_IMZA = imza;
    const n = esler.length + 1; grid.dataset.n = n > 4 ? 4 : n;   // grid sınıfı (1-4 kare)
  }
  // srcObject'leri (yeniden) bağla
  const benV = grid.querySelector('[data-peer="__ben__"] video');
  if (benV){ const y = grupYerel(); if (y && benV.srcObject !== y) benV.srcObject = y; }
  esler.forEach(e => {
    const t = grid.querySelector('[data-peer="'+CSS.escape(e.peer)+'"]');
    if (!t) return;
    const v = t.querySelector('video');
    const varVideo = !!(e.akis && e.akis.getVideoTracks && e.akis.getVideoTracks().length);
    if (v && e.akis && v.srcObject !== e.akis) v.srcObject = e.akis;
    t.classList.toggle('yok-video', !varVideo);   // video yoksa avatar göster
  });
}
function grupTileEl(peer){
  const ben = peer === '__ben__';
  const ad = ben ? 'Sen' : gorAd(peer);
  const t = document.createElement('div');
  t.className = 'grup-tile' + (ben ? ' ben' : '');
  t.dataset.peer = peer;
  const v = document.createElement('video');
  v.autoplay = true; v.playsInline = true; if (ben) v.muted = true;   // kendi sesini çalma (eko)
  t.appendChild(v);
  const av = document.createElement('div'); av.className = 'grup-tile-av';
  avatarKur(av, ben ? BEN.kullanici : peer, false, ben ? BEN.kullanici : peer);
  t.appendChild(av);
  const et = document.createElement('div'); et.className = 'grup-tile-ad'; et.textContent = ad;
  t.appendChild(et);
  return t;
}
function grupButonDurum(){
  let mik=false, kam=false;
  try { mik = grupMikKapali(); } catch {}
  try { kam = grupKameraKapali(); } catch {}
  const mb = $('grupMuteBtn'); if (mb){ mb.classList.toggle('aktif', mik); if (mb.querySelector('.ikn')) mb.querySelector('.ikn').textContent = mik?'🔇':'🎤'; }
  const kb = $('grupKameraBtn'); if (kb){ kb.classList.toggle('aktif', kam); if (kb.querySelector('.ikn')) kb.querySelector('.ikn').textContent = kam?'📵':'📹'; }
}
function grupKucult(){ if (grupDurumu()==='bos') return; GRUP_KUCUK = true; grupSahneGuncelle(); }
function grupBuyut(){ if (grupDurumu()==='bos') return; GRUP_KUCUK = false; grupSahneGuncelle(); }

// ════════ liste: kişiler + odalar (önizleme) ════════
let GORULEN = {};            // oda -> son görülen ts (okunmamış rozeti için)
try { GORULEN = JSON.parse(localStorage.getItem('narchat_gorulen')||'{}'); } catch {}
function gorulenYaz(){ try { localStorage.setItem('narchat_gorulen', JSON.stringify(GORULEN)); } catch {} }
// N7: sohbeti sessize al (per-oda) — sessiz odada bildirim SESİ çalmaz; okunmamış rozeti/başlık sayısı görünür kalır (WhatsApp gibi). Yalnız YEREL.
let SESSIZ = new Set(); try { SESSIZ = new Set(JSON.parse(localStorage.getItem('narchat_sessiz')||'[]')); } catch {}
function sessizMi(oda){ return SESSIZ.has(oda); }
// N7: sessiz kümesini IndexedDB'ye AYNALA — Service Worker (Web Push) localStorage okuyamaz, IndexedDB okuyabilir →
// sessiz oda için OS bildirimi de SESSİZ gösterilir (asıl mute senaryosu: sekme kapalı/arka planda).
function sessizIdbSenkron(){ try { _idbSet('sessiz', [...SESSIZ]); } catch {} }
function sessizToggle(oda){ if (SESSIZ.has(oda)) SESSIZ.delete(oda); else SESSIZ.add(oda); try{ localStorage.setItem('narchat_sessiz', JSON.stringify([...SESSIZ])); }catch{} sessizIdbSenkron(); odaListesiCiz(); }

// G5 durumu: anahtar tabanı (en son onaylanan/ilk görülen pubkey) + doğrulanan (kullanıcı bizzat onayladı)
// + DEGISEN (çalışma-anı: tabandan farklı pubkey görülen kişiler = uyarı). Hepsi kişi-adı anahtarlı.
let ANAHTAR_TABAN = {};  try { ANAHTAR_TABAN = JSON.parse(localStorage.getItem('narchat_anahtar_taban')||'{}'); } catch {}
let DOGRULANAN = {};     try { DOGRULANAN = JSON.parse(localStorage.getItem('narchat_dogrulanan')||'{}'); } catch {}
let DEGISEN = new Set();
function _g5Yaz(){ try { localStorage.setItem('narchat_anahtar_taban', JSON.stringify(ANAHTAR_TABAN));
  localStorage.setItem('narchat_dogrulanan', JSON.stringify(DOGRULANAN)); } catch {} }
// PUBKEYLER yüklendikten sonra çağrılır: ilk görüleni sessiz tabanla; tabandan farklıysa "değişti" işaretle.
function anahtarDegisimDenetle(){
  DEGISEN = new Set();
  let yaz = false;
  for (const [u, pk] of Object.entries(PUBKEYLER)){
    if (!pk || u===BEN.kullanici) continue;
    const taban = ANAHTAR_TABAN[u];
    if (!taban){ ANAHTAR_TABAN[u] = pk; yaz = true; }   // ilk görülme → sessiz taban
    else if (taban !== pk) DEGISEN.add(u);              // değişti → uyar (taban onaylanana dek korunur)
  }
  if (yaz) _g5Yaz();
}
function kisiDogrulandi(u){ return !!(DOGRULANAN[u] && DOGRULANAN[u] === PUBKEYLER[u]); }
// Kullanıcı güvenlik numarasını karşılaştırıp onayladı: tabanı güncelle (uyarı kalkar) + doğrulandı işaretle.
function kisiDogrula(u){
  const pk = PUBKEYLER[u]; if (!pk) return;
  ANAHTAR_TABAN[u] = pk; DOGRULANAN[u] = pk; DEGISEN.delete(u); _g5Yaz();
}
// "Değişti" uyarısını doğrulamadan kabul et (yeni cihaz olabilir): taban güncellenir, doğrulandı SIFIRLANIR.
function anahtarDegisimKabul(u){
  const pk = PUBKEYLER[u]; if (!pk) return;
  ANAHTAR_TABAN[u] = pk; delete DOGRULANAN[u]; DEGISEN.delete(u); _g5Yaz();
}

// G6 kaybolan mesajlar: oda-başına TTL (saniye) + açık baloncukların yerel süre takibi.
let KAYBOLAN = {};  try { KAYBOLAN = JSON.parse(localStorage.getItem('narchat_kaybolan')||'{}'); } catch {}
let KAYBOLAN_ZAMAN = {};   // mesaj id -> sil_ts (saniye); açık sohbette yerel oto-sil için
function kaybolanYaz(){ try { localStorage.setItem('narchat_kaybolan', JSON.stringify(KAYBOLAN)); } catch {} }
function kaybolSn(oda){ return KAYBOLAN[oda] || 0; }
const KAYBOLAN_SECENEK = [[0,'Kapalı'],[3600,'1 saat'],[86400,'1 gün'],[604800,'1 hafta']];
function kaybolanEtiket(sn){ const o=KAYBOLAN_SECENEK.find(x=>x[0]===sn); return o ? o[1] : (sn?sn+'sn':'Kapalı'); }
// gönderim gövdesine eklenecek alan (TTL açıksa): {kaybol:saniye}
function kaybolEk(oda){ const sn=kaybolSn(oda); return sn ? {kaybol:sn} : {}; }
// açık sohbette süresi dolan baloncukları yerel kaldır (sunucu süpürmesi okuma anında; bu, bakarken de yok eder)
function kaybolanYerelSupur(){
  const simdi = Math.floor(Date.now()/1000);
  for (const [id, st] of Object.entries(KAYBOLAN_ZAMAN)){
    if (st <= simdi){ const e=document.querySelector(`#akis .msg[data-id="${id}"]`); if (e) e.remove(); delete KAYBOLAN_ZAMAN[id]; }
  }
}
setInterval(kaybolanYerelSupur, 15000);

// G7 kişi engelleme: engellediğim kullanıcılar (sunucuda saklı → cihazlar arası; mesajları gizlenir).
let ENGELLI = new Set();
// G8 gizlilik tercihleri (sunucuda saklı). son/okundu = AÇIK mı (görünür/gönderilir).
let GIZLILIK = { son:true, okundu:true };
// G12: sabitlenen (oda→mid, üyelere görünür) + yıldızlanan (key 'oda|id' Set, kişisel)
let SABIT = {};
let YILDIZ = new Set();
async function engelliYukle(){ try { const {ok,d}=await api('/api/ben'); if (ok&&d){ ENGELLI = new Set(d.engelli||[]);
  YILDIZ = new Set((d.yildiz||[]).map(x=>x.oda+'|'+x.id));    // G12: yıldızlı mesajlarım (cihazlar arası)
  if (d.gizlilik){ GIZLILIK = {son:d.gizlilik.son!==false, okundu:d.gizlilik.okundu!==false}; gizlilikGuncelle(); } } } catch {} }
function engelliMi(u){ return ENGELLI.has(u); }
async function kisiEngelle(u, engelle){
  const {ok,d} = await api(engelle?'/api/engelle':'/api/engel-kaldir', {method:'POST', body:JSON.stringify({kullanici:u})});
  if (!ok){ toast((d&&d.hata)||'işlem başarısız'); return false; }
  ENGELLI = new Set(d.engelli||[]);
  toast(engelle ? '@'+u+' engellendi' : '@'+u+' engeli kaldırıldı');
  if (ODA && ODA_BILGI[ODA]) odaAltGuncelle();
  await yenile();
  return true;
}

async function yenile(){
  if (BEN) await engelliYukle();                    // G7: engel listesini tazele (cihazlar arası senkron)
  // PUBKEYLER = herkesin AÇIK anahtarı (E2E şifreleme için — oda üyeleri dahil). Listede GÖSTERİLMEZ.
  const k = await api('/api/kullanicilar');
  PUBKEYLER = {}; ADLAR = {}; AVATARLI = new Set();
  (k.d||[]).forEach(u=>{ PUBKEYLER[u.kullanici]=u.pubkey;
    if (u.ad) ADLAR[u.kullanici]=u.ad; if (u.avatar) AVATARLI.add(u.kullanici); });
  if (BEN){ const oncekiDegisen = new Set(DEGISEN); anahtarDegisimDenetle();   // G5: anahtar değişimi (MITM) denetimi
    for (const u of DEGISEN){ if (!oncekiDegisen.has(u)) toast('⚠️ @'+u+' güvenlik numarası değişti — doğrulayın'); }
    if (ODA && ODA_BILGI[ODA]) odaAltGuncelle(); }
  // Ayarlar profil alanları (kullanıcı yazarken dokunma)
  if (BEN && $('adIn') && document.activeElement!==$('adIn') && !_avatarBekleyen) $('adIn').value = ADLAR[BEN.kullanici] || '';
  if (BEN) avatarKur($('benAvatar'), BEN.kullanici, false, BEN.kullanici);

  // KİŞİLER = yalnız benim kullanıcı-adıyla eklediklerim (kişi defteri)
  const kr = await api('/api/kisiler');
  const kisilerim = (kr.d||[]).filter(u=>u.kullanici!==BEN.kullanici);
  KISILER = kisilerim;                               // H3: grup üye ekleme adayları
  PRESENCE = {}; kisilerim.forEach(u=>{ PRESENCE[u.kullanici] = !!u.cevrimici; });
  const kis = $('kisiler'); kis.innerHTML='';
  if (!kisilerim.length){
    kis.innerHTML = bosDurumHTML('Henüz kişi yok', '“+” → Kişi Ekle ile kullanıcı adından ekle.');
  } else kisilerim.forEach(u=>{
    const eng = engelliMi(u.kullanici);
    kis.appendChild(satirEl({ad:gorAd(u.kullanici), av:u.kullanici, avKul:u.kullanici, online:!eng&&u.cevrimici, engelli:eng,
      onclick:()=> eng ? kisiBilgiAc(u.kullanici) : ikiliBaslat(u.kullanici), sil:()=>kisiSil(u.kullanici)}));
  });

  // grup seçim = kişilerimden (gruba ancak eklediğin kişileri koyarsın)
  const gs = $('grupUye'); gs.innerHTML='';
  kisilerim.forEach(u=>{ const o=document.createElement('option'); o.value=u.kullanici; o.textContent='@'+u.kullanici; gs.appendChild(o); });

  // odalarım (önizleme + okunmamış)
  const o = await api('/api/odalar');
  ODALAR = (o.d||[]).slice().sort((a,b)=>(b.son_ts||0)-(a.son_ts||0));
  ODA_BILGI = {}; ODALAR.forEach(od=>ODA_BILGI[od.oda]=od);
  SABIT = {}; ODALAR.forEach(od=>{ if (od.sabit) SABIT[od.oda]=od.sabit; });   // G12: oda sabit mesajları
  if (ODA) sabitGuncelle();
  odaListesiCiz();
}

// Kişi defterine kullanıcı adıyla ekle (sadece var olan kullanıcı; liste yalnız bunları gösterir).
async function kisiEkle(){
  const kullanici = $('kisiEkleIn').value.trim().toLowerCase();
  if (!kullanici){ toast('Kullanıcı adı yaz'); return; }
  const {ok,d} = await api('/api/kisi-ekle', {method:'POST', body:JSON.stringify({kullanici})});
  if (!ok){ toast((d&&d.hata)||'eklenemedi'); return; }
  $('kisiEkleIn').value=''; $('kisiEklePanel').classList.add('gizli');
  toast('Kişi eklendi: @'+d.kullanici);
  await yenile();
}

// Kişiyi defterinden çıkar (yalnız kişi listesinden; oda/mesaj geçmişi durur, tekrar eklenebilir).
async function kisiSil(kullanici){
  if (!confirm('@'+kullanici+' kişilerden silinsin mi?\nSohbet ve mesajlar kalır; istersen tekrar ekleyebilirsin.')) return;
  const {ok,d} = await api('/api/kisi-sil', {method:'POST', body:JSON.stringify({kullanici})});
  if (!ok){ toast((d&&d.hata)||'silinemedi'); return; }
  toast('Kişi silindi: @'+kullanici);
  await yenile();
}

function odaAdGoster(od){
  if (od.tip === 'ikili') return gorAd(od.uyeler.find(u=>u!==BEN.kullanici) || od.uyeler[0]);
  return od.ad;
}
function odaListesiCiz(filtre=''){
  const kap = $('odalar'); kap.innerHTML='';
  const f = filtre.trim().toLowerCase();
  const liste = ODALAR.filter(od => !f || odaAdGoster(od).toLowerCase().includes(f));
  if (!liste.length){
    kap.innerHTML = ODALAR.length
      ? bosDurumHTML('Eşleşme yok', 'Aramaya uyan sohbet bulunamadı.')
      : bosDurumHTML('Henüz sohbet yok', 'Kişiler sekmesinden birine yaz ya da grup kur.');
    return;
  }
  liste.forEach(od=>{
    const ad = odaAdGoster(od);
    const onek = od.tip==='grup' && od.son_gonderen ? '@'+od.son_gonderen+': ' : '';
    const taslak = (od.oda !== ODA) ? taslakMetin(od.oda) : '';   // N7: açık odanın taslağı zaten kutuda — listede gösterme
    const onizle = taslak ? '✎ Taslak: ' + taslak.replace(/\s+/g,' ').trim().slice(0,80)
      : od.son_silindi ? '🚫 silinen mesaj'
      : (od.son ? onek + (od.son.sema==='e2e1m' ? medyaOnizleEtiket(od.son) : coz(od.son)) : 'Henüz mesaj yok');
    const okunmamis = od.son_ts && od.son_ts > (GORULEN[od.oda]||0) && od.son_gonderen !== BEN.kullanici;
    const peer = od.tip==='grup' ? null : (od.uyeler.find(u=>u!==BEN.kullanici)||null);
    kap.appendChild(satirEl({
      ad, av: od.tip==='grup' ? od.ad : (peer||ad), avKul: peer, avFoto: od.tip==='grup' ? od.avatar : null,
      grup: od.tip==='grup', onizle, saat: od.son_ts ? zamanStr(od.son_ts) : '',
      rozet: okunmamis ? '•' : '', kalin: okunmamis, sessiz: sessizMi(od.oda), onclick:()=>odaAc(od.oda)
    }));
  });
  okunmamisGuncelle();   // FAZ G4: başlık/uygulama rozeti + arka-plan sesi
}

function satirEl({ad, av, grup, onizle, saat, rozet, kalin, onclick, sil, online, avKul, engelli, avFoto, sessiz}){
  const el = document.createElement('div');
  el.className = 'satir oda' + (engelli?' engelli':'');   // 'oda' = test/back-compat kancası
  const a = document.createElement('div'); a.className='avatar'; avatarKur(a, av||ad, grup, avKul, avFoto);
  if (online){ const n=document.createElement('span'); n.className='cevrimici-nokta'; n.title='çevrimiçi'; a.appendChild(n); }
  const g = document.createElement('div'); g.className='govde';
  const ust = document.createElement('div'); ust.className='ust';
  const adEl = document.createElement('span'); adEl.className='ad'; adEl.textContent=ad;
  if (kalin) adEl.style.fontWeight='700';
  ust.appendChild(adEl);
  if (sessiz){ const m=document.createElement('span'); m.className='sessiz-im'; m.textContent='🔕'; m.title='Sessize alındı'; ust.appendChild(m); }   // N7
  if (engelli){ const e=document.createElement('span'); e.className='engel-im'; e.textContent='🚫'; e.title='Engellendi'; ust.appendChild(e); }
  if (saat){ const s=document.createElement('span'); s.className='saat'; s.textContent=saat; ust.appendChild(s); }
  g.appendChild(ust);
  if (onizle!=null){ const p=document.createElement('div'); p.className='onizle'; p.textContent=onizle; g.appendChild(p); }
  el.appendChild(a); el.appendChild(g);
  if (rozet){ const r=document.createElement('span'); r.className='rozet'; r.textContent = rozet==='•'?'':rozet; el.appendChild(r); }
  if (sil){
    const b=document.createElement('button'); b.className='sil-btn'; b.type='button';
    b.title='Kişiyi sil'; b.setAttribute('aria-label','Kişiyi sil'); b.textContent='✕';
    b.onclick=(e)=>{ e.stopPropagation(); sil(); };
    el.appendChild(b);
  }
  el.onclick = onclick;
  return el;
}
function bosDurumHTML(baslik, alt){
  return `<div class="bos"><img class="resim" src="/bos-durum.svg" alt=""><b>${esc(baslik)}</b><p>${esc(alt)}</p></div>`;
}

async function ikiliBaslat(diger){
  const {ok,d} = await api('/api/oda', {method:'POST', body:JSON.stringify({tip:'ikili', uyeler:[diger]})});
  if (ok){ await yenile(); odaAc(d.oda); }
}
async function grupKur(){
  const sec = Array.from($('grupUye').selectedOptions).map(o=>o.value);
  if (!sec.length){ toast('En az bir kişi seç'); return; }
  const {ok,d} = await api('/api/oda', {method:'POST', body:JSON.stringify({tip:'grup', uyeler:sec})});
  if (ok){ $('grupPanel').classList.add('gizli'); await yenile(); odaAc(d.oda); }
  else toast((d&&d.hata)||'grup kurulamadı');
}

// ════════ oda (sohbet ekranı) ════════
// ════════ N7: oda-başına mesaj taslağı (yarım kalan yazı + yanıt bağlamı korunur — yalnız YEREL, sunucuya/E2E'ye dokunmaz) ════════
// şema: narchat_taslak = { oda: {metin, yanit?} }  (yanit = {id,kim,onizleme} ya da yok)
function taslaklar(){ try { return JSON.parse(localStorage.getItem('narchat_taslak')||'{}'); } catch { return {}; } }
function taslakOku(oda){ const t = taslaklar()[oda]; return (t && typeof t==='object') ? t : null; }
function taslakMetin(oda){ const t = taslakOku(oda); return t ? (t.metin||'') : ''; }
function taslakKaydet(){
  if (!ODA || DUZENLE) return;                       // düzenleme metni taslak DEĞİL → gerçek taslağı ezmesin
  const t = $('mesajIn'); const v = t ? t.value : '';
  const map = taslaklar();
  if (v && v.trim()) map[ODA] = YANIT ? { metin: v, yanit: YANIT } : { metin: v };
  else delete map[ODA];
  try { localStorage.setItem('narchat_taslak', JSON.stringify(map)); } catch {}
}
function taslakSil(oda){ const map = taslaklar(); if (oda in map){ delete map[oda]; try { localStorage.setItem('narchat_taslak', JSON.stringify(map)); } catch {} } }
function taslakGeriYukle(oda){                        // kutuyu + yanıt barını bu odanın taslağına göre kur (odaAc + düzenleme-bitişi ortak)
  const t = $('mesajIn'); if (!t) return;
  const d = taslakOku(oda);
  yanitIptal();                                      // önce yanıt bağlamını temizle (eski oda sızmasın)
  t.value = d ? (d.metin||'') : '';
  if (d && d.yanit) yanitBarGoster(d.yanit);
  otoYukseklik();
}

async function odaAc(oda){
  yanitIptal();                                     // oda değişince bekleyen alıntıyı temizle
  duzenleIptal();                                   // ve bekleyen düzenlemeyi (G9)
  sohbetAraKapat();                                 // ve açık aramayı kapat
  secimBitir();                                     // G11: oda değişince seçim modundan çık
  ODA = oda; SON_TS = 0; SON_GUN = null; SON_KIM = null; OKUNDU = {}; OKUNACAK.clear(); KAYBOLAN_ZAMAN = {}; MESAJ_MODEL = {};
  $('akis').innerHTML='';
  $('mesajIn').disabled=false; $('gonderBtn').disabled=false;
  taslakGeriYukle(oda);   // N7: bu odanın taslağını (+ varsa yanıt bağlamını) geri yükle
  const od = ODA_BILGI[oda] || {};
  $('odaBaslik').textContent = odaAdGoster(od);
  const peer = od.tip==='grup' ? null : (od.uyeler?.find(u=>u!==BEN.kullanici)||null);
  avatarKur($('odaAvatar'), od.tip==='grup'?od.ad:(peer||''), od.tip==='grup', peer, od.avatar);
  odaAltGuncelle();
  $('odaAdBtn').classList.toggle('gizli', od.tip!=='grup');   // yalnız grupta ad düzenle
  $('aramaBtn').classList.remove('gizli');        // H2: sesli arama 1:1 + grup (mesh) — her sohbette açık
  $('aramaVideoBtn').classList.remove('gizli');   // H1/H2: görüntülü arama 1:1 + grup (mesh) — her sohbette açık
  // başlığa/avatara dokun → 1:1: kişi bilgisi+güvenlik (G5) · grup: grup yönetimi (H3)
  const peer1 = od.tip==='grup' ? null : peer;
  const basTik = peer1 ? ()=>kisiBilgiAc(peer1) : (od.tip==='grup' ? ()=>grupBilgiAc(oda) : null);
  $('odaBaslikSar').onclick = basTik;
  $('odaAvatar').onclick    = basTik;
  $('odaBaslikSar').classList.toggle('tiklanir', !!basTik);
  $('odaAvatar').classList.toggle('tiklanir', !!basTik);
  $('kaybolanBtn').onclick = ()=>kaybolanAyarAc(oda);          // G6: ⏱ kaybolan mesaj süresi
  kaybolanBtnGuncelle();
  odaGorunumAc();
  await ilkSayfaYukle();                            // H3: açılışta son ~50 mesaj (uzun sohbet hızı)
  sabitGuncelle();                                  // G12: oda sabit mesajı (banner) — MESAJ_MODEL doldu
  await tepkileriYukle();
  KUYRUK.filter(x=>x.oda===ODA).forEach(x=> ekle({gonderen:BEN.kullanici, ts:x.ts, govde:x.blob}, {optimistik:true}));  // FAZ G1: bekleyen mesajları göster
  sseBagla();
}
// sohbet başlığı alt-satırı: grup üyeleri · 1:1 çevrimiçi/şifreli (yazıyor… geçici üstüne biner)
function odaAltGuncelle(){
  const od = ODA_BILGI[ODA]; if (!od) return;
  if (od.tip === 'grup'){ $('odaUyeler').textContent = (od.uyeler||[]).map(u=>'@'+u).join(', '); return; }
  const diger = od.uyeler?.find(u=>u!==BEN.kullanici);
  let alt = (diger && PRESENCE[diger]) ? 'çevrimiçi' : 'uçtan-uca şifreli';
  if (diger && engelliMi(diger)) alt = '🚫 engellendi';                       // G7: engelli kişi
  else if (diger && DEGISEN.has(diger)) alt = '⚠️ güvenlik numarası değişti';  // G5: MITM uyarısı
  else if (diger && kisiDogrulandi(diger)) alt = '✓ doğrulandı · uçtan-uca şifreli';
  $('odaUyeler').textContent = alt;
}

// catch-up: SON_TS'ten YENİ mesajları ekle (reconnect/gönderim sonrası). Sayfalamayı sıfırlamaz.
async function mesajlariYukle(){
  const {ok,d} = await api('/api/mesajlar?oda='+encodeURIComponent(ODA)+'&since='+SON_TS);
  if (!ok) return;
  if (!d.length && !$('akis').children.length){
    $('akis').innerHTML = `<div class="bos" style="margin:auto"><img class="resim" src="/bos-durum.svg" alt=""><b>İlk mesajını gönder</b><p>Bu sohbet uçtan-uca şifreli. Sadece siz okuyabilirsiniz.</p></div>`;
    return;
  }
  if ($('akis').querySelector('.bos')) $('akis').innerHTML='';
  d.forEach(ekle);
  okunduGonderPlanla();
}
// H3 sayfalama: açılışta son SAYFA mesaj; daha eski varsa en üstte "↑ daha eski" butonu
async function ilkSayfaYukle(){
  DAHA_VAR = false;
  const {ok,d} = await api('/api/mesajlar?oda='+encodeURIComponent(ODA)+'&limit='+SAYFA);
  if (!ok) return;
  const akis = $('akis');
  if (!d.length){
    akis.innerHTML = `<div class="bos" style="margin:auto"><img class="resim" src="/bos-durum.svg" alt=""><b>İlk mesajını gönder</b><p>Bu sohbet uçtan-uca şifreli. Sadece siz okuyabilirsiniz.</p></div>`;
    return;
  }
  akis.innerHTML='';
  if (d.length >= SAYFA){                              // tam sayfa geldi → daha eskisi olabilir
    DAHA_VAR = true;
    const b=document.createElement('button'); b.type='button'; b.className='daha-eski-btn'; b.id='dahaEskiBtn';
    b.textContent='↑ Daha eski mesajları göster'; b.onclick=tumGecmisiYukle;
    akis.appendChild(b);
  }
  d.forEach(ekle);
  okunduGonderPlanla();
}
// "daha eski" → tüm geçmişi yükle + top-down yeniden çiz (gün ayracı/zincirleme doğru); kaydırma korunur
async function tumGecmisiYukle(){
  const akis=$('akis'); const oncekiH=akis.scrollHeight, oncekiTop=akis.scrollTop;
  const {ok,d}=await api('/api/mesajlar?oda='+encodeURIComponent(ODA)+'&since=0');
  if (!ok) return;
  akis.innerHTML=''; SON_GUN=null; SON_KIM=null; SON_TS=0; KAYBOLAN_ZAMAN={}; MESAJ_MODEL={}; DAHA_VAR=false;
  (d||[]).forEach(ekle);
  akis.scrollTop = Math.max(0, akis.scrollHeight - oncekiH + oncekiTop);   // baktığın yeri koru (üste eklendi)
  sabitGuncelle();
  okunduGonderPlanla();
}

// ════════ sohbet içi arama (YEREL — açık sohbetteki çözülmüş baloncuklarda; sunucuya gitmez) ════════
let ARA_ESLESME = [], ARA_INDEX = -1, araZ = null;
function araVurgula(text, q){                          // eşleşen terimi <mark> ile sarmala (XSS'e karşı esc'li)
  const lo = text.toLowerCase(), ql = q.toLowerCase();
  let out = '', i = 0, idx;
  while ((idx = lo.indexOf(ql, i)) !== -1){
    out += esc(text.slice(i, idx)) + '<mark class="ara-im">' + esc(text.slice(idx, idx+ql.length)) + '</mark>';
    i = idx + ql.length;
  }
  return out + esc(text.slice(i));
}
function araTemizle(){                                  // vurguları kaldır + durum sıfırla
  document.querySelectorAll('#akis .msg.ara-eslesme').forEach(el=>{
    el.classList.remove('ara-eslesme','ara-aktif');
    const m = el.querySelector('.metin'); if (m && !m.classList.contains('medya')) m.textContent = m.textContent;  // <mark> kaldır
  });
  ARA_ESLESME = []; ARA_INDEX = -1;
}
function sohbetAraCalistir(){
  araTemizle();
  const q = $('sohbetAraIn').value.trim();
  if (!q){ $('sohbetAraSay').textContent=''; return; }
  const ql = q.toLowerCase();
  document.querySelectorAll('#akis .msg').forEach(el=>{
    if (el.classList.contains('silindi')) return;
    const m = el.querySelector('.metin'); if (!m || m.classList.contains('medya')) return;
    const t = m.textContent;
    if (t.toLowerCase().includes(ql)){ m.innerHTML = araVurgula(t, q); el.classList.add('ara-eslesme'); ARA_ESLESME.push(el); }
  });
  if (!ARA_ESLESME.length){ $('sohbetAraSay').textContent='0'; return; }
  araGit(ARA_ESLESME.length - 1, true);                // en yeni (en alttaki) eşleşmeye git
}
function araGit(hedef, mutlak){
  if (!ARA_ESLESME.length) return;
  if (ARA_INDEX>=0 && ARA_ESLESME[ARA_INDEX]) ARA_ESLESME[ARA_INDEX].classList.remove('ara-aktif');
  let i = mutlak ? hedef : (ARA_INDEX + hedef);
  i = (i + ARA_ESLESME.length) % ARA_ESLESME.length;   // sarmal gezinme
  ARA_INDEX = i;
  const el = ARA_ESLESME[i];
  el.classList.add('ara-aktif');
  el.scrollIntoView({block:'center', behavior:'smooth'});
  $('sohbetAraSay').textContent = (i+1) + ' / ' + ARA_ESLESME.length;
}
function sohbetAraAc(){
  if (!ODA) return;
  $('sohbetAraBar').classList.remove('gizli');
  const inp = $('sohbetAraIn'); inp.value=''; inp.focus();
  $('sohbetAraSay').textContent='';
}
function sohbetAraKapat(){
  araTemizle();
  const b=$('sohbetAraBar'); if (b) b.classList.add('gizli');
  const inp=$('sohbetAraIn'); if (inp) inp.value='';
  const say=$('sohbetAraSay'); if (say) say.textContent='';
}

// ════════ G10: tüm sohbetlerde arama (global, YEREL — her odanın mesajları çözülüp aranır; sunucuya arama sorgusu GİTMEZ) ════════
let GLOBAL_MSG = {};        // oda -> [{id, gonderen, ts, metin}]  (çözülmüş metin mesajlar)
let GLOBAL_MSG_TS = 0;      // cache zaman damgası (taze tutmak için)
let globalAraZ = null;
async function globalMsgYukle(){
  // tüm odaların mesajlarını paralel çek + YEREL çöz (E2E — düz-metin yalnız bu cihazda)
  const odalar = (ODALAR||[]).map(o=>o.oda);
  const sonuc = await Promise.all(odalar.map(async oda=>{
    try {
      const {ok,d} = await api('/api/mesajlar?oda='+encodeURIComponent(oda)+'&since=0');
      if (!ok || !Array.isArray(d)) return [oda, []];
      const liste = [];
      for (const m of d){
        if (m.silindi || !m.govde || m.govde.sema!=='e2e1') continue;   // silinmiş + medya atlanır
        const t = coz(m.govde);
        if (t && !t.startsWith('⟨')) liste.push({ id:m.id, gonderen:m.gonderen, ts:m.ts, metin:t });
      }
      return [oda, liste];
    } catch { return [oda, []]; }
  }));
  GLOBAL_MSG = {}; sonuc.forEach(([oda, liste])=> GLOBAL_MSG[oda]=liste);
  GLOBAL_MSG_TS = Date.now();
}
function globalAraTetikle(q){
  if (globalAraZ) clearTimeout(globalAraZ);
  const sorgu = (q||'').trim();
  if (sorgu.length < 2){ globalAraKapat(); return; }
  globalAraZ = setTimeout(()=>globalAraCalistir(sorgu), 220);
}
function globalAraKapat(){ const e=$('globalAra'); if (e){ e.classList.add('gizli'); e.innerHTML=''; } }
async function globalAraCalistir(q){
  if (Date.now() - GLOBAL_MSG_TS > 8000){ try { await globalMsgYukle(); } catch {} }   // taze tut (8s TTL)
  if ((($('aramaIn').value)||'').trim() !== q) return;       // kullanıcı bu arada değiştirdi → iptal
  const ql = q.toLowerCase();
  const bulunan = [];
  for (const oda of Object.keys(GLOBAL_MSG)){
    for (const m of GLOBAL_MSG[oda]){
      const idx = m.metin.toLowerCase().indexOf(ql);
      if (idx !== -1) bulunan.push({ oda, idx, ...m });
    }
  }
  bulunan.sort((a,b)=>(b.ts||0)-(a.ts||0));
  const kap = $('globalAra'); kap.innerHTML=''; kap.classList.remove('gizli');
  const bas = document.createElement('div'); bas.className='global-ara-bas';
  bas.textContent = bulunan.length ? ('Mesajlarda '+bulunan.length+' sonuç') : 'Mesajlarda sonuç yok';
  kap.appendChild(bas);
  const LIMIT = 60;
  bulunan.slice(0, LIMIT).forEach(r=>{
    const od = ODA_BILGI[r.oda] || {};
    const grup = od.tip==='grup';
    const peer = grup ? null : (od.uyeler||[]).find(u=>u!==BEN.kullanici)||null;
    const row = document.createElement('div'); row.className='satir oda ara-sonuc';
    row.dataset.oda = r.oda; row.dataset.mid = r.id;
    const av = document.createElement('div'); av.className='avatar';
    avatarKur(av, grup ? od.ad : (peer||odaAdGoster(od)), grup, peer);
    const g = document.createElement('div'); g.className='govde';
    const ust = document.createElement('div'); ust.className='ust';
    const adEl = document.createElement('span'); adEl.className='ad'; adEl.textContent = odaAdGoster(od);
    const saat = document.createElement('span'); saat.className='saat'; saat.textContent = zamanStr(r.ts);
    ust.appendChild(adEl); ust.appendChild(saat); g.appendChild(ust);
    const snip = document.createElement('div'); snip.className='onizle';
    const onek = (grup && r.gonderen) ? (gorAd(r.gonderen)+': ') : '';
    snip.innerHTML = esc(onek) + globalSnippet(r.metin, q, r.idx);
    g.appendChild(snip);
    row.appendChild(av); row.appendChild(g);
    row.onclick = ()=>globalAraSonucAc(r.oda, r.id);
    kap.appendChild(row);
  });
  if (bulunan.length > LIMIT){
    const f=document.createElement('div'); f.className='global-ara-bas global-ara-dipnot';
    f.textContent = '… ilk '+LIMIT+' gösteriliyor, aramayı daralt'; kap.appendChild(f);
  }
}
// eşleşme çevresinden kısa, vurgulu parçacık (XSS'e karşı esc'li)
function globalSnippet(metin, q, idx){
  const pad = 24;
  const bas = Math.max(0, idx - pad);
  const oncesi = (bas>0?'…':'') + metin.slice(bas, idx);
  const eslesme = metin.slice(idx, idx+q.length);
  const son = idx + q.length;
  const sonrasi = metin.slice(son, son+pad) + ((son+pad)<metin.length?'…':'');
  return esc(oncesi) + '<mark class="ara-im">' + esc(eslesme) + '</mark>' + esc(sonrasi);
}
async function globalAraSonucAc(oda, mid){
  await odaAc(oda);
  const el = document.querySelector(`#akis .msg[data-id="${mid}"]`);
  if (el){ el.scrollIntoView({block:'center', behavior:'smooth'}); el.classList.add('vurgu'); setTimeout(()=>el.classList.remove('vurgu'), 1400); }
}

function gunAyrac(ts){
  const w = document.createElement('div'); w.className='gun-ayrac';
  const s = document.createElement('span'); s.textContent = gunStr(ts); w.appendChild(s);
  return w;
}
function tikEl(okundu){
  const s = document.createElement('span'); s.className = 'tik'+(okundu?' okundu':'');
  s.innerHTML = okundu
    ? '<svg viewBox="0 0 22 16"><path d="M2 9l3.6 3.6L13 4"/><path d="M9 12.6 10 13.6 21 3.4"/></svg>'
    : '<svg viewBox="0 0 16 14"><path d="M2 8l4 4 8-9"/></svg>';
  return s;
}
// yalnız-emoji mesaj mı? (1-3 emoji, harf yok) → baloncuksuz iri göster
function sadeceEmoji(s){
  const t = (s||'').trim();
  if (!t || t.length > 24) return false;
  if (!/\p{Extended_Pictographic}/u.test(t)) return false;   // en az bir emoji
  if (/\p{L}/u.test(t)) return false;                        // harf varsa normal mesaj
  let adet;
  try { adet = [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(t)].filter(x=>x.segment.trim()).length; }
  catch { adet = t.replace(/\s/g,'').length; }               // Segmenter yoksa kaba sayım
  return adet >= 1 && adet <= 3;
}
function ekle(m, opt={}){
  // G7: engellenen kullanıcının mesajını GÖSTERME (kendi mesajım hariç)
  if (m && m.gonderen && m.gonderen!==BEN.kullanici && engelliMi(m.gonderen)) return;
  // G6: süresi dolmuş kaybolan mesaj → İZ BIRAKMADAN atla (tombstone gösterme); varsa eski baloncuğu da kaldır
  if (m && m.silindi && m.kaybolan){ if (m.id){ const e=document.querySelector(`#akis .msg[data-id="${m.id}"]`); if(e) e.remove(); delete KAYBOLAN_ZAMAN[m.id]; } return; }
  // FAZ G1: optimistik baloncuk eşleşmesi — gerçek eko (cid'li) geldi → optimistik kopyayı kaldır; optimistik zaten varsa tekrar çizme
  if (m && m.govde && m.govde.cid){
    const eski = $('akis').querySelector(`.msg[data-cid="${m.govde.cid}"]:not([data-id])`);
    if (eski){ if (m.id) eski.remove(); else return; }
  }
  if (m && m.id && document.querySelector(`#akis .msg[data-id="${m.id}"]`)) return;  // çift-çizme koru (reconnect/yarış)
  if (m.okuyanlar && m.okuyanlar.some(u=>u!==BEN.kullanici)) OKUNDU[m.id]=true;
  if (!opt.optimistik && m.ts>SON_TS) SON_TS=m.ts;
  const akis = $('akis');
  if (akis.querySelector('.bos')) akis.innerHTML='';
  const gun = gunKey(m.ts);
  if (gun !== SON_GUN){ SON_GUN = gun; akis.appendChild(gunAyrac(m.ts)); SON_KIM=null; }
  const ben = m.gonderen===BEN.kullanici;
  const grup = ODA_BILGI[ODA]?.tip==='grup';
  const zincir = (SON_KIM === m.gonderen);
  SON_KIM = m.gonderen;

  const el = document.createElement('div');
  el.className = 'msg'+(ben?' ben':'')+(zincir?' zincir':'')+(opt.optimistik?' iyimser':'');
  if (m.id) el.dataset.id = m.id;
  if (m.govde && m.govde.cid) el.dataset.cid = m.govde.cid;
  if (grup && !ben && !zincir){
    const kim = document.createElement('div'); kim.className='kim';
    kim.style.color = avatarRenk(m.gonderen); kim.textContent = gorAd(m.gonderen); el.appendChild(kim);
  }
  // alıntılı yanıt önizlemesi (varsa) — baloncuğun üstünde, tıklayınca orijinale kaydırır
  if (!m.silindi && m.govde && m.govde.sema==='e2e1' && m.govde.yanit){
    const y = cozYanit(m.govde);
    if (y){
      const q = document.createElement('div'); q.className='yanit-onizle';
      const qk = document.createElement('span'); qk.className='yanit-onizle-kim';
      qk.style.color = avatarRenk(y.kim); qk.textContent = gorAd(y.kim);
      const qt = document.createElement('span'); qt.className='yanit-onizle-on'; qt.textContent = y.onizleme || '(medya)';
      q.appendChild(qk); q.appendChild(qt);
      q.onclick = ()=>{ const o=document.querySelector(`#akis .msg[data-id="${y.id}"]`);
        if (o){ o.scrollIntoView({block:'center', behavior:'smooth'}); o.classList.add('vurgu'); setTimeout(()=>o.classList.remove('vurgu'), 1200); } };
      el.appendChild(q);
    }
  }
  const metin = document.createElement('span'); metin.className='metin';
  if (m.silindi){ el.classList.add('silindi'); metin.textContent = '🚫 Bu mesaj silindi'; }
  else if (m.govde && m.govde.sema==='e2e1m'){ metin.classList.add('medya'); metin.textContent='📎 yükleniyor…'; medyaGoster(metin, m.govde); }
  else { const _t = coz(m.govde); if (sadeceEmoji(_t)){ metin.textContent = _t; el.classList.add('jumbo'); } else metinYaz(metin, _t); }
  el.appendChild(metin);
  const meta = document.createElement('span'); meta.className='meta';
  meta.appendChild(document.createTextNode(zamanStr(m.ts)));
  if (!m.silindi && m.duzenlendi){                  // G9: düzenlenmiş mesaj işareti
    const di=document.createElement('span'); di.className='duzenli-im'; di.title='Bu mesaj düzenlendi'; di.textContent='düzenlendi'; meta.appendChild(di);
  }
  if (!m.silindi && m.id && yildizliMi(m)){         // G12: yıldızlı mesaj işareti
    const yi=document.createElement('span'); yi.className='yildiz-im'; yi.title='Yıldızlı'; yi.textContent='⭐'; meta.appendChild(yi);
  }
  if (!m.silindi && m.sil_ts){                      // G6: kaybolan mesaj → ⏱ işareti + yerel süre takibi
    KAYBOLAN_ZAMAN[m.id] = m.sil_ts;
    const k=document.createElement('span'); k.className='kaybolan-im'; k.title='Bu mesaj otomatik silinecek'; k.textContent='⏱'; meta.appendChild(k);
  }
  if (opt.optimistik){ const c=document.createElement('span'); c.className='bekliyor'; c.title='Gönderiliyor'; c.textContent='🕓'; meta.appendChild(c); }
  else if (ben && !m.silindi) meta.appendChild(tikEl(GIZLILIK.okundu && !!OKUNDU[m.id]));   // G8: okundu kapalıysa ✓✓ gösterme (karşılıklı)
  if (!m.silindi && m.id){                          // her mesaja "↩ yanıtla" (uzun-bas→sil yolundan bağımsız) — optimistik baloncukta yok
    const yb=document.createElement('button'); yb.type='button'; yb.className='yanitBtn';
    yb.title='Yanıtla'; yb.setAttribute('aria-label','Yanıtla'); yb.textContent='↩';
    yb.addEventListener('pointerdown', e=>e.stopPropagation());   // kendi mesajında uzun-bas-sil zamanlayıcısını tetikleme
    yb.onclick=(e)=>{ e.stopPropagation(); yanitlamayaBasla(m); };
    meta.appendChild(yb);
    const tb=document.createElement('button'); tb.type='button'; tb.className='tepkiBtn';
    tb.title='Tepki ver'; tb.setAttribute('aria-label','Tepki ver'); tb.textContent='🙂';
    tb.addEventListener('pointerdown', e=>e.stopPropagation());
    tb.onclick=(e)=>{ e.stopPropagation(); tepkiSecAc(m.id, tb); };
    meta.appendChild(tb);
  }
  el.appendChild(meta);

  // mesaj eylem menüsü: uzun-bas (mobil) / sağ-tık (masaüstü) → İlet · Kopyala · Yanıtla · (kendi) Sil
  if (!m.silindi && m.id) uzunBasBagla(el, m);      // optimistik (henüz gönderilmemiş) baloncukta menü yok
  if (m.id) el.addEventListener('click', (e)=>{ if (SECIM_MODU){ e.preventDefault(); e.stopPropagation(); secimToggle(m.id); } });   // G11: seçim modunda tıkla→seç

  akis.appendChild(el);
  akis.scrollTop = akis.scrollHeight;
  if (m.id){ MESAJ_MODEL[m.id] = m; if (SECIM_MODU){ el.classList.add('secilebilir'); if (SECILI.has(m.id)) el.classList.add('secili'); } }   // G11: model + seçim durumu
  if (m.id) tepkiSatiriCiz(m.id);                   // varsa mevcut tepkileri göster

  // okundu: başkasının mesajı + oda açık → işaretle
  if (!ben){ OKUNACAK.add(m.id); GORULEN[ODA] = Math.max(GORULEN[ODA]||0, m.ts); }
}

// okundu bildirimi (debounce) — sunucuya "bu id'leri gördüm" der → gönderene ✓✓ döner
function okunduGonderPlanla(){
  if (okunduZ) clearTimeout(okunduZ);
  okunduZ = setTimeout(async ()=>{
    const ids = Array.from(OKUNACAK); OKUNACAK.clear();
    if (!ids.length || !ODA) return;
    gorulenYaz(); odaListesiCiz($('aramaIn').value);
    if (!GIZLILIK.okundu) return;                            // G8: okundu kapalı → karşı tarafa ✓✓ gönderme
    await api('/api/okundu', {method:'POST', body:JSON.stringify({oda:ODA, ids})});
  }, 350);
}
function tikGuncelle(id){
  if (!GIZLILIK.okundu) return;                              // G8: okundu kapalıysa ✓✓'ye yükseltme
  const el = document.querySelector(`.msg[data-id="${id}"] .meta .tik`);
  if (el){ const yeni = tikEl(true); el.replaceWith(yeni); }
}

// ════════ mesaj sil (herkesten) ════════
// Yalnız KENDİ baloncuğuna bağlanır; sunucu da gönderen+üye kontrolü yapar.
function uzunBasBagla(el, m){
  let t=null;
  const iptal=()=>{ if(t){ clearTimeout(t); t=null; } };
  const baslat=()=>{ iptal(); t=setTimeout(()=>{ t=null; mesajMenuAc(m); }, 500); };
  el.addEventListener('pointerdown', baslat);
  el.addEventListener('pointerup', iptal);
  el.addEventListener('pointerleave', iptal);
  el.addEventListener('pointercancel', iptal);
  el.addEventListener('contextmenu', e=>{ e.preventDefault(); mesajMenuAc(m); });
}

// ════════ FAZ F2/F3: mesaj eylem menüsü (İlet · Kopyala · Yanıtla · Sil) ════════
function mesajMenuKapat(){ ['mesajMenu','mesajMenuOrt'].forEach(id=>{ const e=$(id); if (e) e.remove(); }); }
function mesajMenuAc(m){
  if (SECIM_MODU) return;                            // G11: seçim modunda menü açma (tıkla=seç)
  mesajMenuKapat();
  const ben = m.gonderen === BEN.kullanici;
  const medya = !!(m.govde && m.govde.sema==='e2e1m');
  const ort = document.createElement('div'); ort.className='mesaj-menu-ort'; ort.id='mesajMenuOrt'; ort.onclick=mesajMenuKapat;
  const sheet = document.createElement('div'); sheet.className='mesaj-menu'; sheet.id='mesajMenu';
  const ekle=(et, fn, sinif)=>{ const b=document.createElement('button'); b.type='button';
    b.className='mesaj-menu-btn'+(sinif?' '+sinif:''); b.textContent=et;
    b.onclick=()=>{ mesajMenuKapat(); fn(); }; sheet.appendChild(b); };
  ekle('↪ İlet', ()=>iletBaslat(m));
  if (!medya) ekle('📋 Kopyala', ()=>mesajKopyala(m));
  ekle('↩ Yanıtla', ()=>yanitlamayaBasla(m));
  if (ben && !medya) ekle('✏️ Düzenle', ()=>duzenlemeBasla(m));
  ekle(yildizliMi(m) ? '⭐ Yıldızı kaldır' : '⭐ Yıldızla', ()=>yildizDegistir(m));   // G12
  ekle(SABIT[m.oda||ODA]===m.id ? '📌 Sabiti kaldır' : '📌 Sabitle', ()=>sabitDegistir(m));
  ekle('☑️ Seç', ()=>secimBaslat(m));
  if (ben) ekle('🗑 Sil (herkesten)', ()=>mesajSil(m), 'tehlike');
  ekle('Vazgeç', ()=>{}, 'vazgec');
  document.body.appendChild(ort); document.body.appendChild(sheet);
}
// G5: kişi bilgisi + güvenlik numarası alt-sayfası (1:1 sohbette başlığa dokununca)
function kisiBilgiAc(peer){
  mesajMenuKapat();
  const pk = PUBKEYLER[peer];
  const ort = document.createElement('div'); ort.className='mesaj-menu-ort'; ort.id='mesajMenuOrt'; ort.onclick=mesajMenuKapat;
  const sheet = document.createElement('div'); sheet.className='mesaj-menu guv-sheet'; sheet.id='mesajMenu';

  const bas = document.createElement('div'); bas.className='guv-bas';
  const av = document.createElement('div'); av.className='avatar'; avatarKur(av, peer, false, peer);
  const isim = document.createElement('div'); isim.className='guv-isim';
  const ad = document.createElement('b'); ad.textContent = gorAd(peer);
  const kul = document.createElement('small'); kul.textContent = '@'+peer;
  isim.appendChild(ad); isim.appendChild(kul);
  bas.appendChild(av); bas.appendChild(isim); sheet.appendChild(bas);

  const degisti = DEGISEN.has(peer);
  if (degisti){
    const uy = document.createElement('div'); uy.className='guv-uyari';
    uy.innerHTML = '<b>⚠️ Güvenlik numarası değişti.</b> Bu kişi yeni bir cihaza geçmiş ya da '
      + 'anahtarını yenilemiş olabilir — ama araya giren biri de olabilir. '
      + 'Yeni numarayı karşı tarafla karşılaştırıp doğrulayın.';
    sheet.appendChild(uy);
  }

  const bl = document.createElement('div'); bl.className='guv-baslik'; bl.textContent='Güvenlik numarası';
  sheet.appendChild(bl);
  const grid = document.createElement('div'); grid.className='guv-num';
  const gruplar = (pk && BEN.pubkey) ? guvenlikNumarasi(BEN.pubkey, pk) : '';
  if (gruplar && gruplar.length){
    gruplar.forEach(g=>{ const s=document.createElement('span'); s.textContent=g; grid.appendChild(s); });
  } else {
    grid.classList.add('yok'); grid.textContent = 'Bu kişinin açık anahtarı henüz alınamadı.';
  }
  sheet.appendChild(grid);

  const ac = document.createElement('p'); ac.className='guv-aciklama';
  ac.textContent = 'Bu numarayı karşı tarafla (yüz yüze ya da güvendiğiniz başka bir kanaldan) karşılaştırın. '
    + 'İkinizde de aynıysa konuşmanız uçtan-uca güvenlidir; araya giren yoktur.';
  sheet.appendChild(ac);

  const dogrulandi = kisiDogrulandi(peer);
  if (gruplar && gruplar.length){
    const db = document.createElement('button'); db.type='button';
    db.className = 'mesaj-menu-btn guv-dogrula' + (dogrulandi?' onayli':'');
    db.textContent = dogrulandi ? '✓ Doğrulandı — geri al' : 'Eşleşiyor → doğrulandı işaretle';
    db.onclick = ()=>{ mesajMenuKapat();
      if (dogrulandi){ delete DOGRULANAN[peer]; _g5Yaz(); toast('Doğrulama geri alındı'); }
      else { kisiDogrula(peer); toast('@'+peer+' doğrulandı ✓'); }
      odaAltGuncelle(); };
    sheet.appendChild(db);
  }
  if (degisti){
    const kb = document.createElement('button'); kb.type='button'; kb.className='mesaj-menu-btn';
    kb.textContent = 'Doğrulamadan kabul et (yeni cihaz)';
    kb.onclick = ()=>{ mesajMenuKapat(); anahtarDegisimKabul(peer); toast('Yeni anahtar kabul edildi'); odaAltGuncelle(); };
    sheet.appendChild(kb);
  }
  // G7: engelle / engeli kaldır
  const engelli = engelliMi(peer);
  const eb = document.createElement('button'); eb.type='button';
  eb.className = 'mesaj-menu-btn' + (engelli?'':' tehlike');
  eb.textContent = engelli ? '✓ Engeli kaldır' : '🚫 Engelle';
  eb.onclick = ()=>{ mesajMenuKapat();
    if (engelli){ kisiEngelle(peer, false); }
    else if (confirm('@'+peer+' engellensin mi?\nMesajlarını görmezsiniz, bildirim gelmez.')) kisiEngelle(peer, true); };
  sheet.appendChild(eb);
  // N7: medya galerisi — yalnız bu kişinin AÇIK 1:1 sohbetindeyken (bloklu kişi listesinden açılışta yanlış-oda karışmasın)
  const galeriOda = (ODA && ODA_BILGI[ODA] && ODA_BILGI[ODA].tip!=='grup' && (ODA_BILGI[ODA].uyeler||[]).includes(peer)) ? ODA : null;
  if (galeriOda){
    const gb = document.createElement('button'); gb.type='button'; gb.className='mesaj-menu-btn galeri-ac';
    gb.textContent = '🖼 Medya galerisi'; gb.onclick = ()=>medyaGaleriAc(galeriOda); sheet.appendChild(gb);
  }
  // N7: sohbeti sessize al / sesi aç (bu 1:1 oda)
  if (ODA){
    const sb = document.createElement('button'); sb.type='button'; sb.className='mesaj-menu-btn';
    sb.textContent = sessizMi(ODA) ? '🔔 Sesi aç' : '🔕 Sessize al';
    sb.onclick = ()=>{ mesajMenuKapat(); sessizToggle(ODA); toast(sessizMi(ODA) ? 'Sohbet sessize alındı 🔕' : 'Bildirim sesi açıldı 🔔'); };
    sheet.appendChild(sb);
  }
  const v=document.createElement('button'); v.type='button'; v.className='mesaj-menu-btn vazgec'; v.textContent='Kapat';
  v.onclick=mesajMenuKapat; sheet.appendChild(v);
  document.body.appendChild(ort); document.body.appendChild(sheet);
}

// ════════ H3: grup yönetimi alt-sayfası (grup sohbetinde başlığa dokununca) ════════
function grupBilgiAc(oda){
  mesajMenuKapat();
  const od = ODA_BILGI[oda]; if (!od || od.tip!=='grup') return;
  const uyeler = od.uyeler || [];
  const ort = document.createElement('div'); ort.className='mesaj-menu-ort'; ort.id='mesajMenuOrt'; ort.onclick=mesajMenuKapat;
  const sheet = document.createElement('div'); sheet.className='mesaj-menu guv-sheet grup-sheet'; sheet.id='mesajMenu';
  // başlık: grup fotoğrafı (dokun→değiştir) + ad + üye sayısı
  const bas = document.createElement('div'); bas.className='guv-bas';
  const av = document.createElement('div'); av.className='avatar tiklanir'; avatarKur(av, od.ad, true, null, od.avatar);
  const fin = document.createElement('input'); fin.type='file'; fin.accept='image/*'; fin.hidden=true;
  fin.onchange = (e)=>grupFotoSecildi(oda, e); av.onclick = ()=>fin.click();
  const isim = document.createElement('div'); isim.className='guv-isim';
  const ad = document.createElement('b'); ad.textContent = od.ad;
  const sm = document.createElement('small'); sm.textContent = uyeler.length+' üye';
  isim.appendChild(ad); isim.appendChild(sm);
  bas.appendChild(av); bas.appendChild(isim); sheet.appendChild(bas); sheet.appendChild(fin);
  const foto = document.createElement('button'); foto.type='button'; foto.className='mesaj-menu-btn';
  foto.textContent = od.avatar ? '🖼 Grup fotoğrafını değiştir' : '🖼 Grup fotoğrafı ekle'; foto.onclick=()=>fin.click(); sheet.appendChild(foto);
  if (od.avatar){ const fk=document.createElement('button'); fk.type='button'; fk.className='mesaj-menu-btn'; fk.textContent='Fotoğrafı kaldır'; fk.onclick=()=>grupFotoKaldir(oda); sheet.appendChild(fk); }
  // üye listesi
  const bl = document.createElement('div'); bl.className='guv-baslik'; bl.textContent='Üyeler ('+uyeler.length+'/4)'; sheet.appendChild(bl);
  const lst = document.createElement('div'); lst.className='grup-uye-liste';
  uyeler.forEach(u=>{
    const r = document.createElement('div'); r.className='grup-uye';
    const a = document.createElement('div'); a.className='avatar kucuk'; avatarKur(a, u, false, u);
    const n = document.createElement('span'); n.className='grup-uye-ad'; n.textContent = (u===BEN.kullanici ? 'Sen' : gorAd(u));
    r.appendChild(a); r.appendChild(n);
    if (u!==BEN.kullanici){ const cb=document.createElement('button'); cb.type='button'; cb.className='grup-uye-cikar'; cb.title='Çıkar'; cb.setAttribute('aria-label','Çıkar'); cb.textContent='✕'; cb.onclick=()=>grupUyeCikar(oda, u); r.appendChild(cb); }
    lst.appendChild(r);
  });
  sheet.appendChild(lst);
  // üye ekle (kişilerden, grupta olmayan + ≤4)
  if (uyeler.length < 4){
    const eklenebilir = (KISILER||[]).map(k=>k.kullanici).filter(u=>!uyeler.includes(u));
    if (eklenebilir.length){
      const eb = document.createElement('button'); eb.type='button'; eb.className='mesaj-menu-btn'; eb.textContent='➕ Üye ekle';
      eb.onclick=()=>grupUyeEkleAc(oda, eklenebilir); sheet.appendChild(eb);
    }
  } else {
    const not = document.createElement('p'); not.className='guv-aciklama'; not.textContent='Grup dolu (mesh 4 kişi sınırı). Daha kalabalık grup görüntülü = ileride (SFU, yatırım sonrası).'; sheet.appendChild(not);
  }
  // N7: medya galerisi (bu grupta paylaşılan görsel + dosyalar)
  { const gb = document.createElement('button'); gb.type='button'; gb.className='mesaj-menu-btn galeri-ac';
    gb.textContent = '🖼 Medya galerisi'; gb.onclick = ()=>medyaGaleriAc(oda); sheet.appendChild(gb); }
  // N7: grubu sessize al / sesi aç
  const sb = document.createElement('button'); sb.type='button'; sb.className='mesaj-menu-btn';
  sb.textContent = sessizMi(oda) ? '🔔 Sesi aç' : '🔕 Sessize al';
  sb.onclick = ()=>{ mesajMenuKapat(); sessizToggle(oda); toast(sessizMi(oda) ? 'Grup sessize alındı 🔕' : 'Bildirim sesi açıldı 🔔'); };
  sheet.appendChild(sb);
  // gruptan ayrıl
  const ab = document.createElement('button'); ab.type='button'; ab.className='mesaj-menu-btn tehlike'; ab.textContent='Gruptan ayrıl';
  ab.onclick=()=>{ if (confirm('Gruptan ayrılmak istiyor musun?\nYeniden eklenmen gerekir.')) grupAyril(oda); };
  sheet.appendChild(ab);
  const v=document.createElement('button'); v.type='button'; v.className='mesaj-menu-btn vazgec'; v.textContent='Kapat'; v.onclick=mesajMenuKapat; sheet.appendChild(v);
  document.body.appendChild(ort); document.body.appendChild(sheet);
}
function grupFotoSecildi(oda, e){
  const f=e.target.files&&e.target.files[0]; e.target.value='';
  if (!f) return;
  if (f.size > 256*1024){ toast('Fotoğraf çok büyük (max 256KB)'); return; }
  const fr=new FileReader();
  fr.onload=async ()=>{
    const {ok,d}=await api('/api/oda-foto',{method:'POST',body:JSON.stringify({oda, avatar:String(fr.result)})});
    if (!ok){ toast((d&&d.hata)||'foto güncellenemedi'); return; }
    toast('Grup fotoğrafı güncellendi'); await yenile();
    if (ODA===oda){ const od=ODA_BILGI[oda]; avatarKur($('odaAvatar'), od.ad, true, null, od.avatar); }
    mesajMenuKapat();
  };
  fr.readAsDataURL(f);
}
async function grupFotoKaldir(oda){
  const {ok,d}=await api('/api/oda-foto',{method:'POST',body:JSON.stringify({oda, avatar:''})});
  if (!ok){ toast((d&&d.hata)||'kaldırılamadı'); return; }
  toast('Fotoğraf kaldırıldı'); await yenile();
  if (ODA===oda) avatarKur($('odaAvatar'), ODA_BILGI[oda].ad, true, null, null);
  mesajMenuKapat();
}
async function grupUyeCikar(oda, u){
  if (!confirm('@'+u+' gruptan çıkarılsın mı?')) return;
  const {ok,d}=await api('/api/oda-uye',{method:'POST',body:JSON.stringify({oda, eylem:'cikar', kullanici:u})});
  if (!ok){ toast((d&&d.hata)||'çıkarılamadı'); return; }
  toast('@'+u+' çıkarıldı'); await yenile(); mesajMenuKapat(); grupBilgiAc(oda);
}
async function grupAyril(oda){
  const {ok,d}=await api('/api/oda-uye',{method:'POST',body:JSON.stringify({oda, eylem:'ayril'})});
  if (!ok){ toast((d&&d.hata)||'ayrılınamadı'); return; }
  toast('Gruptan ayrıldın'); mesajMenuKapat();
  if (grupDurumu()!=='bos' && grupOdasi()===oda) grupKapat();
  ODA=null; odaGorunumKapat(); gorunumGec('sohbetler'); await yenile();
}
function grupUyeEkleAc(oda, eklenebilir){
  mesajMenuKapat();
  const ort=document.createElement('div'); ort.className='mesaj-menu-ort'; ort.id='mesajMenuOrt'; ort.onclick=mesajMenuKapat;
  const sheet=document.createElement('div'); sheet.className='mesaj-menu'; sheet.id='mesajMenu';
  const bl=document.createElement('div'); bl.className='guv-baslik'; bl.textContent='Üye ekle'; sheet.appendChild(bl);
  eklenebilir.forEach(u=>{
    const b=document.createElement('button'); b.type='button'; b.className='mesaj-menu-btn';
    const a=document.createElement('span'); a.className='av-mini'; b.textContent=gorAd(u); b.onclick=()=>grupUyeEkle(oda, u); sheet.appendChild(b);
  });
  const v=document.createElement('button'); v.type='button'; v.className='mesaj-menu-btn vazgec'; v.textContent='Vazgeç'; v.onclick=()=>{ mesajMenuKapat(); grupBilgiAc(oda); }; sheet.appendChild(v);
  document.body.appendChild(ort); document.body.appendChild(sheet);
}
async function grupUyeEkle(oda, u){
  const {ok,d}=await api('/api/oda-uye',{method:'POST',body:JSON.stringify({oda, eylem:'ekle', kullanici:u})});
  if (!ok){ toast((d&&d.hata)||'eklenemedi'); return; }
  toast('@'+u+' eklendi'); await yenile(); mesajMenuKapat(); grupBilgiAc(oda);
}

// G6: kaybolan mesaj süresi alt-sayfası (sohbet başlığındaki ⏱ ile açılır)
function kaybolanAyarAc(oda){
  mesajMenuKapat();
  const ort = document.createElement('div'); ort.className='mesaj-menu-ort'; ort.id='mesajMenuOrt'; ort.onclick=mesajMenuKapat;
  const sheet = document.createElement('div'); sheet.className='mesaj-menu kaybolan-sheet'; sheet.id='mesajMenu';
  const bas = document.createElement('div'); bas.className='guv-baslik'; bas.textContent='⏱ Kaybolan mesajlar';
  sheet.appendChild(bas);
  const ac = document.createElement('p'); ac.className='guv-aciklama';
  ac.textContent = 'Açıkken bu sohbette GÖNDERDİĞİN mesajlar, seçtiğin süre sonunda hem sende hem karşı tarafta '
    + 'otomatik silinir (süre gönderdiğin andan işler). Uçtan-uca şifreleme korunur.';
  sheet.appendChild(ac);
  const secili = kaybolSn(oda);
  KAYBOLAN_SECENEK.forEach(([sn, et])=>{
    const b=document.createElement('button'); b.type='button';
    b.className='mesaj-menu-btn kaybolan-sec'+(sn===secili?' onayli':'');
    b.textContent = (sn===secili?'✓ ':'') + et;
    b.onclick=()=>{ mesajMenuKapat();
      if (sn) KAYBOLAN[oda]=sn; else delete KAYBOLAN[oda];
      kaybolanYaz();
      toast(sn ? 'Kaybolan mesajlar: '+et : 'Kaybolan mesajlar kapalı');
      kaybolanBtnGuncelle(); };
    sheet.appendChild(b);
  });
  const v=document.createElement('button'); v.type='button'; v.className='mesaj-menu-btn vazgec'; v.textContent='Kapat';
  v.onclick=mesajMenuKapat; sheet.appendChild(v);
  document.body.appendChild(ort); document.body.appendChild(sheet);
}
// başlıktaki ⏱ butonunu aktif/pasif görünüme getir (TTL açıksa vurgu)
function kaybolanBtnGuncelle(){
  const b=$('kaybolanBtn'); if(!b) return;
  const aktif = !!(ODA && kaybolSn(ODA));
  b.classList.toggle('vurgu', aktif);
  b.title = aktif ? ('Kaybolan mesajlar: '+kaybolanEtiket(kaybolSn(ODA))) : 'Kaybolan mesajlar';
}
async function mesajKopyala(m){
  const metin = coz(m.govde);
  if (!metin){ toast('Kopyalanamadı'); return; }
  try { await navigator.clipboard.writeText(metin); toast('Kopyalandı'); }
  catch { try {                                   // clipboard API yoksa eski yöntem
    const ta=document.createElement('textarea'); ta.value=metin; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Kopyalandı');
  } catch { toast('Kopyalanamadı'); } }
}
// hedef sohbet seçici → seçilince iletGonder
function iletBaslat(m){
  mesajMenuKapat();
  const hedefler = (ODALAR||[]).filter(o=>o.oda!==ODA);
  if (!hedefler.length){ toast('İletilecek başka sohbet yok'); return; }
  const ort = document.createElement('div'); ort.className='mesaj-menu-ort'; ort.id='mesajMenuOrt'; ort.onclick=mesajMenuKapat;
  const sheet = document.createElement('div'); sheet.className='mesaj-menu ilet-sec'; sheet.id='mesajMenu';
  const bas = document.createElement('div'); bas.className='ilet-sec-bas'; bas.textContent='İlet →'; sheet.appendChild(bas);
  hedefler.forEach(o=>{ const b=document.createElement('button'); b.type='button'; b.className='mesaj-menu-btn ilet-hedef';
    b.textContent = odaAdGoster(o); b.onclick=()=>{ mesajMenuKapat(); iletGonder(m, o.oda); }; sheet.appendChild(b); });
  const v=document.createElement('button'); v.type='button'; v.className='mesaj-menu-btn vazgec'; v.textContent='Vazgeç';
  v.onclick=mesajMenuKapat; sheet.appendChild(v);
  document.body.appendChild(ort); document.body.appendChild(sheet);
}
// E2E iletme çekirdeği: metin → hedef üyeler için yeniden şifrele; medya → K'yı çöz + hedef için yeniden sar (aynı medya_id).
// Sunucu düz görmez. Başarıyı döndürür (toast YOK — tekli ve toplu yollar paylaşır).
async function iletEt(m, hedefOda){
  const od = ODA_BILGI[hedefOda]; if (!od || !m || m.silindi) return false;
  try {
    let blob;
    if (m.govde && m.govde.sema==='e2e1m'){
      const benim = (m.govde.anahtarlar||[]).find(a=>a.uye===BEN.kullanici);
      if (!benim) return false;
      const K = S.crypto_box_open_easy(ub64(benim.anahtar), ub64(benim.n2), ub64(m.govde.gonderenPub), PRIV);
      const anahtarlar=[];
      for (const uye of od.uyeler){ const pub=PUBKEYLER[uye]; if(!pub) continue;
        const n2=S.randombytes_buf(S.crypto_box_NONCEBYTES);
        anahtarlar.push({uye, n2:b64(n2), anahtar:b64(S.crypto_box_easy(K, n2, ub64(pub), PRIV))}); }
      blob = {sema:'e2e1m', medya_id:m.govde.medya_id, ad:m.govde.ad, mime:m.govde.mime, boyut:m.govde.boyut,
              n:m.govde.n, gonderenPub:BEN.pubkey, anahtarlar};
      if (m.govde.sesli){ blob.sesli=true; blob.sure=m.govde.sure; }
    } else {
      const metin = coz(m.govde); if (!metin || metin.startsWith('⟨')) return false;
      blob = sifrele(metin, od.uyeler);
    }
    const {ok} = await api('/api/mesaj', {method:'POST', body:JSON.stringify({oda:hedefOda, govde:blob})});
    return !!ok;
  } catch(e){ return false; }
}
async function iletGonder(m, hedefOda){
  const ok = await iletEt(m, hedefOda);
  toast(ok ? 'İletildi → '+odaAdGoster(ODA_BILGI[hedefOda]) : 'İletilemedi');
}
async function mesajSil(m){
  if (!m || m.silindi) return;
  if (!confirm('Bu mesaj herkesten silinsin mi?\nKarşı taraftan da kaldırılır, geri alınamaz.')) return;
  const {ok,d} = await api('/api/mesaj-sil', {method:'POST', body:JSON.stringify({oda:m.oda||ODA, id:m.id})});
  if (!ok){ toast((d&&d.hata)||'silinemedi'); return; }
  m.silindi = true;                 // tekrar tetikleme/çift-onay olmasın
  baloncukSilindiYap(m.id);         // anında geri-bildirim (SSE de gelir; idempotent)
}
function baloncukSilindiYap(id){
  const el = document.querySelector(`.msg[data-id="${id}"]`);
  if (!el) return;
  el.classList.add('silindi');
  const metin = el.querySelector('.metin'); if (metin) metin.textContent = '🚫 Bu mesaj silindi';
  const tik = el.querySelector('.meta .tik'); if (tik) tik.remove();
}

// ════════ G11: çoklu mesaj seçimi (toplu ilet / sil) ════════
let SECIM_MODU = false;
let SECILI = new Set();                 // seçili mesaj id'leri
function secimBaslat(m){
  SECIM_MODU = true; SECILI.clear();
  document.body.classList.add('secim-modu');
  document.querySelectorAll('#akis .msg[data-id]:not(.silindi)').forEach(el=> el.classList.add('secilebilir'));
  $('secimBar').classList.remove('gizli');
  if (m && m.id) secimToggle(m.id); else secimGuncelle();
}
function secimToggle(id){
  if (!id || !MESAJ_MODEL[id] || MESAJ_MODEL[id].silindi) return;
  const el = document.querySelector(`#akis .msg[data-id="${id}"]`);
  if (SECILI.has(id)){ SECILI.delete(id); el && el.classList.remove('secili'); }
  else { SECILI.add(id); el && el.classList.add('secili'); }
  if (!SECILI.size){ secimBitir(); return; }     // hepsi bırakıldı → moddan çık
  secimGuncelle();
}
function secimGuncelle(){
  const n = SECILI.size;
  const benimSayi = [...SECILI].filter(id=>MESAJ_MODEL[id] && MESAJ_MODEL[id].gonderen===BEN.kullanici).length;
  $('secimSay').textContent = n + ' seçili';
  const silBtn = $('secimSilBtn');
  silBtn.classList.toggle('gizli', benimSayi===0);   // silinebilecek (kendi) mesaj yoksa Sil'i gizle
}
function secimBitir(){
  SECIM_MODU = false; SECILI.clear();
  document.body.classList.remove('secim-modu');
  document.querySelectorAll('#akis .msg.secili,#akis .msg.secilebilir').forEach(el=> el.classList.remove('secili','secilebilir'));
  const b = $('secimBar'); if (b) b.classList.add('gizli');
}
// toplu ilet: hedef sohbet seçici → her seçili mesaj hedef için YENİDEN şifrelenir (E2E)
function secimIletBaslat(){
  const ids = [...SECILI]; if (!ids.length) return;
  const hedefler = (ODALAR||[]).filter(o=>o.oda!==ODA);
  if (!hedefler.length){ toast('İletilecek başka sohbet yok'); return; }
  mesajMenuKapat();
  const ort = document.createElement('div'); ort.className='mesaj-menu-ort'; ort.id='mesajMenuOrt'; ort.onclick=mesajMenuKapat;
  const sheet = document.createElement('div'); sheet.className='mesaj-menu ilet-sec'; sheet.id='mesajMenu';
  const bas = document.createElement('div'); bas.className='ilet-sec-bas'; bas.textContent = ids.length+' mesajı ilet →'; sheet.appendChild(bas);
  hedefler.forEach(o=>{ const b=document.createElement('button'); b.type='button'; b.className='mesaj-menu-btn ilet-hedef';
    b.textContent = odaAdGoster(o); b.onclick=()=>{ mesajMenuKapat(); secimIletGonder(o.oda); }; sheet.appendChild(b); });
  const v=document.createElement('button'); v.type='button'; v.className='mesaj-menu-btn vazgec'; v.textContent='Vazgeç';
  v.onclick=mesajMenuKapat; sheet.appendChild(v);
  document.body.appendChild(ort); document.body.appendChild(sheet);
}
async function secimIletGonder(hedefOda){
  const ids = [...SECILI].sort((a,b)=>(MESAJ_MODEL[a]?.ts||0)-(MESAJ_MODEL[b]?.ts||0));   // kronolojik ilet
  let ok=0;
  for (const id of ids){ if (await iletEt(MESAJ_MODEL[id], hedefOda)) ok++; }
  toast(ok ? (ok+' mesaj iletildi → '+odaAdGoster(ODA_BILGI[hedefOda])) : 'İletilemedi');
  secimBitir();
}
// toplu sil: yalnız KENDİ seçili mesajların (herkesten)
async function secimSil(){
  const benim = [...SECILI].filter(id=>MESAJ_MODEL[id] && MESAJ_MODEL[id].gonderen===BEN.kullanici && !MESAJ_MODEL[id].silindi);
  if (!benim.length){ toast('Kendi mesajın seçili değil'); return; }
  if (!confirm(benim.length+' mesaj herkesten silinsin mi?\nKarşı taraftan da kaldırılır, geri alınamaz.')) return;
  let ok=0;
  for (const id of benim){
    const m = MESAJ_MODEL[id];
    const {ok:r} = await api('/api/mesaj-sil', {method:'POST', body:JSON.stringify({oda:m.oda||ODA, id})});
    if (r){ m.silindi=true; baloncukSilindiYap(id); ok++; }
  }
  toast(ok+' mesaj silindi');
  secimBitir();
}

// ════════ G12: sabitlenen (oda, üyelere görünür) + yıldızlı (kişisel) mesajlar ════════
const yKey = (oda, id) => oda + '|' + id;
function yildizliMi(m){ return !!(m && m.id) && YILDIZ.has(yKey(m.oda||ODA, m.id)); }
async function yildizDegistir(m){
  if (!m || !m.id) return;
  const oda = m.oda||ODA, id = m.id, yeni = !yildizliMi(m);
  const {ok,d} = await api('/api/yildizla', {method:'POST', body:JSON.stringify({oda, id, yildiz:yeni})});
  if (!ok){ toast((d&&d.hata)||'olmadı'); return; }
  if (yeni) YILDIZ.add(yKey(oda,id)); else YILDIZ.delete(yKey(oda,id));
  yildizIsaretGuncelle(id, yeni);
  toast(yeni ? '⭐ Yıldızlandı' : 'Yıldız kaldırıldı');
}
function yildizIsaretGuncelle(id, on){
  const el = document.querySelector(`#akis .msg[data-id="${id}"]`); if (!el) return;
  const meta = el.querySelector('.meta'); if (!meta) return;
  const mevcut = meta.querySelector('.yildiz-im');
  if (on && !mevcut){ const yi=document.createElement('span'); yi.className='yildiz-im'; yi.title='Yıldızlı'; yi.textContent='⭐'; meta.appendChild(yi); }
  else if (!on && mevcut) mevcut.remove();
}
// — sabit (pin): oda başına bir mesaj, üyelere görünür —
function sabitDegistir(m){ if (!m || !m.id) return; sabitYap(ODA, SABIT[ODA]===m.id ? null : m.id); }
async function sabitYap(oda, id){
  const {ok,d} = await api('/api/sabitle', {method:'POST', body:JSON.stringify({oda, id, sabit:!!id})});
  if (!ok){ toast((d&&d.hata)||'sabitlenemedi'); return; }
  if (id) SABIT[oda]=id; else delete SABIT[oda];
  if (oda===ODA) sabitGuncelle();
  toast(id ? '📌 Sabitlendi' : 'Sabit kaldırıldı');
}
function sabitGuncelle(){
  const bar = $('sabitBar'); if (!bar) return;
  const id = SABIT[ODA];
  if (!id){ bar.classList.add('gizli'); return; }
  const m = MESAJ_MODEL[id];
  $('sabitOn').textContent = m ? (mesajOnizleMetni(m) || '(mesaj)') : '📌 Sabitli mesaj';
  bar.classList.remove('gizli');
  bar.onclick = ()=>{ const el=document.querySelector(`#akis .msg[data-id="${id}"]`);
    if (el){ el.scrollIntoView({block:'center', behavior:'smooth'}); el.classList.add('vurgu'); setTimeout(()=>el.classList.remove('vurgu'),1400); } };
}
function sabitKaldirTik(e){ e.stopPropagation(); if (SABIT[ODA]) sabitYap(ODA, null); }
// — yıldızlı mesajlar listesi (Ayarlar → tam ekran; mesajlar yerel çözülür, E2E) —
async function yildizliListeAc(){
  const kayitlar = [...YILDIZ].map(k=>{ const i=k.indexOf('|'); return {oda:k.slice(0,i), id:k.slice(i+1)}; });
  const ort = document.createElement('div'); ort.className='yildizli-panel'; ort.id='yildizliPanel';
  const bas = document.createElement('div'); bas.className='yildizli-bas bar';
  const geri = document.createElement('button'); geri.className='bar-btn'; geri.type='button'; geri.textContent='✕'; geri.onclick=()=>ort.remove();
  const blk = document.createElement('b'); blk.textContent='⭐ Yıldızlı mesajlar';
  bas.appendChild(geri); bas.appendChild(blk); ort.appendChild(bas);
  const liste = document.createElement('div'); liste.className='yildizli-liste liste'; ort.appendChild(liste);
  document.body.appendChild(ort);
  if (!kayitlar.length){ liste.innerHTML = bosDurumHTML('Yıldızlı mesaj yok', 'Bir mesaja uzun-bas → ⭐ Yıldızla.'); return; }
  const odaIds = {}; kayitlar.forEach(r=>{ (odaIds[r.oda]||(odaIds[r.oda]=new Set())).add(r.id); });
  const satirlar = [];
  for (const oda of Object.keys(odaIds)){
    let d=[]; try { const r=await api('/api/mesajlar?oda='+encodeURIComponent(oda)+'&since=0'); if (r.ok&&Array.isArray(r.d)) d=r.d; } catch {}
    for (const m of d){ if (odaIds[oda].has(m.id) && !m.silindi) satirlar.push({oda, m}); }
  }
  satirlar.sort((a,b)=>(b.m.ts||0)-(a.m.ts||0));
  if (!satirlar.length){ liste.innerHTML = bosDurumHTML('Yıldızlı mesaj yok', 'Yıldızladığın mesajlar burada görünür.'); return; }
  satirlar.forEach(({oda,m})=>{
    const od = ODA_BILGI[oda] || {};
    const grup = od.tip==='grup'; const peer = grup ? null : (od.uyeler||[]).find(u=>u!==BEN.kullanici)||null;
    const row = document.createElement('div'); row.className='satir oda';
    const av=document.createElement('div'); av.className='avatar'; avatarKur(av, grup?od.ad:(peer||odaAdGoster(od)), grup, peer);
    const g=document.createElement('div'); g.className='govde';
    const ust=document.createElement('div'); ust.className='ust';
    const adEl=document.createElement('span'); adEl.className='ad'; adEl.textContent=odaAdGoster(od);
    const saat=document.createElement('span'); saat.className='saat'; saat.textContent=zamanStr(m.ts);
    ust.appendChild(adEl); ust.appendChild(saat); g.appendChild(ust);
    const on=document.createElement('div'); on.className='onizle'; on.textContent = mesajOnizleMetni(m) || '(mesaj)';
    g.appendChild(on); row.appendChild(av); row.appendChild(g);
    row.onclick=()=>{ ort.remove(); globalAraSonucAc(oda, m.id); };
    liste.appendChild(row);
  });
}

// ════════ G9: mesaj düzenleme (edit, E2E) ════════
// Yeni metin oda üyeleri için YENİDEN şifrelenir (sunucu opak govde saklar) → /api/mesaj-duzenle.
// Varsa alıntılı yanıt korunur. SSE 'duzenlendi' iki tarafta baloncuğu günceller.
async function duzenleGonder(metin, od){
  const m = DUZENLE;
  if (!m){ return; }
  if (metin === coz(m.govde)){ duzenleIptal(); return; }       // değişiklik yok → çık
  const y = cozYanit(m.govde);                                  // orijinal alıntıyı koru
  const blob = sifrele(metin, od.uyeler, y ? {id:y.id, kim:y.kim, onizleme:y.onizleme} : null);
  const id = m.id, oda = m.oda || ODA;
  duzenleIptal();
  const {ok,d} = await api('/api/mesaj-duzenle', {method:'POST', body:JSON.stringify({oda, id, govde:blob})});
  if (!ok){ toast((d&&d.hata)||'düzenlenemedi'); return; }
  m.govde = blob; m.duzenlendi = true;                          // yerel modeli güncelle
  baloncukDuzenle(id, blob);                                    // anında geri-bildirim (SSE de gelir; idempotent)
}
// baloncuk metnini yeni govde'yle güncelle + "düzenlendi" işareti (yerel + SSE ortak)
function baloncukDuzenle(id, govde){
  const el = document.querySelector(`#akis .msg[data-id="${id}"]`);
  if (!el || el.classList.contains('silindi')) return;
  const metin = el.querySelector('.metin');
  if (metin){ const t = coz(govde); const je = sadeceEmoji(t); el.classList.toggle('jumbo', je); if (je) metin.textContent = t; else metinYaz(metin, t); }
  duzenliIsaret(el);
}
function duzenliIsaret(el){
  const meta = el.querySelector('.meta'); if (!meta || meta.querySelector('.duzenli-im')) return;
  const im = document.createElement('span'); im.className='duzenli-im'; im.title='Bu mesaj düzenlendi'; im.textContent='düzenlendi';
  meta.insertBefore(im, meta.firstChild ? meta.firstChild.nextSibling : null);   // zaman etiketinden sonra
}

// ════════ "yazıyor…" + çevrimiçi ════════
let yaziyorSon = 0, yazGosterZ = null;
function yaziyorBildir(){
  // yazarken oda üyelerine geçici sinyal (kısma: en çok ~2.5s'de bir)
  if (!ODA) return;
  const now = performance.now();
  if (now - yaziyorSon < 2500) return;
  yaziyorSon = now;
  api('/api/yaziyor', {method:'POST', body:JSON.stringify({oda:ODA})});
}
function yaziyorGoster(kim){
  const alt = $('odaUyeler'); if (!alt) return;
  alt.textContent = '@'+kim+' yazıyor…'; alt.classList.add('yaziyor-aktif');
  if (yazGosterZ) clearTimeout(yazGosterZ);
  yazGosterZ = setTimeout(()=>{ alt.classList.remove('yaziyor-aktif'); odaAltGuncelle(); }, 4000);
}
// hafif "nabız": uygulama açıkken kendi çevrimiçiliğini taze tut + kişi noktalarını yenile
let nabizZ = null;
function nabizBasla(){
  if (nabizZ) return;
  nabizZ = setInterval(async ()=>{
    if (document.hidden || !BEN) return;
    api('/api/ben');                                  // son-görülme tazele (çevrimiçi kal)
    try { await yenile(); if (ODA) odaAltGuncelle(); } catch {}   // kişi noktaları + başlık tazelensin
  }, 20000);
}

// ════════ profil (görünen ad + avatar) ════════
let _avatarBekleyen = null;   // {base64, mime} — kaydedilmemiş seçili foto
function avatarSecildi(e){
  const f = e.target.files && e.target.files[0]; e.target.value='';
  if (!f) return;
  if (f.size > 256*1024){ toast('Fotoğraf çok büyük (max 256KB)'); return; }
  const fr = new FileReader();
  fr.onload = ()=>{
    const url = String(fr.result);                  // data:<mime>;base64,XXXX
    _avatarBekleyen = { base64: url.split(',')[1]||'', mime: (url.match(/^data:([^;]+)/)||[])[1] || f.type || 'image/png' };
    const el = $('benAvatar'); el.classList.add('foto'); el.textContent='';
    el.style.backgroundImage = 'url('+url+')';       // anlık önizleme
  };
  fr.readAsDataURL(f);
}
async function profilKaydet(){
  const ad = $('adIn').value.trim();
  const body = { ad };
  if (_avatarBekleyen){ body.avatar = _avatarBekleyen.base64; body.avatar_mime = _avatarBekleyen.mime; }
  const {ok,d} = await api('/api/profil', {method:'POST', body:JSON.stringify(body)});
  if (!ok){ toast((d&&d.hata)||'kaydedilemedi'); return; }
  _avatarBekleyen = null;
  if (ad) ADLAR[BEN.kullanici]=ad; else delete ADLAR[BEN.kullanici];
  toast('Profil kaydedildi');
  await yenile();
  avatarKur($('benAvatar'), BEN.kullanici, false, BEN.kullanici);
}

function sseBagla(){
  if (ES) ES.close();
  ES = new EventSource(API_KOK+'/api/akis?oda='+encodeURIComponent(ODA), {withCredentials: !!API_KOK});
  ES.onmessage = (e)=>{
    let o; try{ o=JSON.parse(e.data); }catch{ return; }
    if (o.tip==='yeni-mesaj'){ ekle(o.mesaj); okunduGonderPlanla(); if (o.mesaj && o.mesaj.gonderen!==BEN.kullanici && !engelliMi(o.mesaj.gonderen) && !sessizMi(o.mesaj.oda) && document.hidden) bipCal(); }   // FAZ G4 ses + G7 engelliyi sustur + N7 sessiz odayı sustur
    else if (o.tip==='okundu' && o.okuyan!==BEN.kullanici){ (o.ids||[]).forEach(id=>{ OKUNDU[id]=true; tikGuncelle(id); }); }
    else if (o.tip==='oda-ad'){ if (ODA_BILGI[o.oda]) ODA_BILGI[o.oda].ad=o.ad; if (o.oda===ODA) $('odaBaslik').textContent=odaAdGoster(ODA_BILGI[o.oda]); odaListesiCiz($('aramaIn').value); }
    else if (o.tip==='silindi'){
      if (o.kaybolan){ const e=document.querySelector(`#akis .msg[data-id="${o.id}"]`); if (e) e.remove(); delete KAYBOLAN_ZAMAN[o.id]; }  // G6: iz bırakmadan
      else baloncukSilindiYap(o.id);
    }
    else if (o.tip==='duzenlendi'){ baloncukDuzenle(o.id, o.govde); }   // G9: mesaj düzenlendi → canlı güncelle
    else if (o.tip==='sabit'){ if (o.id) SABIT[o.oda]=o.id; else delete SABIT[o.oda]; if (o.oda===ODA) sabitGuncelle(); }   // G12: sabit değişti
    else if (o.tip==='yaziyor' && o.oda===ODA && o.kim!==BEN.kullanici){ yaziyorGoster(o.kim); }
    else if (o.tip==='tepki' && o.oda===ODA){ tepkiOlayUygula(o); }
    // NOT: arama 'sinyal' artık kişisel kanaldan gelir (kisiselAkisBagla) — açık oda gerekmez.
  };
}

// Kişisel çağrı kanalı: oturum boyu açık tek SSE. Gelen arama sinyali (offer/answer/ICE/bitir)
// hangi ekranda olursan ol buraya düşer → #gelenArama overlay'i her görünümün üstünde zil çalar.
// Tarayıcı EventSource kopunca otomatik yeniden bağlanır (sunucu restart'ı da kendiliğinden toparlar).
function kisiselAkisBagla(){
  if (ES_KISI){ try{ ES_KISI.close(); }catch{} ES_KISI = null; }
  baglantiDurum('baglaniyor');
  ES_KISI = new EventSource(API_KOK+'/api/akis', {withCredentials: !!API_KOK});   // oda YOK = kişisel kanal
  ES_KISI.onopen  = ()=> baglantiDurum('bagli');
  ES_KISI.onerror = ()=> baglantiDurum(navigator.onLine===false ? 'cevrimdisi' : 'baglaniyor');
  ES_KISI.onmessage = (e)=>{
    let o; try{ o=JSON.parse(e.data); }catch{ return; }
    if (o.tip==='sinyal'){
      const s = o.sinyal;
      if (s && s.g) grupSinyalGeldi(o.oda, o.gonderen, s);   // H2: grup mesh sinyali (g:1)
      else sinyalGeldi(o.oda, o.gonderen, s);                // 1:1 sinyali (arama.js)
    }
    else if (o.tip==='oda-uye' || o.tip==='oda-foto'){ odaDegistiOlayi(o); }   // H3: grup üye/foto değişti
  };
}
// H3: grup üyelik/foto değişti → listeyi tazele; açık oda etkilendiyse başlık/avatarı güncelle ya da (çıkarıldıysam) kapat
async function odaDegistiOlayi(o){
  await yenile();
  if (ODA !== o.oda) return;
  if (!ODA_BILGI[ODA]){            // bu gruptan çıkarıldım/ayrıldım → sohbeti kapat
    if (grupDurumu()!=='bos' && grupOdasi()===o.oda) grupKapat();
    toast(o.tip==='oda-uye' && o.eylem==='cikar' ? 'Gruptan çıkarıldınız' : 'Gruptan ayrıldınız');
    ODA = null; odaGorunumKapat(); gorunumGec('sohbetler'); return;
  }
  const od = ODA_BILGI[ODA];       // başlık + avatar tazele
  $('odaBaslik').textContent = odaAdGoster(od);
  avatarKur($('odaAvatar'), od.tip==='grup'?od.ad:'', od.tip==='grup', null, od.avatar);
  odaAltGuncelle();
  if (document.getElementById('mesajMenu')) { mesajMenuKapat(); grupBilgiAc(ODA); }   // açık grup sheet'i tazele
}

// ════════ bağlantı durumu göstergesi + yeniden bağlanma (sağlamlık) ════════
let SSE_DURUM = 'baglaniyor', baglantiZ = null;
function baglantiBannerCiz(){
  const el = $('baglantiBanner'); if (!el) return;
  el.classList.remove('baglaniyor','cevrimdisi');
  if (SSE_DURUM==='bagli'){ el.classList.add('gizli'); el.textContent=''; return; }
  el.classList.remove('gizli'); el.classList.add(SSE_DURUM);
  el.textContent = SSE_DURUM==='cevrimdisi' ? '⚠ Çevrimdışı — bağlantı bekleniyor' : '↻ Yeniden bağlanılıyor…';
}
function baglantiDurum(d){
  SSE_DURUM = d;
  if (d==='bagli' || d==='cevrimdisi'){ if (baglantiZ){ clearTimeout(baglantiZ); baglantiZ=null; } baglantiBannerCiz(); return; }
  if (baglantiZ) return;                       // 'baglaniyor': anlık blip'te yanıp sönmesin diye 1.5s gecikmeyle göster
  baglantiZ = setTimeout(()=>{ baglantiZ=null; if (SSE_DURUM!=='bagli') baglantiBannerCiz(); }, 1500);
}
// online / sekme-görünür olunca: SSE'leri yeniden kur + kaçan mesaj/durumu tazele (ekle çift-çizmeyi engeller)
function baglantiTazele(){
  if (!BEN) return;
  if (navigator.onLine===false){ baglantiDurum('cevrimdisi'); return; }
  baglantiDurum('baglaniyor');
  kisiselAkisBagla();
  if (ODA){ sseBagla(); mesajlariYukle(); }
  try { yenile(); } catch {}
  kuyrukDene();                          // FAZ G1: bağlanınca bekleyen mesajları gönder
}
window.addEventListener('online',  baglantiTazele);
window.addEventListener('offline', ()=> baglantiDurum('cevrimdisi'));
document.addEventListener('visibilitychange', ()=>{ if (!document.hidden && BEN) baglantiTazele(); });

async function gonder(){
  const metin=$('mesajIn').value.trim(); if(!metin||!ODA) return;
  const od=ODA_BILGI[ODA]; if(!od) return;
  if (DUZENLE){ return duzenleGonder(metin, od); }                 // G9: düzenleme modu → gönder yerine düzenle
  const cid = yeniCid();
  const blob=sifrele(metin, od.uyeler, YANIT); blob.cid = cid;
  const oda = ODA;
  $('mesajIn').value=''; otoYukseklik(); yanitIptal(); taslakSil(ODA);       // optimistik UX: girişi hemen temizle + N7 taslağı sil
  ekle({ gonderen:BEN.kullanici, ts:Date.now(), govde:blob }, {optimistik:true});   // baloncuk anında görünür (🕓)
  const kaybol = kaybolSn(oda);                                             // G6: kaybolan TTL (açıksa)
  try {
    const {ok} = await api('/api/mesaj', {method:'POST', body:JSON.stringify({oda, govde:blob, ...(kaybol?{kaybol}:{})})});
    if (!ok) throw 0;                                                        // sunucu hatası → kuyruğa
    // başarı: SSE 'yeni-mesaj' eko'su optimistik baloncuğu gerçeğiyle (✓) değiştirir (cid eşleşmesi)
  } catch {
    KUYRUK.push({oda, blob, cid, ts:Date.now(), kaybol}); kuyrukYaz(); kuyrukZamanla();
    const el = $('akis') && $('akis').querySelector(`.msg[data-cid="${cid}"]:not([data-id])`);
    if (el && oda===ODA) el.classList.add('bekleyen');                       // "bekliyor" işareti (offline)
  }
}

// ════════ FAZ G1: çevrimdışı gönderim kuyruğu ════════
// Gönderim başarısızsa (offline/sunucu) mesaj yerel kuyruğa (localStorage, kalıcı) + optimistik baloncuk kalır;
// online/SSE-reconnect/aralıkta tekrar dener. Başarıda SSE eko'su cid ile baloncuğu gerçeğiyle değiştirir.
let KUYRUK = [];
try { KUYRUK = JSON.parse(localStorage.getItem('narchat_kuyruk')||'[]'); } catch {}
function kuyrukYaz(){ try { localStorage.setItem('narchat_kuyruk', JSON.stringify(KUYRUK)); } catch {} }
function yeniCid(){ return 'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
let kuyrukZ = null;
function kuyrukZamanla(){ if (kuyrukZ || !KUYRUK.length) return; kuyrukZ = setInterval(()=>{
  if (!KUYRUK.length){ clearInterval(kuyrukZ); kuyrukZ=null; return; } kuyrukDene(); }, 12000); }
let kuyrukCalisiyor = false;
async function kuyrukDene(){
  if (kuyrukCalisiyor || !KUYRUK.length || navigator.onLine===false) return;
  kuyrukCalisiyor = true;
  let acikOdayaGonderildi = false;
  try {
    for (const item of [...KUYRUK]){
      try {
        const {ok} = await api('/api/mesaj', {method:'POST', body:JSON.stringify({oda:item.oda, govde:item.blob, ...(item.kaybol?{kaybol:item.kaybol}:{})})});
        if (ok){ KUYRUK = KUYRUK.filter(x=>x.cid!==item.cid); kuyrukYaz(); if (item.oda===ODA) acikOdayaGonderildi=true; }
        else break;                                                          // sunucu hatası → sonra
      } catch { break; }                                                     // hâlâ offline → dur
    }
  } finally { kuyrukCalisiyor = false; }
  // SSE eko'su yarışı kaybedebilir → açık odadaki optimistik baloncukları mesajlariYukle ile gerçeğe çevir
  if (acikOdayaGonderildi && ODA){ try { await mesajlariYukle(); } catch {} }
  if (KUYRUK.length) kuyrukZamanla(); else if (kuyrukZ){ clearInterval(kuyrukZ); kuyrukZ=null; }
}

// oda adı düzenle (yalnız grup)
async function odaAdDuzenle(){
  const od = ODA_BILGI[ODA]; if (!od || od.tip!=='grup') return;
  const yeni = prompt('Grup adı:', od.ad);
  if (yeni==null) return;
  const ad = yeni.trim(); if (!ad) return;
  const {ok,d} = await api('/api/oda-ad', {method:'POST', body:JSON.stringify({oda:ODA, ad})});
  if (ok){ od.ad=ad; $('odaBaslik').textContent=ad; odaListesiCiz($('aramaIn').value); toast('Oda adı güncellendi'); }
  else toast((d&&d.hata)||'güncellenemedi');
}

// textarea oto-yükseklik
function otoYukseklik(){ const t=$('mesajIn'); t.style.height='auto'; t.style.height=Math.min(t.scrollHeight,120)+'px'; }

// basit emoji seçici
const EMOJILER = ['😀','😂','😊','😍','😉','😎','🤔','🙏','👍','👌','🔥','❤️','🎉','😢','😮','🙌','💪','✅','📌','🍀','☕️','🌙'];
function emojiAcKapat(){
  let pop = document.querySelector('.emoji-pop');
  if (pop){ pop.remove(); return; }
  pop = document.createElement('div'); pop.className='emoji-pop';
  EMOJILER.forEach(e=>{ const b=document.createElement('button'); b.textContent=e; b.onclick=()=>{
    const t=$('mesajIn'); t.value+=e; t.focus(); otoYukseklik(); taslakKaydet(); pop.remove(); }; pop.appendChild(b); });
  $('gorunum-oda').appendChild(pop);
}

// ════════ olaylar ════════
$('girisBtn').onclick=()=>girisYap(false);
// Kayıt onayı: sıfır-bilgi sistemin geri-dönüşsüz kuralları (parola kurtarılamaz, anahtar yalnız
// cihazda) hesap AÇILMADAN kabul ettirilir — yanlış cihazda / yanlış beklentiyle kayıt kazalarını önler.
function kayitOnayIste(){
  const k = $('gKullanici').value.trim(), p = $('gParola').value;
  if (!k || p.length < 4) return girisYap(true);   // eksik alan → girisYap kendi hata mesajını göstersin
  $('kayitOnay').classList.remove('gizli');
}
$('kayitBtn').onclick=kayitOnayIste;
$('kayitOnayTamam').onclick=()=>{ $('kayitOnay').classList.add('gizli'); girisYap(true); };
$('kayitOnayVazgec').onclick=()=>$('kayitOnay').classList.add('gizli');
$('cikisBtn').onclick=async()=>{ await api('/api/cikis',{method:'POST'}); location.reload(); };
$('grupBtn').onclick=grupKur;
$('grupIptal').onclick=()=>$('grupPanel').classList.add('gizli');
// "+" → menü: Kişi Ekle / Grup Oluştur
$('ekleBtn').onclick=()=>$('ekleMenu').classList.toggle('gizli');
$('kisiEkleAc').onclick=()=>{ $('ekleMenu').classList.add('gizli'); $('grupPanel').classList.add('gizli'); $('kisiEklePanel').classList.remove('gizli'); $('kisiEkleIn').focus(); };
$('grupOlusturAc').onclick=()=>{ $('ekleMenu').classList.add('gizli'); $('kisiEklePanel').classList.add('gizli'); $('grupPanel').classList.remove('gizli'); };
$('kisiEkleBtn').onclick=kisiEkle;
$('kisiEkleIptal').onclick=()=>$('kisiEklePanel').classList.add('gizli');
$('kisiEkleIn').addEventListener('keydown',e=>{ if(e.key==='Enter') kisiEkle(); });
$('gonderBtn').onclick=gonder;
$('yanitIptalBtn').onclick=yanitIptal;
$('duzenleIptalBtn').onclick=duzenleIptal;
$('sohbetAraBtn').onclick=()=>{ $('sohbetAraBar').classList.contains('gizli') ? sohbetAraAc() : sohbetAraKapat(); };
$('sohbetAraKapat').onclick=sohbetAraKapat;
$('secimKapat').onclick=secimBitir;                 // G11
$('secimIletBtn').onclick=secimIletBaslat;
$('secimSilBtn').onclick=secimSil;
$('sabitKaldirBtn').onclick=sabitKaldirTik;         // G12
$('yildizliMsgBtn').onclick=yildizliListeAc;
$('sohbetAraOnce').onclick=()=>araGit(-1);
$('sohbetAraSonra').onclick=()=>araGit(1);
$('sohbetAraIn').addEventListener('input', ()=>{ if (araZ) clearTimeout(araZ); araZ=setTimeout(sohbetAraCalistir, 180); });
$('sohbetAraIn').addEventListener('keydown', e=>{ if (e.key==='Enter'){ e.preventDefault(); araGit(e.shiftKey?-1:1); } else if (e.key==='Escape'){ sohbetAraKapat(); } });
// FAZ E geri-bug fix: geri ARAMAYI KAPATMAZ — yalnız odadan çıkar; aktif arama mini şeritte sürer.
$('geriBtn').onclick=()=>{ odaGorunumKapat(); yenile(); if (grupDurumu()!=='bos') grupKucult(); else if (aramaDurumu()!=='bos') aramaKucult(); };
$('odaAdBtn').onclick=odaAdDuzenle;
$('aramaBtn').onclick=()=>aramaButonTikla(false);        // H2: 1:1→arama.js · grup→grup-arama.js (mesh)
$('aramaVideoBtn').onclick=()=>aramaButonTikla(true);
$('aramaKapatBtn').onclick=()=>aramaKapat();
$('videoKapatBtn').onclick=()=>aramaKapat();
$('aramaCevaplaBtn').onclick=()=>{ if (grupDurumu()==='geliyor') grupKatil(); else aramaCevapla(); };   // gelen: grup mu 1:1 mi
$('aramaReddetBtn').onclick=()=>{ if (grupDurumu()==='geliyor') grupReddet(); else aramaReddet(); };
// FAZ E: küçült / mini-şeritten geri dön / mini-şeritten kapat + kontroller (mute · hoparlör) — grup-farkında
$('aramaKucultBtn') && ($('aramaKucultBtn').onclick = aramaKucult);
$('videoKucultBtn') && ($('videoKucultBtn').onclick = aramaKucult);
$('grupKucultBtn') && ($('grupKucultBtn').onclick = grupKucult);
$('aramaMini') && ($('aramaMini').onclick = ()=>{ if (grupDurumu()!=='bos') grupBuyut(); else aramaBuyut(); });
$('aramaMini') && $('aramaMini').addEventListener('keydown', e=>{ if (e.key==='Enter'||e.key===' '){ e.preventDefault(); (grupDurumu()!=='bos'?grupBuyut:aramaBuyut)(); } });
$('aramaMiniKapatBtn') && ($('aramaMiniKapatBtn').onclick = (e)=>{ e.stopPropagation(); if (grupDurumu()!=='bos') grupKapat(); else aramaKapat(); });
$('muteBtn') && ($('muteBtn').onclick = muteToggleUI);
$('hoparlorBtn') && ($('hoparlorBtn').onclick = hoparlorToggleUI);
$('videoMuteBtn') && ($('videoMuteBtn').onclick = muteToggleUI);
$('videoHoparlorBtn') && ($('videoHoparlorBtn').onclick = hoparlorToggleUI);
$('videoKameraBtn') && ($('videoKameraBtn').onclick = kameraToggleUI);   // H1: kamera aç/kapa
$('videoCevirBtn') && ($('videoCevirBtn').onclick = kameraCevirUI);      // H1: ön/arka kamera çevir
// H2: grup arama kontrolleri
$('grupMuteBtn') && ($('grupMuteBtn').onclick = ()=>{ try{grupMikToggle();}catch{} grupButonDurum(); });
$('grupKameraBtn') && ($('grupKameraBtn').onclick = ()=>{ let k=false; try{k=grupKameraToggle();}catch{} grupButonDurum(); if(k) toast('Kamera kapalı'); });
$('grupCevirBtn') && ($('grupCevirBtn').onclick = async ()=>{ try{await grupKameraCevir();}catch{} grupButonDurum(); });
$('grupKapatBtn') && ($('grupKapatBtn').onclick = ()=> grupKapat());
$('emojiBtn').onclick=emojiAcKapat;
$('ekBtn').onclick=()=>$('medyaIn').click();
$('kameraBtn') && ($('kameraBtn').onclick=()=>$('kameraIn').click());   // FAZ G2: kamerayla çek (capture → native kamera)
$('kameraIn') && $('kameraIn').addEventListener('change', async e=>{ const f=e.target.files&&e.target.files[0]; e.target.value=''; if (f) await medyaGonder(f); });
$('sesBtn') && ($('sesBtn').onclick=()=>{ if (ODA) sesKayitBaslat(); });
$('sesKayitGonder') && ($('sesKayitGonder').onclick=()=>sesKayitBitir(true));
$('sesKayitIptal') && ($('sesKayitIptal').onclick=()=>sesKayitBitir(false));
$('medyaIn').addEventListener('change', async e=>{
  const f = e.target.files && e.target.files[0];
  e.target.value = '';            // aynı dosya tekrar seçilebilsin
  if (f) await medyaGonder(f);
});
// ════════ N7: sürükle-bırak + yapıştır ile medya gönder (mevcut medyaGonder pipeline'ı; E2E/mimari değişmez) ════════
const SURUKLE_MAX = 10;                                  // tek seferde en çok N dosya (flood koruması)
function _overlayAcik(){                                 // üst-katman overlay açık mı → drop/paste yanlışlıkla sohbete gitmesin
  if ($('lightbox') || $('galeri') || $('mesajMenuOrt')) return true;
  for (const id of ['gelenArama','aramaSahne','videoSahne','grupSahne'])   // tam-ekran arama sahneleri
    if ($(id) && !$(id).classList.contains('gizli')) return true;
  return false;
}
const _medyaBirakUygun = ()=> !!ODA && !$('gorunum-oda').classList.contains('gizli') && !_overlayAcik();
async function dosyalariGonder(files){
  const list = [...files].filter(Boolean);
  if (!list.length || !ODA) return;
  const atlanan = list.length > SURUKLE_MAX ? list.length - SURUKLE_MAX : 0;
  const secilen = list.slice(0, SURUKLE_MAX);
  const buyuk = secilen.filter(f=>f.size > MEDYA_MAX);        // boyut aşımı önden ayrılır (medyaGonder toast'ı ezilmesin)
  const gonderilecek = secilen.filter(f=>f.size <= MEDYA_MAX);
  for (const f of gonderilecek) await medyaGonder(f);         // medyaGonder oda/E2E'yi kendi kurar
  const notlar = [];                                          // batch özeti tek toast (ara "Gönderiliyor…" toast'ları birbirini ezmesin)
  if (gonderilecek.length > 1) notlar.push(gonderilecek.length+' dosya gönderildi');
  if (buyuk.length) notlar.push(buyuk.length+' dosya çok büyük (>15MB), atlandı');
  if (atlanan) notlar.push(atlanan+' dosya sığmadı (en çok '+SURUKLE_MAX+')');
  if (notlar.length) toast(notlar.join(' · '));
}
function birakHintGoster(){
  let h = $('birakHint');
  if (!h){ h = document.createElement('div'); h.id='birakHint'; h.className='birak-hint';
    const ic = document.createElement('div'); ic.className='birak-hint-ic'; ic.textContent='📎 Göndermek için bırak';
    h.appendChild(ic); ($('gorunum-oda')||document.body).appendChild(h); }
  h.classList.add('gorunur');
}
function birakHintGizle(){ const h=$('birakHint'); if (h) h.classList.remove('gorunur'); }
const _dosyaSurukleniyor = (e)=> !!(e.dataTransfer && [...(e.dataTransfer.types||[])].includes('Files'));
let _birakZ;
document.addEventListener('dragover', e=>{
  if (!_dosyaSurukleniyor(e)) return;                   // yalnız dosya sürüklemesi (metin-seçim sürüklemesine dokunma)
  e.preventDefault();                                   // drop'a izin ver + tarayıcı navigasyonunu engelle
  if (_medyaBirakUygun()) birakHintGoster();            // yalnız açık sohbette + overlay yokken ipucu göster
  clearTimeout(_birakZ); _birakZ = setTimeout(birakHintGizle, 140);   // dragleave titremesi yerine son-dragover'dan sonra gizle
});
document.addEventListener('drop', e=>{
  if (!_dosyaSurukleniyor(e)) return;
  e.preventDefault(); clearTimeout(_birakZ); birakHintGizle();          // her durumda navigasyonu engelle
  if (!_medyaBirakUygun()){ if (!ODA) toast('Göndermek için önce bir sohbet açın'); return; }   // overlay/kapalı-sohbet → sessizce yut
  dosyalariGonder(e.dataTransfer.files);
});
$('mesajIn').addEventListener('paste', e=>{
  if (!_medyaBirakUygun()) return;
  const imgs = [...(e.clipboardData?.items||[])].filter(it=>it.kind==='file' && (it.type||'').startsWith('image/'));
  if (!imgs.length) return;                             // düz metin yapıştırma → varsayılan davranış (dokunma)
  e.preventDefault();
  let gonderildi = 0;
  imgs.forEach(it=>{ const f=it.getAsFile(); if (!f) return;
    const dosya = f.name ? f : new File([f], 'yapistirilan.png', {type:f.type||'image/png'});
    medyaGonder(dosya); gonderildi++; });
  if (!gonderildi) toast('Yapıştırma başarısız');       // görsel item vardı ama dosya alınamadı → sessiz yutma yerine bildir
});
$('bildirimBtn').onclick=()=>{ gorunumGec('ayarlar'); };
$('narcosystemBtn').onclick=narcosystemAc;
$('narcosystemAyarBtn').onclick=narcosystemAc;
$('narcosystemGeriBtn').onclick=narcosystemKapat;
$('bildirimAyarBtn').onclick=bildirimIste;
$('sesUyariBtn') && ($('sesUyariBtn').onclick=sesUyariToggle);   // FAZ G4: sesli uyarı aç/kapat
$('gizliSonBtn') && ($('gizliSonBtn').onclick=()=>gizlilikDegistir('son'));        // G8: son görülme aç/kapat
$('gizliOkunduBtn') && ($('gizliOkunduBtn').onclick=()=>gizlilikDegistir('okundu')); // G8: okundu bilgisi aç/kapat
$('benAvatar').onclick=()=>$('avatarIn').click();
$('avatarIn').addEventListener('change', avatarSecildi);
$('profilKaydetBtn').onclick=profilKaydet;
$('mesajIn').addEventListener('input', otoYukseklik);
$('mesajIn').addEventListener('input', taslakKaydet);   // N7: yarım kalan yazıyı oda-başına sakla
$('mesajIn').addEventListener('input', yaziyorBildir);
$('mesajIn').addEventListener('keydown',e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); gonder(); } });
$('gParola').addEventListener('keydown',e=>{ if(e.key==='Enter') girisYap(false); });
$('gDavet').addEventListener('keydown',e=>{ if(e.key==='Enter') kayitOnayIste(); });
$('aramaIn').addEventListener('input', e=>{ odaListesiCiz(e.target.value); globalAraTetikle(e.target.value); });
// alt-nav
document.querySelectorAll('#altNav button').forEach(b=> b.onclick=()=>gorunumGec(b.dataset.gor));
// tema segment
document.querySelectorAll('#temaSegment button').forEach(b=> b.onclick=()=>temaUygula(b.dataset.tema));
// erişilebilirlik: yazı boyu segment + yüksek kontrast toggle
document.querySelectorAll('#yaziSegment button').forEach(b=> b.onclick=()=>yaziUygula(b.dataset.yazi));
document.querySelectorAll('#paletSegment button').forEach(b=> b.onclick=()=>paletUygula(b.dataset.palet));   // N7: renk teması
$('kontrastBtn') && ($('kontrastBtn').onclick=()=>kontrastUygula(!document.documentElement.hasAttribute('data-kontrast')));
// kilit
$('kAc').onclick=kilitAc;
$('kParola').addEventListener('keydown',e=>{ if(e.key==='Enter') kilitAc(); });
$('kCikis').onclick=async()=>{ await api('/api/cikis',{method:'POST'}); location.reload(); };
// çok-cihaz: cihaz bağlama
$('cihazBaglaBtn').onclick=cihazBaglaUret;
$('baglaKapat').onclick=()=>$('baglaKodPop').classList.add('gizli');
$('baglaKopyala').onclick=async()=>{ try{ await navigator.clipboard.writeText(_SON_BAGLA_KOD); toast('Kod kopyalandı'); }catch{ toast('Kopyalanamadı — elle seç'); } };
$('bBagla').onclick=baglaGonder;
$('bYeni').onclick=baglaYeniAnahtar;
$('bKod').addEventListener('keydown',e=>{ if(e.key==='Enter') baglaGonder(); });
$('bCikis').onclick=async()=>{ await api('/api/cikis',{method:'POST'}); location.reload(); };
// Ayarlar: uygulama kilidi (opsiyonel)
$('kilitToggleBtn').onclick=kilitToggle;
$('kilitKaydetBtn').onclick=kilitKaydet;
$('kilitParolaIn').addEventListener('keydown',e=>{ if(e.key==='Enter') kilitKaydet(); });

$('aramaGecmisiTemizleBtn') && ($('aramaGecmisiTemizleBtn').onclick = () => {
  if (confirm('Arama geçmişini temizlemek istiyor musunuz?')) {
    ARAMA_GECMISI = [];
    aramaGecmisiYaz();
  }
});

// bağlantı (#k=kanal.cümle) ile gelindiyse kodu hazırla (parola yine istenir)
(function(){
  const m = (location.hash||'').match(/[#&]k=([^&]+)/);
  if (m){ try{ window.__BEKLEYEN_KOD = decodeURIComponent(m[1]).replace('.', '-'); }catch{}
    history.replaceState(null, '', location.pathname + location.search); }
})();

temaYukle();
yaziYukle();       // erişilebilirlik: kayıtlı yazı boyu
kontrastYukle();   // erişilebilirlik: kayıtlı yüksek-kontrast tercihi
paletYukle();      // N7: kayıtlı renk teması varyantı (nar/okyanus/orman)
sessizIdbSenkron();   // N7: sessiz kümesini SW'nin okuyabileceği IndexedDB'ye aynala (Web Push mute)
sesUyariGuncelle();   // FAZ G4: ses ayar butonu durumu
aramaRozetiGuncelle(); // arama rozetini yükle
// FAZ N3: native'de (bundled) SW kaydı ATLA — app zaten yerel dosyalardan açılıyor, offline-kabuk gereksiz.
if (!API_KOK && 'serviceWorker' in navigator){ navigator.serviceWorker.register('/sw.js').catch(()=>{}); }
oturumKontrol();
