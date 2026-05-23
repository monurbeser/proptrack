// server.js — PropTrack API server
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';
import { scrapeListing, detectSite } from './scraper.js';
import { notify, testTelegram } from './notifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend from /  (index.html lives one level up in ../frontend/)
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

// ─── Helpers ──────────────────────────────────────────────────────────────
function getSettings() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function listingWithHistory(id) {
  const db = getDb();
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  if (!listing) return null;
  const history = db.prepare(
    'SELECT price, checked_at FROM price_history WHERE listing_id = ? ORDER BY checked_at ASC'
  ).all(id);
  return { ...listing, history };
}

// ─── Check prices for all active listings ─────────────────────────────────
async function checkAllPrices() {
  const db = getDb();
  const listings = db.prepare('SELECT * FROM listings WHERE active = 1').all();
  console.log(`[cron] Checking ${listings.length} listings...`);

  for (const listing of listings) {
    try {
      const scraped = await scrapeListing(listing.url);
      const now = new Date().toISOString();

      if (!scraped.price) {
        console.warn(`[cron] No price found for: ${listing.url}`);
        db.prepare('UPDATE listings SET last_checked = ? WHERE id = ?').run(now, listing.id);
        continue;
      }

      // Always record history
      db.prepare(
        'INSERT INTO price_history (listing_id, price, checked_at) VALUES (?, ?, ?)'
      ).run(listing.id, scraped.price, now);

      const oldPrice = listing.current_price;

      // Update listing
      db.prepare(`
        UPDATE listings SET
          title = COALESCE(?, title),
          address = COALESCE(?, address),
          image_url = COALESCE(?, image_url),
          current_price = ?,
          last_checked = ?
        WHERE id = ?
      `).run(scraped.title, scraped.address, scraped.image_url, scraped.price, now, listing.id);

      // Notify if price changed
      if (oldPrice && scraped.price !== oldPrice) {
        await notify({ ...listing, ...scraped }, oldPrice, scraped.price);
      }

      console.log(`[cron] ${listing.title || listing.url}: ${oldPrice} → ${scraped.price}`);
    } catch (err) {
      console.error(`[cron] Error scraping ${listing.url}:`, err.message);
    }
  }
  console.log('[cron] Done.');
}

// ─── Routes ───────────────────────────────────────────────────────────────

// GET /api/listings — all listings
app.get('/api/listings', (req, res) => {
  const db = getDb();
  const listings = db.prepare(`
    SELECT l.*,
      (SELECT price FROM price_history WHERE listing_id = l.id ORDER BY checked_at DESC LIMIT 1 OFFSET 1) as previous_price
    FROM listings l
    WHERE l.active = 1
    ORDER BY l.created_at DESC
  `).all();
  res.json(listings);
});

// GET /api/listings/:id — single listing with price history
app.get('/api/listings/:id', (req, res) => {
  const listing = listingWithHistory(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Not found' });
  res.json(listing);
});

// POST /api/listings — add new listing by URL
app.post('/api/listings', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const db = getDb();

  // Check duplicate
  const existing = db.prepare('SELECT id FROM listings WHERE url = ?').get(url);
  if (existing) return res.status(409).json({ error: 'Bu URL zaten eklenmiş', id: existing.id });

  const site = detectSite(url);

  // Insert placeholder
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO listings (url, site, title, created_at, last_checked)
    VALUES (?, ?, 'Yükleniyor...', datetime('now'), null)
  `).run(url, site);

  // Respond immediately, scrape in background
  res.json({ id: lastInsertRowid, url, site, status: 'scraping' });

  // Scrape async
  try {
    const scraped = await scrapeListing(url);
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE listings SET
        title = ?,
        address = ?,
        image_url = ?,
        current_price = ?,
        currency = ?,
        last_checked = ?
      WHERE id = ?
    `).run(
      scraped.title || 'Başlık bulunamadı',
      scraped.address || '',
      scraped.image_url,
      scraped.price,
      scraped.currency || 'AED',
      now,
      lastInsertRowid
    );

    if (scraped.price) {
      db.prepare(
        'INSERT INTO price_history (listing_id, price, checked_at) VALUES (?, ?, ?)'
      ).run(lastInsertRowid, scraped.price, now);
    }
  } catch (err) {
    console.error('[add] Scrape error:', err.message);
    db.prepare("UPDATE listings SET title = 'Scrape hatası' WHERE id = ?").run(lastInsertRowid);
  }
});

// DELETE /api/listings/:id
app.delete('/api/listings/:id', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE listings SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/listings/:id/refresh — manually refresh one listing
app.post('/api/listings/:id/refresh', async (req, res) => {
  const db = getDb();
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Not found' });

  try {
    const scraped = await scrapeListing(listing.url);
    const now = new Date().toISOString();

    if (scraped.price) {
      db.prepare(
        'INSERT INTO price_history (listing_id, price, checked_at) VALUES (?, ?, ?)'
      ).run(listing.id, scraped.price, now);
    }

    db.prepare(`
      UPDATE listings SET
        title = COALESCE(?, title),
        address = COALESCE(?, address),
        image_url = COALESCE(?, image_url),
        current_price = ?,
        last_checked = ?
      WHERE id = ?
    `).run(scraped.title, scraped.address, scraped.image_url, scraped.price, now, listing.id);

    if (listing.current_price && scraped.price && scraped.price !== listing.current_price) {
      await notify({ ...listing, ...scraped }, listing.current_price, scraped.price);
    }

    res.json({ ok: true, ...scraped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/check-all — trigger manual check
app.post('/api/check-all', async (req, res) => {
  res.json({ ok: true, message: 'Kontrol başlatıldı' });
  await checkAllPrices();
});

// GET /api/settings
app.get('/api/settings', (req, res) => {
  const settings = getSettings();
  // Don't expose full token
  if (settings.telegram_bot_token) {
    settings.telegram_bot_token_set = true;
    settings.telegram_bot_token = settings.telegram_bot_token.slice(0, 8) + '...';
  }
  res.json(settings);
});

// PUT /api/settings
app.put('/api/settings', (req, res) => {
  const db = getDb();
  const allowed = ['telegram_bot_token', 'telegram_chat_id', 'check_interval_hours', 'notify_on_increase', 'notify_on_decrease'];
  for (const [key, value] of Object.entries(req.body)) {
    if (allowed.includes(key)) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
    }
  }
  setupCron();
  res.json({ ok: true });
});

// POST /api/settings/test-telegram
app.post('/api/settings/test-telegram', async (req, res) => {
  const { token, chat_id } = req.body;
  const result = await testTelegram(token, chat_id);
  res.json(result);
});

// GET /api/stats
app.get('/api/stats', (req, res) => {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as n FROM listings WHERE active=1').get().n;
  const drops = db.prepare(`
    SELECT COUNT(*) as n FROM listings
    WHERE active=1 AND current_price < (
      SELECT price FROM price_history WHERE listing_id = listings.id ORDER BY checked_at DESC LIMIT 1 OFFSET 1
    )
  `).get().n;
  const rises = db.prepare(`
    SELECT COUNT(*) as n FROM listings
    WHERE active=1 AND current_price > (
      SELECT price FROM price_history WHERE listing_id = listings.id ORDER BY checked_at DESC LIMIT 1 OFFSET 1
    )
  `).get().n;
  res.json({ total, drops, rises });
});

// ─── Cron setup ───────────────────────────────────────────────────────────
let cronJob = null;

function setupCron() {
  const settings = getSettings();
  const hours = parseInt(settings.check_interval_hours) || 6;

  if (cronJob) { cronJob.stop(); cronJob = null; }

  const expr = `0 */${hours} * * *`;
  cronJob = cron.schedule(expr, checkAllPrices, { timezone: 'Asia/Dubai' });
  console.log(`[cron] Scheduled every ${hours}h (${expr})`);
}

// ─── Start ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3737;
app.listen(PORT, () => {
  console.log(`\n🏠 PropTrack API running on http://localhost:${PORT}`);
  getDb(); // init DB
  setupCron();
});
