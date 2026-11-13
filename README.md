# Cembalistin-Portfolio

Statische Website mit Veranstaltungskalender aus Google Calendar.

## Wie es funktioniert

1. Eine GitHub Action (`.github/workflows/deploy.yml`) läuft bei jedem Push, einmal täglich (frühmorgens) und auf Knopfdruck.
2. `scripts/build.mjs` lädt den iCal-Feed des Google-Kalenders, löst Serientermine auf,
   geokodiert die Orte über Nominatim (OpenStreetMap) und schreibt `site/data/events.json`.
3. Der Ordner `site/` wird auf GitHub Pages veröffentlicht. Im Browser rendert `site/assets/app.js`
   die Terminliste und die Leaflet-Karte.

## Einrichtung

- **Google Kalender:** Einstellungen → Kalender → „Zugriffsberechtigungen für Termine“ →
  „Öffentlich freigeben“ mit **„Alle Termindetails anzeigen“** (nicht „Nur Verfügbarkeit“,
  sonst heißen alle Termine „Busy“ und haben keinen Ort).
- **Kalender-URL:** steht in `site.config.json`. Alternativ die „Geheime Adresse im iCal-Format“
  als Repository-Secret `GCAL_ICS_URL` hinterlegen – dann muss der Kalender nicht öffentlich sein.
- **GitHub Pages:** Repository → Settings → Pages → Source: „GitHub Actions“.

## Termine pflegen

Im Kalender eintragen: Titel, Zeit, **Ort** (am besten „Saal, Straße, PLZ Stadt“) und optional
eine Beschreibung. Der erste Link in der Beschreibung wird als „Karten & Infos“ verlinkt.

## Lokal ansehen

```sh
npm install
npm run build          # echter Kalender
npm run build:sample   # Beispieldaten aus sample/sample.ics
npm run serve          # http://localhost:8080
```

## Anpassen

- Texte: `site/index.html`
- Impressum und Datenschutz: `site/impressum.html`, `site/datenschutz.html` (Platzhalter „Erika Mustermann“ ersetzen)
- Hero-Bild: `site/assets/hero.svg` ersetzen (oder `hero.jpg` und `src` in `index.html` ändern)
- Farben: CSS-Variablen oben in `site/assets/style.css`
