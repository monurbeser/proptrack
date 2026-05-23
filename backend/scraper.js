// scraper.js — Multi-site property price scraper
// Modes:
//   BROWSERLESS_TOKEN set  → Browserless.io cloud (recommended for Railway)
//   USE_LOCAL_BROWSER=true → Local Playwright
//   Neither               → Plain HTTP fetch (SSR-only sites)
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

const BROWSERLESS_TOKEN = process.env.BROWSERLESS_TOKEN;
const USE_LOCAL = process.env.USE_LOCAL_BROWSER === 'true';

// ─── Site detection ─────────────────────────────────────────────────────────
export function detectSite(url) {
  if (url.includes('sahibinden.com')) return 'sahibinden';
  if (url.includes('dubizzle.com'))   return 'dubizzle';
  if (url.includes('bayut.com'))      return 'bayut';
  if (url.includes('propertyfinder')) return 'propertyfinder';
  return 'unknown';
}

// ─── HTML fetching strategies ────────────────────────────────────────────────
async function fetchViaBrowserless(url) {
  const endpoint = `https://chrome.browserless.io/content?token=${BROWSERLESS_TOKEN}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      waitFor: 2500,
      rejectResourceTypes: ['image', 'font', 'stylesheet'],
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    })
  });
  if (!res.ok) throw new Error(`Browserless error: ${res.status} ${await res.text()}`);
  return res.text();
}

async function fetchViaPlaywright(url) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-US', viewport: { width: 1280, height: 800 }
    });
    const page = await ctx.newPage();
    await page.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf,otf}', r => r.abort());
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    return page.content();
  } finally {
    await browser.close();
  }
}

async function fetchViaHttp(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,tr;q=0.8',
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchHtml(url) {
  if (BROWSERLESS_TOKEN && !USE_LOCAL) return fetchViaBrowserless(url);
  if (USE_LOCAL) return fetchViaPlaywright(url);
  return fetchViaHttp(url);
}

// ─── Main scrape function ────────────────────────────────────────────────────
export async function scrapeListing(url) {
  const site = detectSite(url);
  const mode = (BROWSERLESS_TOKEN && !USE_LOCAL) ? 'browserless' : USE_LOCAL ? 'playwright' : 'http';
  console.log(`[scraper] ${site} via ${mode}: ${url}`);

  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  let result = { url, site, title: null, address: null, price: null, currency: 'AED', image_url: null };

  switch (site) {
    case 'sahibinden':     result = { ...result, ...scrapeSahibinden($) }; break;
    case 'dubizzle':       result = { ...result, ...scrapeDubizzle($, html) }; break;
    case 'bayut':          result = { ...result, ...scrapeBayut($, html) }; break;
    case 'propertyfinder': result = { ...result, ...scrapePropertyFinder($, html) }; break;
    default:               result = { ...result, ...scrapeGeneric($) };
  }

  return result;
}

// ─── Site parsers ────────────────────────────────────────────────────────────
function scrapeSahibinden($) {
  const title = $('h1.classifiedDetailTitle').text().trim()
    || $('h1[itemprop="name"]').text().trim()
    || $('title').text().replace('- sahibinden.com', '').trim();

  let priceText = $('.classifiedInfo h3').text().trim()
    || $('[itemprop="price"]').attr('content')
    || $('.price-container').text().trim()
    || $('meta[property="og:price:amount"]').attr('content');

  const price = parsePrice(priceText);
  const currency = detectCurrency(priceText) || 'TRY';

  const address = $('[itemprop="addressLocality"]').text().trim()
    || $('.classifiedInfo ul').text().trim().split('\n')[0]
    || '';

  const image_url = $('meta[property="og:image"]').attr('content') || null;
  return { title, price, currency, address, image_url };
}

function scrapeDubizzle($, html) {
  const title = $('h1').first().text().trim()
    || $('meta[property="og:title"]').attr('content')?.trim();

  let priceText = $('[data-testid="listing-price"]').text().trim()
    || $('[class*="Price"]').first().text().trim()
    || $('meta[property="product:price:amount"]').attr('content');

  if (!priceText) priceText = extractJsonLdPrice($);

  const price = parsePrice(priceText);
  const currency = detectCurrency(priceText) || 'AED';

  const address = $('[data-testid="listing-location"]').text().trim()
    || $('address').first().text().trim() || '';

  const image_url = $('meta[property="og:image"]').attr('content') || null;
  return { title, price, currency, address, image_url };
}

function scrapeBayut($, html) {
  const title = $('h1').first().text().trim()
    || $('meta[property="og:title"]').attr('content')?.trim();

  let price = null, currency = 'AED', address = '';

  const nextData = extractNextData($);
  if (nextData) {
    try {
      const listing = findDeep(nextData, 'listing') || findDeep(nextData, 'propertyDetails');
      if (listing?.price) { price = parseFloat(String(listing.price).replace(/[^0-9.]/g, '')); }
      if (listing?.currency) currency = listing.currency;
      address = listing?.location?.name || listing?.address || '';
    } catch {}
  }

  if (!price) {
    const priceText = $('[class*="price"], [class*="Price"]').first().text().trim()
      || $('meta[property="product:price:amount"]').attr('content');
    price = parsePrice(priceText);
    currency = detectCurrency(priceText) || 'AED';
  }

  if (!address) address = $('[class*="location"], [class*="Location"]').first().text().trim() || '';
  const image_url = $('meta[property="og:image"]').attr('content') || null;
  return { title, price, currency, address, image_url };
}

function scrapePropertyFinder($, html) {
  const title = $('h1').first().text().trim()
    || $('meta[property="og:title"]').attr('content')?.trim();

  let price = null, currency = 'AED', address = '';

  const nextData = extractNextData($);
  if (nextData) {
    try {
      const priceNode = findDeep(nextData, 'price');
      if (typeof priceNode === 'number') price = priceNode;
      else if (typeof priceNode === 'string') price = parseFloat(priceNode.replace(/[^0-9.]/g, ''));
      const curNode = findDeep(nextData, 'currency');
      if (curNode) currency = curNode;
      const addrNode = findDeep(nextData, 'location');
      if (addrNode?.name) address = addrNode.name;
    } catch {}
  }

  if (!price) {
    const priceText = $('[data-testid*="price"], [class*="price"]').first().text().trim()
      || $('meta[property="product:price:amount"]').attr('content');
    price = parsePrice(priceText);
    currency = detectCurrency(priceText) || 'AED';
  }

  if (!address) address = $('[class*="location"], [class*="address"]').first().text().trim() || '';
  const image_url = $('meta[property="og:image"]').attr('content') || null;
  return { title, price, currency, address, image_url };
}

function scrapeGeneric($) {
  const title = $('h1').first().text().trim()
    || $('meta[property="og:title"]').attr('content')?.trim();
  const image_url = $('meta[property="og:image"]').attr('content') || null;
  let price = null, currency = 'AED', address = '';
  const priceText = extractJsonLdPrice($);
  if (priceText) { price = parsePrice(priceText); currency = detectCurrency(priceText) || 'AED'; }
  return { title, price, currency, address, image_url };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parsePrice(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/[^\d.,]/g, '').replace(/,/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function detectCurrency(text) {
  if (!text) return null;
  if (/AED|dhs?|درهم/i.test(text)) return 'AED';
  if (/SAR|ريال/i.test(text)) return 'SAR';
  if (/TRY|TL|₺/i.test(text)) return 'TRY';
  if (/USD|\$/i.test(text)) return 'USD';
  if (/EUR|€/i.test(text)) return 'EUR';
  return null;
}

function extractNextData($) {
  const el = $('#__NEXT_DATA__');
  if (!el.length) return null;
  try { return JSON.parse(el.html()); } catch { return null; }
}

function extractJsonLdPrice($) {
  let found = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const d = JSON.parse($(el).html());
      if (d.offers?.price) found = String(d.offers.price);
      else if (d.price) found = String(d.price);
    } catch {}
  });
  return found;
}

function findDeep(obj, key, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== 'object') return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const found = findDeep(v, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}
