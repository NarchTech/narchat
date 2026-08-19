// NarChat — arama.js  ·  Faz 2: WebRTC 1:1 sesli + görüntülü arama (sinyalizasyon + gerçek medya UI).
// Sinyal (offer/answer/ICE/reddet/mesgul/bitir) sunucu üstünden OPAK relay (/api/sinyal → oda SSE).
// Medya uçtan-uca: DTLS-SRTP (tarayıcı) — sunucu sesi/görüntüyü/SDP'yi yorumlamaz, yalnız taşır.
// Gerçek akış: arayan offer (sesli ya da görüntülü) → karşı tarafta ZİL + Cevapla/Reddet ekranı →
//   kabul'de answer → karşı tarafın sesi <audio autoplay>'e, görüntüsü <video>'ya bağlanır.
//   Görüntülü aramada arayan offer'a `video:true` koyar → karşı taraf da kamerasını açar (simetrik).
//   Reddet/meşgul/bitir sinyalleri. TURN yok (izole/yerel host-candidate yeter; prod'da coturn).
//   Canlıda arama butonları GİZLİ (izole test açar).
import { API_KOK } from './kok.js?v=1';

let ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
// ICE/TURN sunucularını AUTH'lu /api/turn'den al. TURN cred sunucuda env'de tutulur —
// statik pakete GİRMEZ (paylaşımlı coturn cred'i herkese sızmasın). Başarısızsa STUN fallback.
async function iceHazirla() {
  try {
    const r = await fetch(API_KOK+'/api/turn', { credentials: API_KOK?'include':'same-origin' });
    if (r.ok) { const d = await r.json(); if (d && Array.isArray(d.iceServers) && d.iceServers.length) ICE = { iceServers: d.iceServers }; }
  } catch {}
}

let pc = null, dc = null, yerelMedya = null;
let durum = 'bos';            // bos | ariyor | geliyor | baglaniyor | konusuyor (geçici: reddedildi | mesgul)
let odaAktif = null, benK = null, sinyalGonder = null, uiCb = null, uzakSesEl = null;
let uzakVideoEl = null, yerelVideoEl = null;
let gelenGonderen = null;     // gelen aramada arayanın kullanıcı adı (UI'da gösterilir)
let videoIstendi = false;     // bu çağrı görüntülü mü (giden=ben başlattım, gelen=offer.video)
let bekleyenIce = [];         // remoteDescription gelene dek ICE adayları tamponu
let zilCtx = null, zilTimer = null, zilVibTimer = null;
let reOfferTimer = null, cagriTimeout = null, benimIce = [];   // çağrı uyandırma: re-offer (push sonrası bağlan) + kendi ICE adaylarımı tampla
let mikKapali = false, hoparlorAcik = true;   // FAZ E: mikrofon susturuldu mu + ses çıkışı (true=hoparlör / false=ahize)

export function aramaInit({ sinyalGonderFn, benKullanici, uiGuncelle, uzakSes, uzakVideo, yerelVideo }) {
  sinyalGonder = sinyalGonderFn; benK = benKullanici; uiCb = uiGuncelle || (() => {});
  uzakSesEl = uzakSes || null;
  uzakVideoEl = uzakVideo || null; yerelVideoEl = yerelVideo || null;
  iceHazirla();   // TURN/STUN'u baştan yükle (sonraki çağrılar hazır bulsun)
}
export function durumu() { return durum; }
export function arayan() { return gelenGonderen; }
export function videoMu() { return videoIstendi; }   // UI: bu çağrı görüntülü mü
export function aktifOda() { return odaAktif; }      // UI: çağrının odası (kiminle hesaplamak için)
function durumSet(d, ek) { durum = d; try { uiCb(d, ek); } catch {} }

// ── FAZ E: Mikrofon sustur (track.enabled) — güvenilir, her platformda çalışır ──
export function mikrofonToggle() {
  mikKapali = !mikKapali;
  try { yerelMedya && yerelMedya.getAudioTracks().forEach(t => t.enabled = !mikKapali); } catch {}
  try { window.__ARAMA_MIK_ENABLED = yerelMedya ? !!(yerelMedya.getAudioTracks()[0] || {}).enabled : null; } catch {}   // izole test kancası
  return mikKapali;
}
export function mikrofonKapali() { return mikKapali; }

// ── FAZ E: Ses çıkışı — Hoparlör ↔ Ahize ──
// DÜRÜSTLÜK: web'de mobilde ses-yönlendirme SINIRLI ve platforma bağlı. En-iyi-çaba uygularız;
// dönen {acik, destekli} ile gerçekten yönlendirebildik mi UI'a bildiririz (destekli=false → kullanıcıya not).
//  • Desktop/Android Chrome/Edge: <audio>.setSinkId(deviceId) ile çıkış cihazı (kısmî; iOS Safari YOK).
//  • iOS Safari/PWA: setSinkId yok; navigator.audioSession.type 'playback'e çekmek mikrofonu düşürür
//    (2-yönlü ses kırılır) → BİLEREK denemiyoruz; iOS'ta gerçek hoparlör/ahize = native uygulama (açık karar).
export async function hoparlorToggle() {
  hoparlorAcik = !hoparlorAcik;
  const destekli = await sesYonlendir(hoparlorAcik);
  return { acik: hoparlorAcik, destekli };
}
export function hoparlorAcikMi() { return hoparlorAcik; }

// ── H1: Kamera aç/kapa (video track.enabled) — görüntülü aramada güvenilir, her platformda ──
// Kapalıyken kendi video track'imiz durmaz, yalnız enabled=false → karşı taraf siyah/donuk görür,
// ses sürer. (Track'i durdurmak yerine enabled toggle → tekrar açmak anında, replaceTrack gerekmez.)
let kameraKapali = false, yuzKamera = 'user';   // yuzKamera: 'user'=ön (selfie) / 'environment'=arka
export function kameraToggle() {
  kameraKapali = !kameraKapali;
  try { yerelMedya && yerelMedya.getVideoTracks().forEach(t => t.enabled = !kameraKapali); } catch {}
  try { window.__ARAMA_KAM_ENABLED = yerelMedya ? !!((yerelMedya.getVideoTracks()[0] || {}).enabled) : null; } catch {}   // izole test kancası
  return kameraKapali;
}
export function kameraKapaliMi() { return kameraKapali; }
export function yuzKameraTipi() { return yuzKamera; }   // 'user' | 'environment' (UI ayna kararı)

// ── H1: Ön/arka kamera çevir (facingMode) — mobil. replaceTrack ile akış KESİLMEZ (yeni offer yok) ──
// ⚠ Android WebView tuzağı (native APK bug'ı, 24-Tem): `facingMode: { ideal }` ZAYIF kısıttır.
//   Çoğu telefon ön+arka kamerayı aynı anda açamaz; ideal kullanılınca getUserMedia HATA VERMEZ,
//   sessizce MEVCUT (ön) kamerayı döndürür → buton "çalışmaz" görünür (iOS eşzamanlıyı yönetir, orada sorun yok).
//   Çözüm 4 katman: (1) { exact } ile hedefi ZORLA, kamera açıkken (iOS burada kesintisiz geçer)
//   (2) exact eşzamanlı açılamazsa eski kamerayı bırakıp tekrar dene (Android tek-kamera donanımı)
//   (3) exact hiç desteklenmiyorsa { ideal } (4) hiçbiri olmazsa eski kamerayı geri yükle → kullanıcı kamerasız kalmaz.
// _yuz kancası: sonuç yüzü GERÇEKTEN geçilen kameradır (geri-yüklemede eski yüz döner, UI yanılmaz).
export async function kameraTrackAl(hedefYuz, eskiYuz, kapali, medya) {
  const dene = (yuz, kesin) => navigator.mediaDevices.getUserMedia(
    { video: { facingMode: kesin ? { exact: yuz } : { ideal: yuz } }, audio: false });
  let akis = null, sonucYuz = hedefYuz;
  try { akis = await dene(hedefYuz, true); }                                 // 1) exact, kamera açıkken (iOS: kesintisiz)
  catch {
    try { medya && medya.getVideoTracks().forEach(t => t.stop()); } catch {} // eski kamerayı bırak (Android eşzamanlı açamaz)
    try { akis = await dene(hedefYuz, true); }                               // 2) exact, kamera serbest
    catch {
      try { akis = await dene(hedefYuz, false); }                           // 3) ideal (exact hiç desteklenmiyorsa)
      catch {
        try { akis = await dene(eskiYuz, false); sonucYuz = eskiYuz; }      // 4) geri-yükle: eski kamera, yüz değişmez
        catch { return null; }
      }
    }
  }
  const t = akis.getVideoTracks()[0];
  if (!t) { try { akis.getTracks().forEach(x => x.stop()); } catch {} return null; }
  t.enabled = !kapali;                                // kullanıcı kamerayı kapattıysa çevirince de kapalı kalsın
  return { track: t, yuz: sonucYuz };
}
export async function kameraCevir() {
  if (!videoIstendi || !pc || !yerelMedya) return yuzKamera;
  const hedefYuz = yuzKamera === 'user' ? 'environment' : 'user';
  const r = await kameraTrackAl(hedefYuz, yuzKamera, kameraKapali, yerelMedya);
  if (!r) return yuzKamera;                           // hiçbir yolla geçilemedi → mevcutta kal
  try {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) await sender.replaceTrack(r.track);
    else pc.addTrack(r.track, yerelMedya);
  } catch { try { r.track.stop(); } catch {} return yuzKamera; }
  try { yerelMedya.getVideoTracks().forEach(t => { yerelMedya.removeTrack(t); t.stop(); }); } catch {}   // eski kamerayı bırak
  try { yerelMedya.addTrack(r.track); } catch {}
  try { if (yerelVideoEl) yerelVideoEl.srcObject = yerelMedya; } catch {}
  yuzKamera = r.yuz;
  try { window.__ARAMA_YUZ = yuzKamera; } catch {}    // izole test kancası
  return yuzKamera;
}
async function sesYonlendir(hoparlor) {
  try {
    if (!uzakSesEl || typeof uzakSesEl.setSinkId !== 'function') return false;   // iOS Safari → desteklenmez
    let cikislar = [];
    try { cikislar = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput' && d.deviceId); } catch {}
    if (cikislar.length >= 2) {                       // birden çok çıkış: hoparlör≈ilk(varsayılan), ahize/kulaklık≈sonraki
      const hedef = hoparlor ? cikislar[0].deviceId : cikislar[cikislar.length - 1].deviceId;
      await uzakSesEl.setSinkId(hedef); return true;
    }
    const hedef = hoparlor ? 'default' : 'communications';   // Chrome özel sink'leri (tek çıkışta dene)
    try { await uzakSesEl.setSinkId(hedef); return true; } catch { return false; }
  } catch { return false; }
}

function pcKur(oda) {
  odaAktif = oda;
  bekleyenIce = []; benimIce = [];
  pc = new RTCPeerConnection(ICE);
  pc.onicecandidate = (e) => { if (e.candidate) { benimIce.push(e.candidate); sinyalGonder(oda, { t: 'ice', c: e.candidate }); } };
  pc.ontrack = (e) => {
    const akis = e.streams[0] || new MediaStream([e.track]);
    // karşı tarafın sesi — <audio autoplay> sink'ine bağla → ses duyulur
    try { if (uzakSesEl) uzakSesEl.srcObject = akis; } catch {}
    // görüntülü aramada video track'i → <video> sink'i (sesi yine <audio>'dan çalar; video el sessiz)
    if (e.track.kind === 'video') {
      try { if (uzakVideoEl) { uzakVideoEl.muted = true; uzakVideoEl.srcObject = akis; } } catch {}
      window.__ARAMA_UZAK_VIDEO = true;
    }
    window.__ARAMA_UZAK_TRACK = true;
  };
  pc.onconnectionstatechange = () => {
    if (pc && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) kapat();
  };
  pc.ondatachannel = (e) => { dc = e.channel; dcKur(); };
  return pc;
}
function dcKur() {
  dc.onopen = () => { zilDurdur(); durumSet('konusuyor'); try { dc.send('merhaba:' + benK); } catch {} };
  dc.onmessage = (e) => { window.__ARAMA_SON_MESAJ = e.data; try { uiCb('mesaj', e.data); } catch {} };
  dc.onclose = () => { if (durum !== 'bos') kapat(); };
}
async function medyaEkle(video) {
  // mikrofon (+ görüntülü ise kamera) iste; izin/donanım yoksa kademeli düş:
  //   video başarısız → yalnız ses → o da yoksa yalnız datachannel. Çağrı her hâlde kurulur.
  if (video) {
    try {
      yerelMedya = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      yerelMedya.getTracks().forEach(t => pc.addTrack(t, yerelMedya));
      try { if (yerelVideoEl) { yerelVideoEl.muted = true; yerelVideoEl.srcObject = yerelMedya; } } catch {}
      window.__ARAMA_YEREL_VIDEO = yerelMedya.getVideoTracks().length > 0;
      return;
    } catch (e) { videoIstendi = false; /* kamera yok → sese düş */ }
  }
  try {
    yerelMedya = await navigator.mediaDevices.getUserMedia({ audio: true });
    yerelMedya.getTracks().forEach(t => pc.addTrack(t, yerelMedya));
  } catch (e) { /* mic yok → yalnız datachannel */ }
}
async function iceFlush() {
  const q = bekleyenIce; bekleyenIce = [];
  for (const c of q) { try { await pc.addIceCandidate(c); } catch {} }
}

// ── arayan taraf ── (opt.video=true → görüntülü arama)
export async function aramaBaslat(oda, opt = {}) {
  if (durum !== 'bos') return;
  videoIstendi = !!opt.video;
  await iceHazirla();   // çağrıdan önce TURN/STUN taze olsun (NAT arkası bağlanabilsin)
  pcKur(oda);
  dc = pc.createDataChannel('nar'); dcKur();
  await medyaEkle(videoIstendi);
  durumSet('ariyor');
  zilBaslat('giden');
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sinyalGonder(oda, { t: 'offer', sdp: pc.localDescription, video: videoIstendi });
  // Re-offer döngüsü: alıcı uygulaması kapalıysa Web Push ile uyanır; açılınca (≤3sn) bu tekrar
  // offer'ı yakalayıp zil çalar. ICE adaylarımı da tekrar yollarım (alıcı offline'ken düşenler ulaşsın).
  reOfferDurdur();
  reOfferTimer = setInterval(() => {
    if (durum === 'ariyor' && pc && pc.localDescription) {
      sinyalGonder(odaAktif, { t: 'offer', sdp: pc.localDescription, video: videoIstendi });
      benimIce.forEach(c => { try { sinyalGonder(odaAktif, { t: 'ice', c }); } catch {} });
    } else reOfferDurdur();
  }, 3000);
  cagriTimeout = setTimeout(() => { if (durum === 'ariyor') kapat(); }, 45000);   // 45sn cevapsız → bırak
}

// ── gelen aramayı KABUL et (kullanıcı 'Cevapla'ya bastı) ──
// Görüntülü gelen aramayı simetrik kabul ederiz (kamera açılır); opt.video ile zorlanabilir.
export async function aramaCevapla(opt = {}) {
  if (durum !== 'geliyor' || !pc) return;
  zilDurdur();
  durumSet('baglaniyor');
  const video = opt.video !== undefined ? !!opt.video : videoIstendi;
  videoIstendi = video;
  await medyaEkle(video);
  const ans = await pc.createAnswer();
  await pc.setLocalDescription(ans);
  sinyalGonder(odaAktif, { t: 'answer', sdp: pc.localDescription });
}

// ── gelen aramayı REDDET ──
export function aramaReddet() {
  if (durum !== 'geliyor') return;
  try { sinyalGonder(odaAktif, { t: 'reddet' }); } catch {}
  kapat();
}

// ── gelen sinyal (SSE 'sinyal' olayından) ──
export async function sinyalGeldi(oda, gonderen, s) {
  if (gonderen === benK || !s) return;
  if (s.t === 'offer') {
    if (durum !== 'bos') {
      if (gelenGonderen === gonderen) return;                       // aynı arayanın tekrar-offer'ı (re-offer) → zaten zil çalıyor, yok say
      try { sinyalGonder(oda, { t: 'mesgul' }); } catch {} return;  // başka çağrıdayım → meşgul
    }
    await iceHazirla();
    pcKur(oda);
    gelenGonderen = gonderen;
    videoIstendi = !!s.video;                 // arayan görüntülü mü istedi (UI: ekran + simetrik kamera)
    await pc.setRemoteDescription(s.sdp);     // mic/kamera GEREKMEZ — kabul'e dek bekle
    await iceFlush();
    durumSet('geliyor', gonderen);
    zilBaslat('gelen');
  } else if (s.t === 'answer') {
    reOfferDurdur();                                                // cevap geldi → tekrar-offer döngüsünü durdur
    if (pc && !pc.currentRemoteDescription) { await pc.setRemoteDescription(s.sdp); await iceFlush(); }
  } else if (s.t === 'ice') {
    if (pc && s.c) {
      if (pc.remoteDescription && pc.remoteDescription.type) { try { await pc.addIceCandidate(s.c); } catch {} }
      else bekleyenIce.push(s.c);            // remoteDescription gelene dek tampona al
    }
  } else if (s.t === 'reddet') {
    if (durum === 'ariyor') { durumSet('reddedildi'); setTimeout(kapat, 60); }
  } else if (s.t === 'mesgul') {
    if (durum === 'ariyor') { durumSet('mesgul'); setTimeout(kapat, 60); }
  } else if (s.t === 'bitir') {
    if (durum !== 'bos') kapat();
  }
}

export function kapat() {
  zilDurdur(); reOfferDurdur();
  try { if (odaAktif && ['ariyor', 'baglaniyor', 'konusuyor'].includes(durum)) sinyalGonder(odaAktif, { t: 'bitir' }); } catch {}
  try { dc && dc.close(); } catch {}
  try { yerelMedya && yerelMedya.getTracks().forEach(t => t.stop()); } catch {}
  try { pc && (pc.onconnectionstatechange = null, pc.close()); } catch {}
  try { if (uzakSesEl) uzakSesEl.srcObject = null; } catch {}
  try { if (uzakVideoEl) uzakVideoEl.srcObject = null; } catch {}
  try { if (yerelVideoEl) yerelVideoEl.srcObject = null; } catch {}
  pc = null; dc = null; yerelMedya = null; odaAktif = null; gelenGonderen = null; videoIstendi = false; bekleyenIce = [];
  mikKapali = false; hoparlorAcik = true;   // FAZ E: sonraki çağrı temiz başlasın (mute kapalı, hoparlör)
  kameraKapali = false; yuzKamera = 'user';  // H1: sonraki görüntülü çağrı temiz (kamera açık, ön yüz)
  if (durum !== 'bos') durumSet('bos');
}

// ── zil (UYARI) — amaç: "telefon çalıyor" hissi. ASIL uyarı = TİTREŞİM + görsel ekran;
//    ses tamamlayıcı. (Kesintisiz melodi değil; çal-1sn / dur-2sn ritminde tekrarlı uyarı.) ──
function zilBaslat(mod) {
  zilDurdur();
  const gelen = mod === 'gelen';
  // 1) TİTREŞİM — en güçlü uyarı (Android destekler; iOS Safari desteklemez). Gelen aramada nabız gibi tekrarlanır.
  if (gelen && navigator.vibrate) {
    const titret = () => { try { navigator.vibrate([500, 250, 500, 250, 500]); } catch {} };
    titret();
    zilVibTimer = setInterval(titret, 2400);
  }
  // 2) SES — tanıdık "brring" (iki frekans arası hızlı warble), yumuşak zarfla. Oto-oynatma kısıtında kısılabilir.
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    zilCtx = new AC(); try { zilCtx.resume(); } catch {}
    const burst = () => {
      if (!zilCtx) return;
      try {
        const t0 = zilCtx.currentTime;
        const sure = gelen ? 1.0 : 1.2;
        const fLo = gelen ? 480 : 420, fHi = gelen ? 620 : 480;
        const master = zilCtx.createGain();
        master.gain.value = gelen ? 0.16 : 0.09;
        master.connect(zilCtx.destination);
        const osc = zilCtx.createOscillator(); osc.type = 'sine';
        osc.frequency.value = (fLo + fHi) / 2;
        const lfo = zilCtx.createOscillator(); lfo.frequency.value = gelen ? 11 : 7;   // warble hızı
        const lfoG = zilCtx.createGain(); lfoG.gain.value = (fHi - fLo) / 2;
        lfo.connect(lfoG); lfoG.connect(osc.frequency);
        const env = zilCtx.createGain();                                                // tık-pat olmasın
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.exponentialRampToValueAtTime(1, t0 + 0.05);
        env.gain.setValueAtTime(1, t0 + sure - 0.1);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + sure);
        osc.connect(env); env.connect(master);
        osc.start(t0); lfo.start(t0);
        osc.stop(t0 + sure + 0.02); lfo.stop(t0 + sure + 0.02);
      } catch {}
    };
    burst();
    zilTimer = setInterval(burst, gelen ? 3000 : 4000);   // gelen: çal-1 / dur-2 ; giden: ringback seyrek
  } catch {}
}
function zilDurdur() {
  try { if (zilTimer) clearInterval(zilTimer); } catch {}
  zilTimer = null;
  try { if (zilVibTimer) clearInterval(zilVibTimer); } catch {}
  zilVibTimer = null;
  try { if (navigator.vibrate) navigator.vibrate(0); } catch {}   // titreşimi kes
  try { if (zilCtx) zilCtx.close(); } catch {}
  zilCtx = null;
}
function reOfferDurdur() {
  try { if (reOfferTimer) clearInterval(reOfferTimer); } catch {}
  try { if (cagriTimeout) clearTimeout(cagriTimeout); } catch {}
  reOfferTimer = null; cagriTimeout = null;
}
