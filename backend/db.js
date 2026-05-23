import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = process.env.RAILWAY_ENVIRONMENT ? '/tmp' : __dirname;
const DB_PATH = path.join(DB_DIR, 'proptrack.db.json');
console.log(`[db] Using database: ${DB_PATH}`);

let data = {
  listings: [], price_history: [],
  settings: [
    { key: 'telegram_bot_token', value: '' },
    { key: 'telegram_chat_id', value: '' },
    { key: 'check_interval_hours', value: '6' },
    { key: 'notify_on_increase', value: '1' },
    { key: 'notify_on_decrease', value: '1' },
  ],
  _nextId: { listings: 1, price_history: 1 }
};

function load() {
  if (existsSync(DB_PATH)) { try { data = JSON.parse(readFileSync(DB_PATH, 'utf8')); } catch {} }
}
function save() { writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }
load();

class Statement {
  constructor(sql) { this.sql = sql.trim(); }
  run(...args) {
    const s = this.sql;
    if (/INSERT OR IGNORE INTO settings/i.test(s)) {
      const [key, value] = args;
      if (!data.settings.find(x => x.key === key)) data.settings.push({ key, value });
      save(); return { lastInsertRowid: null };
    }
    if (/INSERT OR REPLACE INTO settings/i.test(s)) {
      const [key, value] = args;
      const i = data.settings.findIndex(x => x.key === key);
      if (i >= 0) data.settings[i].value = value; else data.settings.push({ key, value });
      save(); return { lastInsertRowid: null };
    }
    if (/INSERT INTO listings/i.test(s)) {
      const id = data._nextId.listings++;
      data.listings.push({ id, url: args[0], site: args[1], title: args[2], created_at: new Date().toISOString(), last_checked: null, active: 1, current_price: null, currency: 'AED', address: null, image_url: null });
      save(); return { lastInsertRowid: id };
    }
    if (/INSERT INTO price_history/i.test(s)) {
      const id = data._nextId.price_history++;
      data.price_history.push({ id, listing_id: args[0], price: args[1], checked_at: args[2] || new Date().toISOString() });
      save(); return { lastInsertRowid: id };
    }
    if (/UPDATE listings SET\s+title = COALESCE/i.test(s)) {
      const [title, address, image_url, current_price, last_checked, id] = args;
      const l = data.listings.find(x => x.id === id);
      if (l) { if (title) l.title = title; if (address !== undefined) l.address = address; if (image_url) l.image_url = image_url; if (current_price != null) l.current_price = current_price; l.last_checked = last_checked; }
      save(); return {};
    }
    if (/UPDATE listings SET\s+title = \?/i.test(s)) {
      const [title, address, image_url, current_price, currency, last_checked, id] = args;
      const l = data.listings.find(x => x.id === id);
      if (l) { l.title = title; l.address = address; l.image_url = image_url; l.current_price = current_price; l.currency = currency || 'AED'; l.last_checked = last_checked; }
      save(); return {};
    }
    if (/UPDATE listings SET last_checked/i.test(s)) {
      const l = data.listings.find(x => x.id === args[1]);
      if (l) l.last_checked = args[0];
      save(); return {};
    }
    if (/UPDATE listings SET active = 0/i.test(s)) {
      const l = data.listings.find(x => x.id === args[0]);
      if (l) l.active = 0;
      save(); return {};
    }
    if (/UPDATE listings SET title/i.test(s)) {
      const l = data.listings.find(x => x.id === args[0]);
      if (l) l.title = s.match(/'([^']+)'/)?.[1] || 'Hata';
      save(); return {};
    }
    return {};
  }
  get(...args) {
    const s = this.sql;
    if (/SELECT \* FROM listings WHERE id/i.test(s)) return data.listings.find(x => x.id === args[0]) || null;
    if (/SELECT id FROM listings WHERE url/i.test(s)) return data.listings.find(x => x.url === args[0]) || null;
    if (/SELECT COUNT.*active=1$/i.test(s)) return { n: data.listings.filter(x => x.active === 1).length };
    if (/SELECT COUNT.*current_price </i.test(s)) {
      return { n: data.listings.filter(l => { if (!l.active) return false; const h = data.price_history.filter(x => x.listing_id === l.id).sort((a,b) => new Date(b.checked_at)-new Date(a.checked_at)); return h.length >= 2 && l.current_price < h[1].price; }).length };
    }
    if (/SELECT COUNT.*current_price >/i.test(s)) {
      return { n: data.listings.filter(l => { if (!l.active) return false; const h = data.price_history.filter(x => x.listing_id === l.id).sort((a,b) => new Date(b.checked_at)-new Date(a.checked_at)); return h.length >= 2 && l.current_price > h[1].price; }).length };
    }
    return null;
  }
  all(...args) {
    const s = this.sql;
    if (/SELECT key, value FROM settings/i.test(s)) return data.settings;
    if (/SELECT \* FROM listings WHERE active = 1/i.test(s)) {
      return data.listings.filter(x => x.active === 1).sort((a,b) => new Date(b.created_at)-new Date(a.created_at)).map(l => {
        const h = data.price_history.filter(x => x.listing_id === l.id).sort((a,b) => new Date(b.checked_at)-new Date(a.checked_at));
        return { ...l, previous_price: h.length >= 2 ? h[1].price : null };
      });
    }
    if (/SELECT price, checked_at FROM price_history/i.test(s)) {
      return data.price_history.filter(x => x.listing_id === args[0]).sort((a,b) => new Date(a.checked_at)-new Date(b.checked_at));
    }
    return [];
  }
}

export function getDb() {
  return { prepare: (sql) => new Statement(sql), exec: () => {}, pragma: () => {} };
}
