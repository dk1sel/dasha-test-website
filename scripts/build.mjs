// Baut die dynamischen Teile der Seite:
//   1. Google-Kalender (iCal-Feed) laden -> site/data/events.json
//   2. Veranstaltungsorte per Nominatim (OpenStreetMap) geokodieren, mit Cache
//   3. Leaflet + Schriften aus node_modules nach site/vendor kopieren
//
// Aufruf:  node scripts/build.mjs            (echter Kalender)
//          node scripts/build.mjs --sample   (Beispieldaten aus sample/sample.ics)

import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ICAL from 'ical.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, 'site.config.json'), 'utf8'));

const useSample = process.argv.includes('--sample');
const icsUrl = process.env.GCAL_ICS_URL || config.calendarIcsUrl;
const cacheFile = path.join(root, '.cache', 'geocache.json');
const USER_AGENT = 'static-portfolio-calendar-build/1.0';

// ---------------------------------------------------------------- Kalender

async function loadIcs() {
  if (useSample || !icsUrl) {
    if (!useSample) console.warn('::warning::Keine Kalender-URL konfiguriert – verwende Beispieldaten.');
    return readFile(path.join(root, 'sample', 'sample.ics'), 'utf8');
  }
  const res = await fetch(icsUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Kalender-Abruf fehlgeschlagen: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Antwort ist kein iCal-Feed.');
  return text;
}

const pad = (n) => String(n).padStart(2, '0');
const dateOnly = (t) => `${t.year}-${pad(t.month)}-${pad(t.day)}`;

function stripHtml(s) {
  return s
    .replace(/<a\b[^>]*>.*?<\/a>/gis, '') // Links werden separat als Ticket-Link ausgegeben
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstUrl(...texts) {
  for (const t of texts) {
    const m = t && t.match(/https?:\/\/[^\s"'<>]+/);
    if (m) return m[0].replace(/[).,;]+$/, '');
  }
  return null;
}

function parseEvents(icsText) {
  const vcal = new ICAL.Component(ICAL.parse(icsText));
  for (const tz of vcal.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);

  const now = Date.now();
  const windowStart = now - 24 * 3600 * 1000; // gestern, damit laufende Termine nicht verschwinden
  const windowEnd = now + config.monthsAhead * 31 * 24 * 3600 * 1000;

  const vevents = vcal.getAllSubcomponents('vevent');
  const exceptions = vevents.filter((c) => c.hasProperty('recurrence-id'));
  const out = [];

  const push = (item, startDate, endDate) => {
    if (item.component.getFirstPropertyValue('status') === 'CANCELLED') return;
    const allDay = startDate.isDate;
    const startMs = startDate.toJSDate().getTime();
    const endMs = endDate ? endDate.toJSDate().getTime() : startMs;
    if (endMs < windowStart || startMs > windowEnd) return;

    const rawDescription = item.description || '';
    const description = stripHtml(rawDescription);
    const location = (item.location || '').trim();
    out.push({
      id: `${item.uid}-${startMs}`,
      title: (item.summary || '').trim() || 'Konzert',
      allDay,
      start: allDay ? dateOnly(startDate) : new Date(startMs).toISOString(),
      end: allDay ? dateOnly(endDate || startDate) : new Date(endMs).toISOString(),
      location,
      description,
      url: firstUrl(item.component.getFirstPropertyValue('url'), rawDescription),
      _sort: startMs,
    });
  };

  for (const comp of vevents) {
    if (comp.hasProperty('recurrence-id')) continue;
    const event = new ICAL.Event(comp);
    for (const ex of exceptions) {
      if (ex.getFirstPropertyValue('uid') === event.uid) event.relateException(ex);
    }
    if (!event.isRecurring()) {
      push(event, event.startDate, event.endDate);
      continue;
    }
    const it = event.iterator();
    for (let i = 0, next; i < 2000 && (next = it.next()); i++) {
      if (next.toJSDate().getTime() > windowEnd) break;
      const occ = event.getOccurrenceDetails(next);
      push(occ.item, occ.startDate, occ.endDate);
    }
  }

  out.sort((a, b) => a._sort - b._sort);
  return out.map(({ _sort, ...e }) => e);
}

// ------------------------------------------------------------- Geokodierung

async function loadCache() {
  try {
    return JSON.parse(await readFile(cacheFile, 'utf8'));
  } catch {
    return {};
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function nominatim(query) {
  // Nominatim-Nutzungsbedingungen: max. 1 Anfrage pro Sekunde
  const wait = lastRequest + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=de&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const [hit] = await res.json();
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
}

// Suchvarianten von genau nach ungenau. Google schreibt Adressen z. B. als
// "Saal, Domplatz 1, 60311 Frankfurt am Main-Innenstadt I, Deutschland" – den Bezirkszusatz
// kennt Nominatim nicht, daher zusätzlich Varianten nur mit Postleitzahl.
function queryVariants(location) {
  const parts = location.split(',').map((s) => s.trim()).filter(Boolean);
  const zipOnly = parts.map((p) => (/^\d{4,5}\s/.test(p) ? p.match(/^\d{4,5}/)[0] : p));
  const hasZip = zipOnly.some((p, i) => p !== parts[i]);
  const variants = [parts];
  if (hasZip) variants.push(zipOnly);
  if (parts.length > 2) {
    variants.push(parts.slice(1)); // ohne führenden Saal-/Hausnamen
    if (hasZip) variants.push(zipOnly.slice(1));
  }
  // Nie nur nach einem einzelnen Rest wie "Deutschland" suchen
  const ok = (v) => v.length > 1 || parts.length === 1;
  return [...new Set(variants.filter(ok).map((v) => v.join(', ')))];
}

async function geocode(location, cache) {
  if (location in cache) return cache[location];
  let result = null;
  try {
    for (const query of queryVariants(location)) {
      result = await nominatim(query);
      if (result) break;
    }
  } catch (err) {
    console.warn(`Geokodierung übersprungen für "${location}": ${err.message}`);
    return null; // nicht cachen, beim nächsten Lauf erneut versuchen
  }
  if (!result) console.warn(`Kein Kartenort gefunden für "${location}"`);
  cache[location] = result;
  return result;
}

// --------------------------------------------------------------------- Main

const events = parseEvents(await loadIcs());

const cache = await loadCache();
for (const ev of events) {
  if (!ev.location) continue;
  const pos = await geocode(ev.location, cache);
  if (pos) Object.assign(ev, pos);
}
await mkdir(path.dirname(cacheFile), { recursive: true });
await writeFile(cacheFile, JSON.stringify(cache, null, 2));

await mkdir(path.join(root, 'site', 'data'), { recursive: true });
await writeFile(
  path.join(root, 'site', 'data', 'events.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), timeZone: config.timeZone, events }, null, 2),
);

// Leaflet und Schriften lokal ausliefern (keine Drittanbieter-CDNs / Google Fonts)
const vendor = path.join(root, 'site', 'vendor');
const nm = path.join(root, 'node_modules');
await cp(path.join(nm, 'leaflet', 'dist'), path.join(vendor, 'leaflet'), {
  recursive: true,
  filter: (src) => !/leaflet-src|\.map$/.test(src),
});
await mkdir(path.join(vendor, 'fonts'), { recursive: true });
const fonts = [
  ['cormorant-garamond', ['500-normal', '500-italic', '600-normal']],
  ['inter', ['400-normal', '500-normal']],
];
for (const [family, variants] of fonts) {
  for (const v of variants) {
    const file = `${family}-latin-${v}.woff2`;
    await cp(path.join(nm, '@fontsource', family, 'files', file), path.join(vendor, 'fonts', file));
  }
}

const mapped = events.filter((e) => e.lat != null).length;
console.log(`${events.length} Termine geschrieben, ${mapped} davon mit Kartenposition.`);
