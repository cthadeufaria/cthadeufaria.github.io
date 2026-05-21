// Location Intelligence Data Viewer
class DataViewer {
    constructor() {
        this.countries = [];
        this.airports = {};
        this.selectedCountry = null;
        this.map = null;
        this.markers = [];

        this.init();
    }

    async init() {
        // Initialize map
        this.initMap();

        // Load data
        await this.loadData();

        // Setup event listeners
        this.setupEventListeners();
    }

    initMap() {
        // Initialize Leaflet map
        this.map = L.map('map').setView([20, 0], 2);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18
        }).addTo(this.map);
    }

    async loadData() {
        try {
            // Try to load airports data
            const airportsResponse = await fetch('../data/airports/airports.json');
            if (airportsResponse.ok) {
                this.airports = await airportsResponse.json();
                console.log(`Loaded ${Object.keys(this.airports).length} airports`);
            }
        } catch (error) {
            console.log('Airports data not available yet');
        }

        // Generate mock country data (will be replaced with actual data)
        this.generateMockData();

        // Render country list
        this.renderCountryList();

        // Update stats
        this.updateStats();
    }

    generateMockData() {
        // This will be replaced with actual data from processed files
        // For now, generate from existing countryDetails structure

        const mockCountries = [
            { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', capital: 'London', lat: 51.5074, lon: -0.1278,
              regions: [
                  { code: 'GB-ENG', name: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
                  { code: 'GB-SCT', name: 'Scotland', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
                  { code: 'GB-WLS', name: 'Wales', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
                  { code: 'GB-NIR', name: 'Northern Ireland', flag: '🇬🇧' }
              ]
            },
            { code: 'US', name: 'United States', flag: '🇺🇸', capital: 'Washington, D.C.', lat: 38.9072, lon: -77.0369,
              regions: [
                  { code: 'US-CA', name: 'California', flag: '🏴󠁵󠁳󠁣󠁡󠁿' },
                  { code: 'US-TX', name: 'Texas', flag: '🏴󠁵󠁳󠁴󠁸󠁿' },
                  { code: 'US-NY', name: 'New York', flag: '🏴󠁵󠁳󠁮󠁹󠁿' }
              ]
            },
            { code: 'FR', name: 'France', flag: '🇫🇷', capital: 'Paris', lat: 48.8566, lon: 2.3522 },
            { code: 'DE', name: 'Germany', flag: '🇩🇪', capital: 'Berlin', lat: 52.5200, lon: 13.4050 },
            { code: 'ES', name: 'Spain', flag: '🇪🇸', capital: 'Madrid', lat: 40.4168, lon: -3.7038,
              regions: [
                  { code: 'ES-CT', name: 'Catalonia', flag: '🇪🇸' },
                  { code: 'ES-PV', name: 'Basque Country', flag: '🇪🇸' }
              ]
            },
            { code: 'IT', name: 'Italy', flag: '🇮🇹', capital: 'Rome', lat: 41.9028, lon: 12.4964 },
            { code: 'JP', name: 'Japan', flag: '🇯🇵', capital: 'Tokyo', lat: 35.6762, lon: 139.6503 },
            { code: 'CN', name: 'China', flag: '🇨🇳', capital: 'Beijing', lat: 39.9042, lon: 116.4074 },
            { code: 'AU', name: 'Australia', flag: '🇦🇺', capital: 'Canberra', lat: -35.2809, lon: 149.1300 },
            { code: 'BR', name: 'Brazil', flag: '🇧🇷', capital: 'Brasília', lat: -15.8267, lon: -47.9218 }
        ];

        this.countries = mockCountries;
    }

    renderCountryList() {
        const listContainer = document.getElementById('countryList');
        listContainer.innerHTML = '';

        this.countries.forEach(country => {
            const item = document.createElement('div');
            item.className = 'country-item';
            item.innerHTML = `
                <div style="display: flex; align-items: center;">
                    <span class="flag">${country.flag}</span>
                    <div>
                        <div class="name">${country.name}</div>
                        <div class="code">${country.code}${country.regions ? ` • ${country.regions.length} regions` : ''}</div>
                    </div>
                </div>
            `;

            item.addEventListener('click', () => this.selectCountry(country));
            listContainer.appendChild(item);
        });
    }

    selectCountry(country) {
        this.selectedCountry = country;

        // Update active state in list
        document.querySelectorAll('.country-item').forEach(item => {
            item.classList.remove('active');
        });
        event.currentTarget.classList.add('active');

        // Render details
        this.renderDetails(country);

        // Update map
        this.updateMap(country);
    }

    renderDetails(country) {
        const detailsContainer = document.getElementById('details');

        let regionsHTML = '';
        if (country.regions && country.regions.length > 0) {
            regionsHTML = `
                <div class="section">
                    <div class="section-title">Regions</div>
                    <div class="data-grid">
                        ${country.regions.map(region => `
                            <div class="data-item">
                                <div style="display: flex; align-items: center; gap: 0.5rem;">
                                    <span style="font-size: 1.5rem;">${region.flag}</span>
                                    <div>
                                        <div class="data-item-label">${region.code}</div>
                                        <div class="data-item-value">${region.name}</div>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Count nearby airports
        const nearbyAirports = this.getNearbyAirports(country.lat, country.lon, 500);

        detailsContainer.innerHTML = `
            <div class="details-header">
                <span class="flag">${country.flag}</span>
                <div>
                    <h2>${country.name}</h2>
                    <div class="iso-code">${country.code}</div>
                </div>
            </div>

            ${regionsHTML}

            <div class="section">
                <div class="section-title">Geographic Information</div>
                <div class="data-grid">
                    <div class="data-item">
                        <div class="data-item-label">Capital</div>
                        <div class="data-item-value">${country.capital || 'N/A'}</div>
                    </div>
                    <div class="data-item">
                        <div class="data-item-label">Coordinates</div>
                        <div class="data-item-value">${country.lat?.toFixed(4)}, ${country.lon?.toFixed(4)}</div>
                    </div>
                    <div class="data-item">
                        <div class="data-item-label">Nearby Airports</div>
                        <div class="data-item-value">${nearbyAirports.length}</div>
                    </div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Data Sources</div>
                <div class="data-grid">
                    <div class="data-item">
                        <div class="data-item-label">Natural Earth</div>
                        <div class="data-item-value">✅ Available</div>
                    </div>
                    <div class="data-item">
                        <div class="data-item-label">Airports</div>
                        <div class="data-item-value">${Object.keys(this.airports).length > 0 ? '✅ Loaded' : '⏳ Pending'}</div>
                    </div>
                    <div class="data-item">
                        <div class="data-item-label">CIA Factbook</div>
                        <div class="data-item-value">⏳ Pending</div>
                    </div>
                </div>
            </div>
        `;
    }

    getNearbyAirports(lat, lon, radiusKm) {
        const nearby = [];

        for (const [icao, airport] of Object.entries(this.airports)) {
            if (!airport.lat || !airport.lon) continue;

            const distance = this.calculateDistance(lat, lon, airport.lat, airport.lon);
            if (distance <= radiusKm) {
                nearby.push({
                    ...airport,
                    distance
                });
            }
        }

        return nearby.sort((a, b) => a.distance - b.distance);
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        // Haversine formula
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    updateMap(country) {
        // Clear existing markers
        this.markers.forEach(marker => this.map.removeLayer(marker));
        this.markers = [];

        // Center on country
        this.map.setView([country.lat, country.lon], 6);

        // Add capital marker
        const marker = L.marker([country.lat, country.lon]).addTo(this.map);
        marker.bindPopup(`<b>${country.capital}</b><br>${country.name}`).openPopup();
        this.markers.push(marker);

        // Add nearby airports
        const nearby = this.getNearbyAirports(country.lat, country.lon, 500);
        nearby.slice(0, 10).forEach(airport => {
            const airportMarker = L.circleMarker([airport.lat, airport.lon], {
                radius: 5,
                fillColor: '#667eea',
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(this.map);

            airportMarker.bindPopup(`
                <b>${airport.name}</b><br>
                IATA: ${airport.iata || 'N/A'} | ICAO: ${airport.icao}<br>
                Distance: ${airport.distance.toFixed(1)} km
            `);

            this.markers.push(airportMarker);
        });
    }

    updateStats() {
        const countryCount = this.countries.length;
        const regionCount = this.countries.reduce((sum, c) => sum + (c.regions?.length || 0), 0);

        document.getElementById('countryCount').textContent = countryCount;
        document.getElementById('regionCount').textContent = regionCount;
    }

    setupEventListeners() {
        // Search functionality
        const searchInput = document.getElementById('search');
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();

            document.querySelectorAll('.country-item').forEach(item => {
                const name = item.querySelector('.name').textContent.toLowerCase();
                const code = item.querySelector('.code').textContent.toLowerCase();

                if (name.includes(query) || code.includes(query)) {
                    item.style.display = 'block';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new DataViewer();
});
