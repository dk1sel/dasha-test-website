// Galerie: Klick auf ein Bild öffnet es groß, mit Pfeiltasten blättern.
(function () {
  const links = [...document.querySelectorAll('#gallery a')];
  const box = document.getElementById('lightbox');
  if (!links.length || !box || !box.showModal) return;
  const img = box.querySelector('img');
  const cap = box.querySelector('figcaption');
  let i = 0;
  const show = (n) => {
    i = (n + links.length) % links.length;
    const a = links[i];
    img.src = a.href;
    img.alt = a.querySelector('img').alt;
    cap.textContent = a.closest('figure').querySelector('figcaption')?.textContent || '';
  };
  links.forEach((a, n) => a.addEventListener('click', (ev) => { ev.preventDefault(); show(n); box.showModal(); }));
  box.querySelector('.lightbox__close').addEventListener('click', () => box.close());
  box.querySelector('.lightbox__nav--prev').addEventListener('click', () => show(i - 1));
  box.querySelector('.lightbox__nav--next').addEventListener('click', () => show(i + 1));
  box.addEventListener('click', (ev) => { if (ev.target === box) box.close(); });
  box.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft') show(i - 1);
    if (ev.key === 'ArrowRight') show(i + 1);
  });
})();

// Rendert data/events.json (erzeugt von scripts/build.mjs) als Terminliste + Leaflet-Karte.
(async function () {
  document.getElementById('year').textContent = new Date().getFullYear();

  const list = document.getElementById('event-list');
  const mapEl = document.getElementById('map');

  let data;
  try {
    const res = await fetch('data/events.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch (err) {
    showEmpty('Die Termine konnten gerade nicht geladen werden.');
    return;
  }

  const tz = data.timeZone || 'Europe/Berlin';
  const fmt = (opts) => new Intl.DateTimeFormat('de-DE', { timeZone: tz, ...opts });
  const fDay = fmt({ day: '2-digit' });
  const fMonth = fmt({ month: 'short', year: 'numeric' });
  const fWeekday = fmt({ weekday: 'long' });
  const fTime = fmt({ hour: '2-digit', minute: '2-digit' });
  const fShort = fmt({ day: 'numeric', month: 'long', year: 'numeric' });

  // Ganztägige Termine sind reine Datumsangaben (Ende exklusiv) -> als Mittag UTC behandeln,
  // damit die Zeitzone den Tag nicht verschiebt.
  const startOf = (e) => new Date(e.allDay ? e.start + 'T12:00:00Z' : e.start);
  const endOf = (e) => (e.allDay ? new Date(new Date(e.end + 'T12:00:00Z').getTime() - 864e5) : new Date(e.end));
  const lastMoment = (e) => (e.allDay ? new Date(e.end + 'T00:00:00Z') : new Date(e.end));

  // Die Seite wird nur periodisch neu gebaut – Vergangenes hier nochmals ausfiltern.
  const now = new Date();
  const events = data.events.filter((e) => lastMoment(e) >= now);
  if (!events.length) {
    showEmpty('Zurzeit sind keine Konzerte angekündigt. Neue Termine folgen in Kürze.');
    return;
  }

  function whenText(e) {
    const s = startOf(e);
    if (!e.allDay) return `${fWeekday.format(s)}, ${fTime.format(s)} Uhr`;
    const last = endOf(e);
    return last > s ? `bis ${fShort.format(last)}` : fWeekday.format(s);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  list.textContent = '';
  const items = new Map();
  for (const e of events) {
    const s = startOf(e);
    const li = el('li', 'event');

    const date = el('time', 'event__date');
    date.dateTime = e.start;
    date.append(el('span', 'event__day', fDay.format(s)), el('span', 'event__month', fMonth.format(s)));

    const body = el('div');
    body.append(el('h3', 'event__title', e.title));
    const meta = el('p', 'event__meta');
    meta.append(el('span', null, whenText(e)));
    if (e.location) meta.append(el('span', null, e.location));
    body.append(meta);
    if (e.description) body.append(el('p', 'event__desc', e.description));
    if (e.url && /^https?:\/\//.test(e.url)) {
      const a = el('a', 'event__link', 'Karten & Infos');
      a.href = e.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.setAttribute('aria-label', `Karten & Infos: ${e.title} (öffnet neuen Tab)`);
      body.append(a);
    }

    li.append(date, body);
    list.append(li);
    items.set(e.id, li);
  }

  // ---- Karte ----
  const mapped = events.filter((e) => typeof e.lat === 'number' && typeof e.lon === 'number');
  if (!mapped.length || !window.L) {
    mapEl.hidden = true;
    document.querySelector('.events').style.gridTemplateColumns = '1fr';
    return;
  }

  const map = L.map(mapEl, { scrollWheelZoom: false });
  // Leaflet-Präfix ohne Flagge; die OSM-Namensnennung unten bleibt (Pflicht laut ODbL)
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
  }).addTo(map);

  // Mehrere Termine am selben Ort teilen sich einen Marker
  const places = new Map();
  for (const e of mapped) {
    const key = `${e.lat.toFixed(5)},${e.lon.toFixed(5)}`;
    if (!places.has(key)) places.set(key, []);
    places.get(key).push(e);
  }

  const style = { radius: 8, color: '#e6c88c', weight: 2, fillColor: '#c9a45c', fillOpacity: 0.85 };
  const activeStyle = { radius: 12, fillColor: '#f6f0e4', fillOpacity: 1 };

  function setActive(ids, on) {
    for (const id of ids) items.get(id).classList.toggle('is-active', on);
  }

  for (const group of places.values()) {
    const popup = el('div');
    group.forEach((e, i) => {
      if (i) popup.append(el('hr'));
      popup.append(
        el('strong', null, e.title),
        el('span', 'popup__when', `${fShort.format(startOf(e))} · ${whenText(e)}`),
        el('span', null, e.location),
      );
    });
    const ids = group.map((e) => e.id);
    const marker = L.circleMarker([group[0].lat, group[0].lon], style).addTo(map).bindPopup(popup);
    marker.on('popupopen', () => { marker.setStyle(activeStyle); setActive(ids, true); });
    marker.on('popupclose', () => { marker.setStyle(style); setActive(ids, false); });

    for (const e of group) {
      const li = items.get(e.id);
      li.classList.add('event--mapped');
      const showOnMap = () => {
        map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 12), { duration: 0.8 });
        marker.openPopup();
      };
      li.addEventListener('click', (ev) => {
        if (ev.target.closest('a, button')) return;
        showOnMap();
      });
      // Für Tastatur und Screenreader: eigener Button statt nur Klick auf den Listeneintrag
      const btn = el('button', 'event__show', 'Auf der Karte zeigen');
      btn.type = 'button';
      btn.setAttribute('aria-label', `${e.title} auf der Karte zeigen`);
      btn.addEventListener('click', () => { showOnMap(); mapEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
      li.querySelector('div').append(btn);
    }
  }

  map.fitBounds(L.latLngBounds(mapped.map((e) => [e.lat, e.lon])), { padding: [40, 40], maxZoom: 13 });

  function showEmpty(text) {
    list.textContent = '';
    list.append(Object.assign(document.createElement('li'), { className: 'events__empty', textContent: text }));
    mapEl.hidden = true;
    document.querySelector('.events').style.gridTemplateColumns = '1fr';
  }
})();
