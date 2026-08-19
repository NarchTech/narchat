// NarChat — grup-arama.js · FAZ H2: GRUP arama (mesh, 3-4 kişi, sesli + görüntülü).
// 1:1 (arama.js) BOZULMADAN ayrı modül: grup odasında her katılımcı için AYRI RTCPeerConnection (full-mesh).
// Sinyal: mevcut OPAK /api/sinyal relay'i (oda SSE/kişisel kanal) `hedef` alanıyla per-eş hedeflenir;
//   sunucu DEĞİŞMEZ (sinyal sözlüğü olduğu gibi taşınır). Tüm grup sinyalleri `g:1` ile etiketli →
//   app.js bunları buraya yönlendirir, 1:1 sinyallerini arama.js'e (ayrım net, çakışma yok).
// Medya uçtan-uca DTLS-SRTP (sunucu içeriği görmez). Mesh ≤4 (sunucu oda üyeliğini 4 ile sınırlar; üstü = SFU, yatırım sonrası).
//
// PROTOKOL (glare-free): katıl→duyur, var-olan üyeler "burada" ile cevaplar, KÜÇÜK isim teklif eder.
//   • katil  {video}            (yayın)        : "aramaya katıldım"
//   • burada {video} hedef:J    (J'ye)         : "ben aramadayım" (var-olan üye → yeni katılana)
//   • offer  {sdp,video} hedef:P : küçük-isimli eş → büyük-isimliye
//   • answer {sdp} hedef:P       : cevap
//   • ice    {c} hedef:P         : ICE adayı
//   • ayril                      (yayın)        : "aramadan ayrıldım" → eşler tile'ı kapatır
// Var-olmayan üye `katil` alınca → GELEN grup araması ekranı (zil). Kabul → grupKatil(): kendi katil'ini yayınlar.
import { API_KOK } from './kok.js?v=1';

let ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
async function iceHazirla() {
  try {
    const r = await fetch(API_KOK+'/api/turn', { credentials: API_KOK?'include':'same-origin' });
    if (r.ok) { const d = await r.json(); if (d && Array.isArray(d.iceServers) && d.iceServers.length) ICE = { iceServers: d.iceServers }; }
  } catch {}
}

let benK = null, sinyalGonder = null, uiCb = null;
let oda = null, durum = 'bos';              // bos | ariyor | baglaniyor | konusuyor | geliyor
let video = false, yerelMedya = null, arayanKisi = null;
let esler = new Map();                      // peer(kullanıcı) -> { pc, dc, akis, bekleyenIce:[] }
let mikKapali = false, kameraKapali = false, yuzKamera = 'user';
let zilCtx = null, zilTimer = null, zilVibTimer = null;

export function grupInit({ sinyalGonderFn, benKullanici, uiGuncelle }) {
  sinyalGonder = sinyalGonderFn; benK = benKullanici; uiCb = uiGuncelle || (() => {});
  iceHazirla();
}
export function grupDurumu() { return durum; }
export function grupVideoMu() { return video; }
export function grupOdasi() { return oda; }
export function grupArayan() { return arayanKisi; }
export function grupYerel() { return yerelMedya; }
// UI: tüm katılımcı tile'ları (akis null ise henüz bağlanıyor → avatar göster)
export function grupKatilimcilar() {
  return [...esler.entries()].map(([peer, es]) => ({ peer, akis: es.akis || null }));
}
function durumSet(d) { durum = d; _kanca(); try { uiCb(); } catch {} }
function _kanca() {
  try {
    window.__GRUP_DURUM = durum;
    window.__GRUP_ES_SAYI = esler.size;
    window.__GRUP_UZAK_VIDEO_SAYI = [...esler.values()].filter(e => e.akis && e.akis.getVideoTracks && e.akis.getVideoTracks().length > 0).length;
    window.__GRUP_UZAK_TRACK_SAYI = [...esler.values()].filter(e => e.akis).length;
  } catch {}
}

async function medyaAl(vid) {
  if (vid) {
    try {
      yerelMedya = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      if (!yerelMedya.getVideoTracks().length) video = false;
      return yerelMedya;
    } catch { video = false; }   // kamera yok → sese düş
  }
  try { yerelMedya = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { yerelMedya = null; }    // mic de yoksa: yine de tile'lar kurulur (yalnız alıcı)
  return yerelMedya;
}

function esKur(peer) {
  let es = esler.get(peer);
  if (es) return es;
  const pc = new RTCPeerConnection(ICE);
  es = { pc, dc: null, akis: null, bekleyenIce: [] };
  esler.set(peer, es);
  pc.onicecandidate = (e) => { if (e.candidate) sinyalGonder(oda, { g: 1, t: 'ice', hedef: peer, c: e.candidate }); };
  pc.ontrack = (e) => {
    es.akis = e.streams[0] || new MediaStream([e.track]);
    _kanca(); try { uiCb(); } catch {}
  };
  pc.onconnectionstatechange = () => {
    if (!es.pc) return;
    if (es.pc.connectionState === 'connected' && durum !== 'konusuyor') durumSet('konusuyor');
    if (['failed', 'closed'].includes(es.pc.connectionState)) esCikar(peer);
  };
  pc.ondatachannel = (e) => { es.dc = e.channel; };
  try { yerelMedya && yerelMedya.getTracks().forEach(t => pc.addTrack(t, yerelMedya)); } catch {}
  _kanca();
  return es;
}
function esCikar(peer) {
  const es = esler.get(peer);
  if (!es) return;
  try { es.pc && (es.pc.onconnectionstatechange = null, es.pc.close()); } catch {}
  esler.delete(peer);
  _kanca(); try { uiCb(); } catch {}
}
async function esOfferla(peer) {
  if (esler.has(peer)) return;                 // zaten kuruluyor/kurulu → çift teklif yok
  const es = esKur(peer);
  try {
    es.dc = es.pc.createDataChannel('nar');
    const offer = await es.pc.createOffer();
    await es.pc.setLocalDescription(offer);
    sinyalGonder(oda, { g: 1, t: 'offer', hedef: peer, sdp: es.pc.localDescription, video });
  } catch { esCikar(peer); }
}
async function iceFlush(es) {
  const q = es.bekleyenIce; es.bekleyenIce = [];
  for (const c of q) { try { await es.pc.addIceCandidate(c); } catch {} }
}

// ── arama başlat (ben başlatan) ──
export async function grupBaslat(odaId, opt = {}) {
  if (durum !== 'bos') return;
  oda = odaId; video = !!opt.video; arayanKisi = benK;
  await iceHazirla();
  await medyaAl(video);
  durumSet('ariyor');
  sinyalGonder(oda, { g: 1, t: 'katil', video });   // odadaki herkese duyur (var-olan yok → herkese zil)
}

// ── gelen grup aramasını KABUL et (zil ekranında "Cevapla") ──
export async function grupKatil() {
  if (durum !== 'geliyor') return;
  zilDurdur();
  durumSet('baglaniyor');
  await iceHazirla();
  await medyaAl(video);
  sinyalGonder(oda, { g: 1, t: 'katil', video });   // var-olan üyeler bunu duyar → bana burada+offer
}

// ── gelen grup aramasını REDDET ──
export function grupReddet() {
  if (durum !== 'geliyor') return;
  kapatTemiz();
}

// ── aramadan ayrıl / bitir ──
export function grupKapat() {
  try { if (oda && ['ariyor', 'baglaniyor', 'konusuyor'].includes(durum)) sinyalGonder(oda, { g: 1, t: 'ayril' }); } catch {}
  kapatTemiz();
}
function kapatTemiz() {
  zilDurdur();
  for (const peer of [...esler.keys()]) esCikar(peer);
  try { yerelMedya && yerelMedya.getTracks().forEach(t => t.stop()); } catch {}
  yerelMedya = null; oda = null; video = false; arayanKisi = null;
  mikKapali = false; kameraKapali = false; yuzKamera = 'user';
  if (durum !== 'bos') durumSet('bos');
}

// ── gelen grup sinyali (app.js → g:1 olanları buraya yollar) ──
export async function grupSinyalGeldi(odaId, gonderen, s) {
  if (!s || gonderen === benK) return;
  const aktif = durum === 'ariyor' || durum === 'baglaniyor' || durum === 'konusuyor';

  if (s.t === 'katil') {
    if (durum === 'bos') {                         // bu bir GELEN grup araması → zil
      oda = odaId; video = !!s.video; arayanKisi = gonderen;
      durumSet('geliyor');
      zilBaslat();
      return;
    }
    if (aktif && odaId === oda) {                  // aramadayım → yeni katılana "burada" + (küçük isim) teklif
      sinyalGonder(oda, { g: 1, t: 'burada', hedef: gonderen, video });
      if (benK < gonderen) esOfferla(gonderen);
    }
    return;
  }
  if (s.t === 'burada') {
    if (s.hedef && s.hedef !== benK) return;
    if (aktif && odaId === oda && benK < gonderen) esOfferla(gonderen);
    return;
  }
  if (s.hedef && s.hedef !== benK) return;          // hedefli sinyal başkasına → yok say

  if (s.t === 'offer') {
    if (!aktif || odaId !== oda) return;
    const es = esKur(gonderen);
    // glare: ben de bu eşe teklif ettiysem (have-local-offer) ve küçük isim BENSEM → kendi teklifim kalsın
    if (es.pc.signalingState === 'have-local-offer' && benK < gonderen) return;
    try {
      await es.pc.setRemoteDescription(s.sdp);
      await iceFlush(es);
      const ans = await es.pc.createAnswer();
      await es.pc.setLocalDescription(ans);
      sinyalGonder(oda, { g: 1, t: 'answer', hedef: gonderen, sdp: es.pc.localDescription });
    } catch {}
  } else if (s.t === 'answer') {
    const es = esler.get(gonderen);
    if (es && es.pc && !es.pc.currentRemoteDescription) {
      try { await es.pc.setRemoteDescription(s.sdp); await iceFlush(es); } catch {}
    }
  } else if (s.t === 'ice') {
    const es = esler.get(gonderen);
    if (es && s.c) {
      if (es.pc.remoteDescription && es.pc.remoteDescription.type) { try { await es.pc.addIceCandidate(s.c); } catch {} }
      else es.bekleyenIce.push(s.c);
    }
  } else if (s.t === 'ayril') {
    esCikar(gonderen);
  }
}

// ── kontroller (tek yerel akış → tüm eşlere yansır) ──
export function grupMikToggle() {
  mikKapali = !mikKapali;
  try { yerelMedya && yerelMedya.getAudioTracks().forEach(t => t.enabled = !mikKapali); } catch {}
  try { window.__GRUP_MIK_ENABLED = yerelMedya ? !!((yerelMedya.getAudioTracks()[0] || {}).enabled) : null; } catch {}
  return mikKapali;
}
export function grupMikKapali() { return mikKapali; }
export function grupKameraToggle() {
  kameraKapali = !kameraKapali;
  try { yerelMedya && yerelMedya.getVideoTracks().forEach(t => t.enabled = !kameraKapali); } catch {}
  try { window.__GRUP_KAM_ENABLED = yerelMedya ? !!((yerelMedya.getVideoTracks()[0] || {}).enabled) : null; } catch {}
  return kameraKapali;
}
export function grupKameraKapali() { return kameraKapali; }
export function grupYuz() { return yuzKamera; }
// ⚠ Android WebView facingMode tuzağı — tam açıklama arama.js/kameraTrackAl'de (24-Tem native APK bug'ı).
// { ideal } zayıf kısıt → Android sessizce ön kamerada kalır. 4-katman: exact → (kamerayı bırak+exact) → ideal → geri-yükle.
async function _grupKameraTrackAl(hedefYuz, eskiYuz, kapali, medya) {
  const dene = (yuz, kesin) => navigator.mediaDevices.getUserMedia(
    { video: { facingMode: kesin ? { exact: yuz } : { ideal: yuz } }, audio: false });
  let akis = null, sonucYuz = hedefYuz;
  try { akis = await dene(hedefYuz, true); }                                 // 1) exact, kamera açıkken (iOS: kesintisiz)
  catch {
    try { medya && medya.getVideoTracks().forEach(t => t.stop()); } catch {} // eski kamerayı bırak (Android eşzamanlı açamaz)
    try { akis = await dene(hedefYuz, true); }                               // 2) exact, kamera serbest
    catch {
      try { akis = await dene(hedefYuz, false); }                           // 3) ideal (exact desteklenmiyorsa)
      catch {
        try { akis = await dene(eskiYuz, false); sonucYuz = eskiYuz; }      // 4) geri-yükle: eski kamera, yüz değişmez
        catch { return null; }
      }
    }
  }
  const t = akis.getVideoTracks()[0];
  if (!t) { try { akis.getTracks().forEach(x => x.stop()); } catch {} return null; }
  t.enabled = !kapali;
  return { track: t, yuz: sonucYuz };
}
export async function grupKameraCevir() {
  if (!video || !yerelMedya) return yuzKamera;
  const hedefYuz = yuzKamera === 'user' ? 'environment' : 'user';
  const r = await _grupKameraTrackAl(hedefYuz, yuzKamera, kameraKapali, yerelMedya);
  if (!r) return yuzKamera;
  for (const es of esler.values()) {                 // her eşin video sender'ını değiştir (akış kesilmez)
    try { const s = es.pc.getSenders().find(x => x.track && x.track.kind === 'video'); if (s) await s.replaceTrack(r.track); } catch {}
  }
  try { yerelMedya.getVideoTracks().forEach(t => { yerelMedya.removeTrack(t); t.stop(); }); } catch {}
  try { yerelMedya.addTrack(r.track); } catch {}
  yuzKamera = r.yuz;
  try { window.__GRUP_YUZ = yuzKamera; } catch {}
  try { uiCb(); } catch {}
  return yuzKamera;
}

// ── zil (gelen grup araması) — minimal: titreşim + warble beep (arama.js'tekiyle aynı his) ──
function zilBaslat() {
  zilDurdur();
  if (navigator.vibrate) {
    const titret = () => { try { navigator.vibrate([500, 250, 500, 250, 500]); } catch {} };
    titret(); zilVibTimer = setInterval(titret, 2400);
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    zilCtx = new AC(); try { zilCtx.resume(); } catch {}
    const burst = () => {
      if (!zilCtx) return;
      try {
        const t0 = zilCtx.currentTime, sure = 1.0;
        const master = zilCtx.createGain(); master.gain.value = 0.16; master.connect(zilCtx.destination);
        const osc = zilCtx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 550;
        const lfo = zilCtx.createOscillator(); lfo.frequency.value = 11;
        const lfoG = zilCtx.createGain(); lfoG.gain.value = 70; lfo.connect(lfoG); lfoG.connect(osc.frequency);
        const env = zilCtx.createGain();
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.exponentialRampToValueAtTime(1, t0 + 0.05);
        env.gain.setValueAtTime(1, t0 + sure - 0.1);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + sure);
        osc.connect(env); env.connect(master);
        osc.start(t0); lfo.start(t0); osc.stop(t0 + sure + 0.02); lfo.stop(t0 + sure + 0.02);
      } catch {}
    };
    burst(); zilTimer = setInterval(burst, 3000);
  } catch {}
}
function zilDurdur() {
  try { if (zilTimer) clearInterval(zilTimer); } catch {} zilTimer = null;
  try { if (zilVibTimer) clearInterval(zilVibTimer); } catch {} zilVibTimer = null;
  try { if (navigator.vibrate) navigator.vibrate(0); } catch {}
  try { if (zilCtx) zilCtx.close(); } catch {} zilCtx = null;
}
