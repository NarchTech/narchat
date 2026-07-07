#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NarChat — /api/turn ICE config kanıtı (FAZ D1). İzole sunucu, yalnız stdlib.
Doğrulanan:
  1. Auth gerek: oturumsuz /api/turn → 401
  2. TURN env YOK → STUN-only (turn: girişi yok) — paylaşımlı coturn cred'i sızmaz
  3. TURN env VAR → turn: girişi username+credential ile döner (cred ENV'den, statik pakette DEĞİL)
Çalıştır:  python3 test/turn_test.py
"""
import json, os, sys, time, subprocess, tempfile, urllib.request, urllib.error, http.cookiejar, base64, secrets

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def sunucu_baslat(port, veri, extra_env=None):
    env = {**os.environ, "NARCHAT_PORT": str(port), "NARCHAT_VERI": veri}
    if extra_env: env.update(extra_env)
    p = subprocess.Popen([sys.executable, os.path.join(KOK, "mesaj_server.py")],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    B = "http://127.0.0.1:%d" % port
    for _ in range(50):
        try: urllib.request.urlopen(B + "/api/ben"); break
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.1)
    return p, B

def kayit_opener(B, kullanici):
    # N1: kayıt artık v2 (sıfır-bilgi) — sahte bir doğrulayıcı yeter, bu test parolayı ilgilendirmez.
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    r = urllib.request.Request(B + "/api/kayit",
        data=json.dumps({"kullanici": kullanici, "dogrulayici": base64.b64encode(secrets.token_bytes(32)).decode()}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    op.open(r)
    return op

def get_json(op, url):
    return json.loads(op.open(url).read().decode())

def main():
    gecti = []
    veri = tempfile.mkdtemp(prefix="narchat-turn-")
    p, B = sunucu_baslat(8115, veri)
    try:
        # 1) oturumsuz → 401
        try:
            urllib.request.urlopen(B + "/api/turn"); raise AssertionError("oturumsuz 401 olmalıydı")
        except urllib.error.HTTPError as e:
            assert e.code == 401, "oturumsuz /api/turn 401 olmalı, geldi %s" % e.code
        gecti.append("oturumsuz /api/turn → 401 (cred yalnız authlu kullanıcıya)")

        # 2) TURN env yok → STUN-only
        op = kayit_opener(B, "alice")
        ice = get_json(op, B + "/api/turn").get("iceServers", [])
        urls = json.dumps(ice)
        assert ice and "stun:" in urls, "STUN girişi yok: %s" % urls
        assert "turn:" not in urls, "TURN env yokken turn: girişi OLMAMALI (cred sızıntısı): %s" % urls
        gecti.append("TURN env yok → STUN-only (turn: yok, paylaşımlı cred sızmaz)")
    finally:
        p.terminate()

    # 3) TURN env var → turn: girişi cred ile
    veri2 = tempfile.mkdtemp(prefix="narchat-turn2-")
    p2, B2 = sunucu_baslat(8116, veri2, extra_env={
        "NARCHAT_TURN_HOST": "203.0.113.9", "NARCHAT_TURN_USERNAME": "narcuser",
        "NARCHAT_TURN_CRED": "testcred123", "NARCHAT_TURN_PORT": "3478"})
    try:
        op2 = kayit_opener(B2, "bob")
        ice2 = get_json(op2, B2 + "/api/turn").get("iceServers", [])
        turns = [s for s in ice2 if "turn:" in json.dumps(s.get("urls"))]
        assert turns, "TURN env varken turn: girişi olmalı: %s" % json.dumps(ice2)
        t = turns[0]
        assert t.get("username") == "narcuser" and t.get("credential") == "testcred123", "turn cred eşleşmedi: %s" % t
        assert "203.0.113.9" in json.dumps(t.get("urls")), "turn host yok: %s" % t
        gecti.append("TURN env var → turn: girişi username+credential ile (cred ENV'den)")
    finally:
        p2.terminate()

    print("✅ /api/turn ICE CONFIG GEÇTİ:")
    for i, g in enumerate(gecti, 1): print("  %d. %s" % (i, g))

if __name__ == "__main__":
    main()
