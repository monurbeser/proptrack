# 🏠 PropTrack — Emlak Fiyat Takip Aracı

Sahibinden, Dubizzle, Bayut, PropertyFinder ilanlarını takip et. Fiyat değişince Telegram'a bildirim al.

## 🚀 Railway.app ile Deploy (Ücretsiz, 5 dakika)

### 1. Browserless.io hesabı aç (scraper için)
1. https://browserless.io → Sign Up (ücretsiz, 1000 unit/ay)
2. Dashboard'dan **API Token**'ı kopyala

### 2. GitHub'a yükle
```bash
cd proptrack
git init
git add .
git commit -m "PropTrack initial"
# GitHub'da yeni repo aç, sonra:
git remote add origin https://github.com/KULLANICI/proptrack.git
git push -u origin main
```

### 3. Railway'e deploy et
1. https://railway.app → **New Project** → **Deploy from GitHub repo**
2. Repo'nu seç → **Deploy Now**
3. **Variables** sekmesine gir, şunları ekle:

| Key | Value |
|-----|-------|
| `BROWSERLESS_TOKEN` | browserless.io'dan aldığın token |
| `NODE_ENV` | `production` |

4. **Settings → Networking → Generate Domain** → URL'ni al (örn: `proptrack-xxx.up.railway.app`)

✅ Bitti! O URL'yi tarayıcıda aç.

---

## 📱 Telegram Kurulumu

1. Telegram → **@BotFather** → `/newbot` → isim ver → **token** al
2. **@userinfobot**'a herhangi mesaj at → `id` değerini kopyala
3. PropTrack dashboard → ⚙️ Ayarlar → Token + Chat ID gir → **Test** butonuna bas

---

## 💻 Local Çalıştırma (Playwright ile)

```bash
cd backend
npm install
npx playwright install chromium
USE_LOCAL_BROWSER=true npm start
# → http://localhost:3737
```

---

## Scraper Modları

| Mod | Ne zaman? | Nasıl aktif? |
|-----|-----------|--------------|
| **Browserless.io** | Railway / cloud | `BROWSERLESS_TOKEN=xxx` env var |
| **Local Playwright** | Kendi bilgisayarın | `USE_LOCAL_BROWSER=true` |
| **Plain HTTP** | SSR siteler için fallback | Hiçbir env var yok |

---

## ⚠️ Railway Notu: Veritabanı Kalıcılığı

Railway'in ücretsiz planında `/tmp` dizini restart'larda **silinebilir**. Veriler kaybolmasın istiyorsan:
- **Railway Volume** ekle (aylık ~$0.25/GB) → `DB_PATH=/data/proptrack.db` env var'ı ekle
- Veya **PlanetScale / Turso** gibi cloud SQLite kullan (ileride upgrade)

Şimdilik `/tmp` ile gayet çalışır; sadece deploy sonrası ilanları tekrar eklemen gerekebilir.
