// NarChat — auth.js (FAZ N1: sıfır-bilgi kimlik doğrulama çekirdeği).
// Parola sunucuya HİÇ gitmez: Argon2id (deterministik salt = generichash('nar-auth-v1|'+kullanici))
// ile paroladan bir Ed25519 imza-anahtar çifti türetilir; sunucuya YALNIZ public anahtar
// ("doğrulayıcı") gider. Giriş: sunucudan meydan (nonce) alınır → bu türetilmiş özel anahtarla
// imzalanır → yalnız imza gönderilir (parola/parola-türevi sır asla gitmez).
// Bu anahtar çifti MESAJ ŞİFRELEME anahtarından (app.js PRIV/crypto_box) TAMAMEN AYRIDIR.
import _sodium from './vendor/libsodium-sumo.js';
await _sodium.ready;
const S = _sodium;
const B64 = S.base64_variants.ORIGINAL;
const b64 = (u8) => S.to_base64(u8, B64);

// ── KDF profilleri (D1/M1) ──
// Türetilmiş doğrulayıcı sunucuda saklanır ve çevrimdışı sözlük saldırısına açık bir hedeftir
// (kullanicilar.json sızarsa). Bu yüzden Argon2id parametreleri güçlü olmalı.
// DONMUŞ KURAL: bir profil bir kez kullanıldıysa parametreleri ASLA değişmez — değişirse o profille
// türetilmiş her hesap bir daha giriş yapamaz (aynı parola farklı anahtar üretir). Güçlendirme = YENİ id.
//   1 = INTERACTIVE (ops 2, 64 MiB)  — N1'in ilk sürümü; yalnız o dönemde açılmış hesaplar için tutulur.
//   2 = MODERATE     (ops 3, 256 MiB) — D1/M1: ~4x bellek-sertliği; login'de tek sefer, ~0.5-1sn.
const KDF_PROFILLERI = {
  1: [S.crypto_pwhash_OPSLIMIT_INTERACTIVE, S.crypto_pwhash_MEMLIMIT_INTERACTIVE],
  2: [S.crypto_pwhash_OPSLIMIT_MODERATE,    S.crypto_pwhash_MEMLIMIT_MODERATE],
};
export const KDF_VARSAYILAN = 2;   // yeni kayıtlar + yükseltme hedefi (mevcut en güçlü profil)

function _tuz(kullanici) {
  return S.crypto_generichash(S.crypto_pwhash_SALTBYTES, 'nar-auth-v1|' + kullanici);
}
// Paroladan deterministik Ed25519 tohum → anahtar çifti (aynı kullanıcı+parola+profil → hep AYNI çift,
// böylece herhangi bir cihazdan yalnız kullanıcı+parola ile yeniden türetilebilir).
function _anahtarCifti(kullanici, parola, profil) {
  const [ops, mem] = KDF_PROFILLERI[profil] || KDF_PROFILLERI[KDF_VARSAYILAN];
  const tohum = S.crypto_pwhash(S.crypto_sign_SEEDBYTES, parola, _tuz(kullanici),
    ops, mem, S.crypto_pwhash_ALG_DEFAULT);
  return S.crypto_sign_seed_keypair(tohum);
}
// Kayıt / yükseltme: sunucuya yalnız public "doğrulayıcı" gider (varsayılan = en güçlü profil).
export function dogrulayiciUret(kullanici, parola, profil = KDF_VARSAYILAN) {
  return b64(_anahtarCifti(kullanici, parola, profil).publicKey);
}
// Giriş: sunucudan alınan meydan (string) hesabın KENDİ profiliyle türetilmiş özel anahtarla imzalanır
// (hesap hangi profille açıldıysa; sunucu giris-meydan yanıtında bildirir).
export function meydanImzala(kullanici, parola, meydan, profil = KDF_VARSAYILAN) {
  const priv = _anahtarCifti(kullanici, parola, profil).privateKey;
  return b64(S.crypto_sign_detached(meydan, priv));
}
