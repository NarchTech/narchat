#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat E2E tam-akış kanıtı (PyNaCl = libsodium ile wire-uyumlu primitifler).
JS app.js'teki "e2e1" şemasını birebir taklit eder: gerçek ciphertext → gerçek
sunucu (:8101) → üye geri okuyup ÇÖZER, üye-olmayan ÇÖZEMEZ + sunucudan 403,
sunucu deposunda DÜZ-METİN YOK. Çalıştır: <venv>/bin/python e2e_roundtrip.py
"""
import json, base64, os, urllib.request, urllib.error, http.cookiejar, sys
from nacl.public import PrivateKey, PublicKey, Box
from nacl.secret import SecretBox
from nacl.utils import random as nrandom

B = "http://127.0.0.1:%s" % os.environ.get("NARCHAT_PORT", "8101")
b64 = lambda x: base64.b64encode(x).decode()
ub64 = lambda s: base64.b64decode(s)
PLAIN = "BULUSMA_SAAT_3_GIZLI"   # sentinel — sunucuya ASLA düz gitmemeli

def istemci():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def post(op, yol, veri):
    r = urllib.request.Request(B+yol, data=json.dumps(veri).encode(),
        headers={'Content-Type':'application/json', 'X-NarChat':'1'}, method='POST')   # D1/L2: CSRF başlığı
    return json.load(op.open(r))
def get(op, yol):
    return json.load(op.open(B+yol))

def main():
    gecti = []
    # 1) 3 kullanıcı + GERÇEK keypair
    users, ops = {}, {}
    for u in ['ali2','veli2','can2']:
        sk = PrivateKey.generate()
        users[u] = {'sk': sk, 'pub': bytes(sk.public_key)}
        op = istemci()
        # N1: kayıt artık v2 (sıfır-bilgi) — sahte bir doğrulayıcı yeter, bu test mesaj-E2E'yi ilgilendirir (auth değil).
        post(op, '/api/kayit', {'kullanici':u,'dogrulayici':b64(os.urandom(32)),'pubkey':b64(users[u]['pub'])})
        ops[u] = op
    gecti.append("3 kullanıcı + gerçek X25519 keypair kayıt")

    # 2) ali2 grup oda (ali2+veli2; can2 YOK)
    oda = post(ops['ali2'], '/api/oda', {'tip':'grup','ad':'gizli-proje','uyeler':['veli2']})['oda']
    kull = {x['kullanici']: x['pubkey'] for x in get(ops['ali2'], '/api/kullanicilar')}

    # 3) ali2 e2e1 şifreler [ali2, veli2] için (uniform: secretbox + per-üye box fan-out)
    K  = nrandom(SecretBox.KEY_SIZE)
    n1 = nrandom(SecretBox.NONCE_SIZE)
    msgc = SecretBox(K).encrypt(PLAIN.encode(), n1).ciphertext
    anahtarlar = []
    for m in ['ali2','veli2']:
        n2 = nrandom(Box.NONCE_SIZE)
        enc = Box(users['ali2']['sk'], PublicKey(ub64(kull[m]))).encrypt(K, n2).ciphertext
        anahtarlar.append({'uye':m,'n2':b64(n2),'anahtar':b64(enc)})
    blob = {'sema':'e2e1','msg':b64(msgc),'n':b64(n1),
            'gonderenPub':b64(users['ali2']['pub']),'anahtarlar':anahtarlar}
    post(ops['ali2'], '/api/mesaj', {'oda':oda,'govde':blob})
    gecti.append("ali2 gerçek ciphertext gönderdi (sunucuya düz-metin gitmedi)")

    # 4) veli2 (üye) geri okur + ÇÖZER
    g = get(ops['veli2'], '/api/mesajlar?oda=%s&since=0' % oda)[-1]['govde']
    mine = [a for a in g['anahtarlar'] if a['uye']=='veli2'][0]
    Kdec = Box(users['veli2']['sk'], PublicKey(ub64(g['gonderenPub']))).decrypt(ub64(mine['anahtar']), ub64(mine['n2']))
    dec  = SecretBox(Kdec).decrypt(ub64(g['msg']), ub64(g['n'])).decode()
    assert dec == PLAIN, "ÇÖZÜM EŞLEŞMEDİ: %r" % dec
    gecti.append("veli2 doğru çözdü: %r" % dec)

    # 5) can2 (üye değil): anahtar girdisi YOK + sunucu 403
    assert not any(a['uye']=='can2' for a in g['anahtarlar']), "can2 için anahtar olmamalı"
    try:
        get(ops['can2'], '/api/mesajlar?oda=%s&since=0' % oda)
        raise AssertionError("can2 403 beklenirken erişti — KÖTÜ")
    except urllib.error.HTTPError as e:
        assert e.code == 403, "can2 -> %d (403 olmalı)" % e.code
    gecti.append("can2 çözemez (anahtar yok) + sunucudan 403")

    print("✅ E2E TAM-AKIŞ GEÇTİ:")
    for i,g_ in enumerate(gecti,1): print("  %d. %s" % (i,g_))
    print("\nSENTINEL düz-metin: %r — şimdi sunucu deposunda aranacak (bulunmamalı)." % PLAIN)

if __name__ == "__main__":
    main()
