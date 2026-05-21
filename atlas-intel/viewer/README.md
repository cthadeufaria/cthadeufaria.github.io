# Location Intelligence Data Viewer

Interactive web-based viewer to explore and inspect all downloaded geographic data.

## Features

- 🗺️ **Interactive Map** - Leaflet.js map with country markers
- 🏴 **Regional Flags** - Display Unicode regional flags (Wales, Scotland, etc.)
- ✈️ **Airport Overlay** - See nearby airports for each country
- 🔍 **Search** - Quick search through countries
- 📊 **Data Inspector** - View metadata, boundaries, and statistics
- 🎨 **Beautiful UI** - Modern, gradient design with smooth animations

## Quick Start

### Option 1: Python HTTP Server (Recommended)

```bash
cd location_improvements/viewer
python -m docs.site.viewer.serve
```

This will:
1. Start a local web server on port 8000
2. Automatically open your browser to http://localhost:8000
3. Serve the viewer with CORS enabled

### Option 2: Direct File Access

```bash
cd location_improvements/viewer
open index.html
```

Note: Some features may not work due to CORS restrictions. Use Option 1 instead.

## What You Can Do

### Explore Countries
- Click any country in the sidebar to view details
- See capital city location on map
- View regions (e.g., England, Scotland, Wales for UK)
- Check regional flag emojis

### Inspect Data
- Geography information (coordinates, capital)
- Regional breakdown with flags
- Nearby airports (from mwgg/Airports database)
- Data source availability status

### Search
- Type in the search box to filter countries
- Search by name or ISO code

### Map Interaction
- Pan and zoom the map
- Click markers for popups
- Blue dots = airports
- Red marker = capital city

## Data Sources

The viewer automatically loads data from:

```
location_improvements/
├── data/
│   ├── airports/
│   │   └── airports.json          # ✅ Loaded
│   ├── cia_factbook/
│   │   └── cia_factbook_2025.json # ⏳ Coming soon
│   └── resources/
│       ├── countries.v2.json      # Canonical v2 country data
│       └── boundaries/            # ⏳ Coming soon
└── viewer/
    ├── index.html
    ├── app.js
    └── serve.py
```

### Currently Available
- ✅ Mock country data (10 countries)
- ✅ Regional flags (UK, US, Spain)
- ✅ Airport database (if downloaded)
- ✅ Interactive map

### Coming Soon (After Processing)
- GeoJSON boundary visualization
- Full CIA Factbook 2025 data
- All 247 countries
- Polygon rendering on map

## UI Overview

### Sidebar
- **Search Box** - Filter countries
- **Stats Cards** - Country and region counts
- **Country List** - Scrollable list with flags

### Main Area
- **Map** - Interactive Leaflet map (top)
- **Details Panel** - Country information (bottom)

### Details Panel Sections
1. **Header** - Flag, name, ISO code
2. **Regions** - Sub-countries with flags
3. **Geographic Info** - Capital, coordinates, airports
4. **Data Sources** - What's loaded/pending

## Customization

### Add More Countries

Edit `app.js` → `generateMockData()`:

```javascript
const mockCountries = [
    {
        code: 'GB',
        name: 'United Kingdom',
        flag: '🇬🇧',
        capital: 'London',
        lat: 51.5074,
        lon: -0.1278,
        regions: [
            { code: 'GB-WLS', name: 'Wales', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' }
        ]
    },
    // Add more...
];
```

### Change Map Style

Edit `app.js` → `initMap()`:

```javascript
// Use different tile provider
L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenTopoMap contributors'
}).addTo(this.map);
```

Options:
- OpenStreetMap (default)
- OpenTopoMap (topographic)
- CartoDB (light/dark themes)
- Stamen (artistic styles)

### Change Color Scheme

Edit `index.html` → `<style>`:

```css
.header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    /* Change to your colors */
}
```

## Browser Support

- ✅ Chrome/Edge (latest)
- ✅ Safari (latest)
- ✅ Firefox (latest)
- ⚠️ Regional flags require Unicode 15.1 support
- ⚠️ Some regional flags may not render on Windows

## Troubleshooting

### Map not loading
- Check internet connection (tile maps require network)
- Try clearing browser cache
- Check console for errors (F12 → Console)

### Airports not showing
- Ensure `data/airports/airports.json` exists
- Check file path in browser console
- Try starting server with `serve.py` instead of opening directly

### Regional flags show as boxes
- Update your OS/browser to latest version
- Some flags (Wales, Scotland) require Unicode 15.1+
- Fallback: Will show national flag instead

### CORS errors
- Use `python -m docs.site.viewer.serve` instead of opening HTML directly
- Don't use `file://` protocol

## Next Steps

### After Phase 2 Processing

Once you process the data (Phase 2), update `app.js` to load real data:

```javascript
async loadData() {
    // Load processed countries
    const response = await fetch('../resources/countries.v2.json');
    const data = await response.json();
    this.countries = data.entities;

    // Load CIA Factbook 2025
    const factbookResponse = await fetch('../data/cia_factbook/cia_factbook_2025.json');
    const factbook = await factbookResponse.json();
    this.factbook = factbook.countries;

    // Load GeoJSON boundaries
    const boundariesResponse = await fetch('../resources/boundaries/countries_50m.geojson');
    const boundaries = await boundariesResponse.json();
    this.addBoundariesToMap(boundaries);
}
```

### Enhancement Ideas

- [ ] Add country comparison view
- [ ] Show travel routes between countries
- [ ] Display timezone information
- [ ] Add weather overlay
- [ ] Export data to CSV/JSON
- [ ] Dark mode toggle
- [ ] Mobile-responsive design
- [ ] Fullscreen map mode

## Credits

- **Map**: Leaflet.js + OpenStreetMap
- **Data**: Natural Earth, mwgg/Airports, CIA Factbook
- **Icons**: Unicode emoji
- **Design**: Custom gradient theme

## License

Same as parent project - see location_improvements/docs/ATTRIBUTIONS.md

---

**Have fun exploring!** 🌍
