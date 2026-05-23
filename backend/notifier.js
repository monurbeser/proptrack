// notifier.js — Telegram & Email notifications
import fetch from 'node-fetch';
import { getDb } from './db.js';

function getSettings() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// ─── Telegram ─────────────────────────────────────────────────────────────
export async function sendTelegramNotification(listing, oldPrice, newPrice) {
  const settings = getSettings();
  const token = settings.telegram_bot_token;
  const chatId = settings.telegram_chat_id;

  if (!token || !chatId) {
    console.log('[notifier] Telegram not configured, skipping.');
    return false;
  }

  const direction = newPrice > oldPrice ? '📈 FİYAT ARTTI' : '📉 FİYAT DÜŞTÜ';
  const diff = Math.abs(newPrice - oldPrice);
  const pct = ((diff / oldPrice) * 100).toFixed(1);
  const sign = newPrice > oldPrice ? '+' : '-';
  const cur = listing.currency || 'AED';

  const formatPrice = (p) => p?.toLocaleString('en-US', { maximumFractionDigits: 0 });

  const message = `
${direction} 🏠

*${escapeMarkdown(listing.title || 'İlan')}*
📍 ${escapeMarkdown(listing.address || listing.site || '')}

💰 Eski Fiyat: ${formatPrice(oldPrice)} ${cur}
💵 Yeni Fiyat: *${formatPrice(newPrice)} ${cur}*
${sign}${formatPrice(diff)} ${cur} (${sign}${pct}%)

🔗 [İlana Git](${listing.url})
`.trim();

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      })
    });

    const data = await res.json();
    if (!data.ok) {
      console.error('[notifier] Telegram error:', data.description);
      return false;
    }
    console.log(`[notifier] Telegram notification sent for: ${listing.title}`);
    return true;
  } catch (err) {
    console.error('[notifier] Telegram fetch error:', err.message);
    return false;
  }
}

// ─── Test Telegram connection ──────────────────────────────────────────────
export async function testTelegram(token, chatId) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '✅ PropTrack bağlandı! Fiyat değişikliklerini buradan takip edeceksiniz.',
        parse_mode: 'Markdown'
      })
    });
    const data = await res.json();
    return { ok: data.ok, error: data.description };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Notify with settings check ───────────────────────────────────────────
export async function notify(listing, oldPrice, newPrice) {
  const settings = getSettings();
  const increased = newPrice > oldPrice;

  if (increased && settings.notify_on_increase !== '1') return;
  if (!increased && settings.notify_on_decrease !== '1') return;

  await sendTelegramNotification(listing, oldPrice, newPrice);
}

function escapeMarkdown(text) {
  return String(text || '').replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}
