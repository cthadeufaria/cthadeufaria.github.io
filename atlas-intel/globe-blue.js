// Location Intelligence Globe Viewer
class GlobeViewer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.globe = null;
        this.countries = {};
        this.airports = {};
        this.boundaries = null;
        this.regions = null;

        this.meshes = {
            countryBoundaries: [],
            regionBoundaries: [],
            airports: [],
            capitals: [],
            allAirports: []  // For full 29K airport dataset
        };

        this.settings = {
            showCountryBoundaries: true,
            showRegionBoundaries: true,
            showAirports: true,
            showCapitals: true,
            showAllAirports: false,
            autoRotate: false
        };

        this.allAirportsLoaded = false;  // Track if full airport dataset has been loaded
        this.selectedObject = null;  // Track selected country/region

        // IndexedDB for caching
        this.dbName = 'GlobeBlueDataCache';
        this.dbVersion = 1;
        this.db = null;

        this.init();
    }

    async initDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('dataFiles')) {
                    const store = db.createObjectStore('dataFiles', { keyPath: 'url' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    async getCachedData(url) {
        if (!this.db) return null;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['dataFiles'], 'readonly');
            const store = transaction.objectStore('dataFiles');
            const request = store.get(url);

            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    // Check if cache is stale (older than 1 hour for development, 24 hours for production)
                    const maxAge = window.location.hostname === 'localhost' ? 3600000 : 86400000;
                    const age = Date.now() - result.timestamp;

                    if (age > maxAge) {
                        console.log(`⏰ Cache expired: ${url} (age: ${Math.round(age/60000)}min)`);
                        resolve(null);
                    } else {
                        console.log(`✅ Cache hit: ${url} (age: ${Math.round(age/60000)}min)`);
                        resolve({ data: result.data, etag: result.etag });
                    }
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => resolve(null);
        });
    }

    async setCachedData(url, data, etag = null) {
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['dataFiles'], 'readwrite');
            const store = transaction.objectStore('dataFiles');
            const request = store.put({
                url,
                data,
                etag,
                timestamp: Date.now()
            });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async fetchWithCache(url) {
        // Try cache first
        const cached = await this.getCachedData(url);

        if (cached) {
            // If we have cached data, do a conditional fetch with ETag
            if (cached.etag) {
                try {
                    const response = await fetch(url, {
                        headers: { 'If-None-Match': cached.etag }
                    });

                    if (response.status === 304) {
                        // Not modified, use cache
                        console.log(`✅ ETag match: ${url} (using cache)`);
                        return cached.data;
                    }

                    // Modified, update cache
                    const data = await response.json();
                    const newEtag = response.headers.get('ETag');
                    await this.setCachedData(url, data, newEtag);
                    console.log(`🔄 Updated cache: ${url}`);
                    return data;
                } catch (err) {
                    console.warn('ETag check failed, using cache:', err);
                    return cached.data;
                }
            }

            return cached.data;
        }

        // Fetch from network
        console.log(`📥 Fetching from network: ${url}`);
        const response = await fetch(url);
        const data = await response.json();
        const etag = response.headers.get('ETag');

        // Store in cache
        await this.setCachedData(url, data, etag);

        return data;
    }

    async init() {
        this.setupScene();
        this.createGlobe();
        this.setupEventListeners();
        this.animate();

        // Initialize IndexedDB cache
        try {
            await this.initDatabase();
            console.log('✅ Cache initialized');
        } catch (err) {
            console.warn('⚠️  Cache unavailable, using network only:', err);
        }

        // Start loading data and rendering progressively
        await this.loadData();
        // Progressive rendering happens in loadData, which handles hiding the loading screen
    }

    setupScene() {
        const canvas = document.getElementById('globe');
        const container = document.getElementById('container');

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = null;

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            45,
            container.clientWidth / container.clientHeight,
            0.1,
            1000
        );
        this.camera.position.z = 300;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        // Controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.rotateSpeed = 0.5;
        this.controls.zoomSpeed = 0.6;
        this.controls.minDistance = 120;
        this.controls.maxDistance = 500;
        this.controls.enablePan = false;  // Disable panning for cleaner interaction

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
        directionalLight.position.set(5, 3, 5);
        this.scene.add(directionalLight);

        // Handle resize
        window.addEventListener('resize', () => {
            const container = document.getElementById('container');
            this.camera.aspect = container.clientWidth / container.clientHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(container.clientWidth, container.clientHeight);
        });
    }

    createGlobe() {
        // Globe sphere
        const geometry = new THREE.SphereGeometry(100, 64, 64);
        const material = new THREE.MeshPhongMaterial({
            color: 0x2233ff,
            emissive: 0x112244,
            specular: 0x333333,
            shininess: 15,
            transparent: true,
            opacity: 0.8
        });

        this.globe = new THREE.Mesh(geometry, material);
        this.scene.add(this.globe);

        // Add atmosphere glow
        const glowGeometry = new THREE.SphereGeometry(102, 64, 64);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: 0x3344ff,
            transparent: true,
            opacity: 0.1,
            side: THREE.BackSide
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        this.scene.add(glow);
    }

    updateLoadingProgress(message, progress) {
        const loadingDiv = document.getElementById('loading');
        const loadingText = loadingDiv.querySelector('div:last-child');
        const spinner = loadingDiv.querySelector('.spinner');

        if (loadingText) {
            loadingText.innerHTML = `
                <div style="margin-bottom: 8px;">${message}</div>
                <div style="font-size: 12px; opacity: 0.7;">
                    <div style="background: rgba(255,255,255,0.1); height: 4px; border-radius: 2px; overflow: hidden; margin-top: 8px;">
                        <div style="background: linear-gradient(90deg, #667eea, #764ba2); height: 100%; width: ${progress}%; transition: width 0.3s;"></div>
                    </div>
                    <div style="margin-top: 4px;">${progress}% complete</div>
                </div>
            `;
        }
    }

    async loadData() {
        try {
            // Make loading screen transparent immediately so we can see rendering
            document.getElementById('loading').classList.add('transparent');

            // Define data sources in rendering order
            const dataSources = [
                {
                    name: 'Countries Database',
                    url: 'resources/countries.v2.json',
                    size: '0.96 MB',
                    key: 'countries',
                    render: null  // Metadata only
                },
                {
                    name: 'Country Boundaries',
                    url: 'resources/countries_50m.geojson',
                    size: '9.7 MB',
                    key: 'boundaries',
                    render: () => this.renderCountryBoundaries()
                },
                // Regional boundaries disabled to reduce loading overhead
                // {
                //     name: 'Regional Boundaries',
                //     url: 'resources/regions_10m.geojson',
                //     size: '25 MB',
                //     key: 'regions',
                //     render: () => this.renderRegionBoundaries()
                // },
                {
                    name: 'Airports Database',
                    url: 'resources/airports_iata.json',
                    size: '2.1 MB',
                    key: 'airports',
                    render: () => {
                        this.renderCapitals();
                        this.renderAirports();
                    }
                }
            ];

            // Load and render sequentially
            for (let i = 0; i < dataSources.length; i++) {
                const source = dataSources[i];
                const progress = Math.round((i / dataSources.length) * 100);

                this.updateLoadingProgress(`Loading ${source.name} (${source.size})...`, progress);

                // Use cache if available, otherwise fetch from network
                const data = await this.fetchWithCache(source.url);

                // Process data
                switch(source.key) {
                    case 'countries':
                        this.countries = data.entities || data; // Support both formats
                        console.log(`✅ Loaded ${Object.keys(this.countries).length} countries`);
                        break;
                    case 'boundaries':
                        this.boundaries = data;
                        console.log(`✅ Loaded ${this.boundaries.features.length} country boundaries`);
                        break;
                    case 'regions':
                        this.regions = data;
                        console.log(`✅ Loaded ${this.regions.features.length} regional boundaries`);
                        break;
                    case 'airports':
                        this.airports = data.airports || data; // Support both formats
                        console.log(`✅ Loaded ${Object.keys(this.airports).length} airports`);
                        break;
                }

                // Render immediately after loading
                if (source.render) {
                    const renderProgress = Math.round(((i + 0.5) / dataSources.length) * 100);
                    this.updateLoadingProgress(`Rendering ${source.name.replace(' Database', '').replace(' Boundaries', '')}...`, renderProgress);
                    await this.delay(100);  // Brief delay to show message
                    source.render();
                    await this.delay(300);  // Let user see the rendering
                }
            }

            // Update stats
            this.updateStats();

            // Hide loading screen
            this.updateLoadingProgress('Complete!', 100);
            await this.delay(500);
            document.getElementById('loading').style.opacity = '0';
            setTimeout(() => {
                document.getElementById('loading').style.display = 'none';
            }, 500);

        } catch (error) {
            console.error('Error loading data:', error);
            this.updateLoadingProgress(`Error: ${error.message}`, 0);
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    renderCountryBoundaries() {
        console.log('Rendering country boundaries...');

        for (const feature of this.boundaries.features) {
            if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
                continue;
            }

            const coordinates = feature.geometry.type === 'Polygon'
                ? [feature.geometry.coordinates]
                : feature.geometry.coordinates;

            for (const polygon of coordinates) {
                const outerRing = polygon[0];
                if (outerRing.length < 3) continue;

                const points = outerRing.map(([lon, lat]) => this.latLonToVector3(lat, lon, 100.3));

                // Create a thick tube along the boundary using TubeGeometry
                const curve = new THREE.CatmullRomCurve3(points, true); // closed curve
                const tubeGeometry = new THREE.TubeGeometry(curve, points.length * 2, 0.8, 8, true);

                const tubeMaterial = new THREE.MeshBasicMaterial({
                    color: 0x2a4a5a,
                    transparent: true,
                    opacity: 0.5,
                    side: THREE.DoubleSide,
                    depthWrite: false
                });

                const tubeMesh = new THREE.Mesh(tubeGeometry, tubeMaterial);
                tubeMesh.userData = {
                    type: 'country-boundary',
                    properties: feature.properties
                };
                tubeMesh.renderOrder = 1;
                this.meshes.countryBoundaries.push(tubeMesh);
                this.globe.add(tubeMesh);

                // Add thin outline on top for definition
                const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
                const lineMaterial = new THREE.LineBasicMaterial({
                    color: 0x00ffff,
                    transparent: true,
                    opacity: 0.9,
                    linewidth: 1
                });

                const line = new THREE.Line(lineGeometry, lineMaterial);
                line.userData = { type: 'country-outline', properties: feature.properties };
                line.renderOrder = 2;
                this.globe.add(line);
            }
        }

        console.log(`Rendered ${this.meshes.countryBoundaries.length} country boundary tubes`);
    }

    subdividePolygon(ring, divisions) {
        // Subdivide each edge of the polygon for smoother sphere conformance
        const subdivided = [];

        for (let i = 0; i < ring.length - 1; i++) {
            const [lon1, lat1] = ring[i];
            const [lon2, lat2] = ring[i + 1];

            subdivided.push([lon1, lat1]);

            // Add intermediate points
            for (let j = 1; j <= divisions; j++) {
                const t = j / (divisions + 1);
                const lon = lon1 + (lon2 - lon1) * t;
                const lat = lat1 + (lat2 - lat1) * t;
                subdivided.push([lon, lat]);
            }
        }

        // Close the ring
        subdivided.push(ring[ring.length - 1]);

        return subdivided;
    }

    renderRegionBoundaries() {
        console.log('Rendering regional boundaries...');

        for (const feature of this.regions.features) {
            if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
                continue;
            }

            const coordinates = feature.geometry.type === 'Polygon'
                ? [feature.geometry.coordinates]
                : feature.geometry.coordinates;

            for (const polygon of coordinates) {
                const outerRing = polygon[0];
                if (outerRing.length < 3) continue;

                const points = outerRing.map(([lon, lat]) => this.latLonToVector3(lat, lon, 100.2));

                // Invisible clickable mesh
                const geometry = new THREE.BufferGeometry();
                const vertices = [];
                const indices = [];

                for (let i = 0; i < points.length; i++) {
                    vertices.push(points[i].x, points[i].y, points[i].z);
                }

                for (let i = 1; i < points.length - 1; i++) {
                    indices.push(0, i, i + 1);
                }

                geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
                geometry.setIndex(indices);

                const fillMaterial = new THREE.MeshBasicMaterial({
                    color: 0x1a3a2a,
                    transparent: true,
                    opacity: 0.0,  // Invisible by default
                    side: THREE.DoubleSide,
                    depthWrite: false
                });

                const fillMesh = new THREE.Mesh(geometry, fillMaterial);
                fillMesh.userData = {
                    type: 'region-boundary',
                    properties: feature.properties,
                    originalColor: 0x1a3a2a,
                    originalOpacity: 0.0
                };
                fillMesh.renderOrder = 1;
                this.meshes.regionBoundaries.push(fillMesh);
                this.globe.add(fillMesh);

                // Visible green outline
                const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
                const lineMaterial = new THREE.LineBasicMaterial({
                    color: 0x00ff00,
                    transparent: true,
                    opacity: 0.6,
                    linewidth: 1
                });

                const line = new THREE.Line(lineGeometry, lineMaterial);
                line.userData = { type: 'region-outline', properties: feature.properties };
                line.renderOrder = 2;
                this.globe.add(line);
            }
        }

        console.log(`Rendered ${this.meshes.regionBoundaries.length} regional boundary meshes`);
    }

    renderAirports() {
        console.log('Rendering airports...');

        let count = 0;
        for (const [icao, airport] of Object.entries(this.airports)) {
            if (!airport.lat || !airport.lon) continue;

            const position = this.latLonToVector3(airport.lat, airport.lon, 100.5);

            const geometry = new THREE.SphereGeometry(0.4, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color: 0xffaa00,
                transparent: true,
                opacity: 1.0
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.copy(position);
            mesh.userData = { type: 'airport', airport };

            this.meshes.airports.push(mesh);
            this.globe.add(mesh);
            count++;
        }

        console.log(`Rendered ${count} airports`);
    }

    renderCapitals() {
        console.log('Rendering capitals...');

        let count = 0;
        for (const [code, country] of Object.entries(this.countries)) {
            const capital = country.government?.capital;
            if (!capital?.coordinates) continue;

            const { lat, lon } = capital.coordinates;
            if (!lat || !lon) continue;

            const position = this.latLonToVector3(lat, lon, 100.8);

            const geometry = new THREE.SphereGeometry(0.6, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color: 0xff00ff,  // Bright magenta for capitals
                transparent: true,
                opacity: 1.0
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.copy(position);
            mesh.userData = { type: 'capital', country, capital: capital.name };

            this.meshes.capitals.push(mesh);
            this.globe.add(mesh);
            count++;
        }

        console.log(`Rendered ${count} capitals`);
    }

    latLonToVector3(lat, lon, radius) {
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lon + 180) * (Math.PI / 180);

        const x = -(radius * Math.sin(phi) * Math.cos(theta));
        const y = radius * Math.cos(phi);
        const z = radius * Math.sin(phi) * Math.sin(theta);

        return new THREE.Vector3(x, y, z);
    }

    setupEventListeners() {
        const canvas = document.getElementById('globe');
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        // Increase threshold for line detection
        raycaster.params.Line.threshold = 2;

        canvas.addEventListener('click', (event) => {
            const rect = canvas.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, this.camera);

            // Check all meshes (no regions now)
            const allMeshes = [
                ...this.meshes.countryBoundaries,
                ...this.meshes.airports,
                ...this.meshes.capitals
            ];

            const intersects = raycaster.intersectObjects(allMeshes);

            if (intersects.length > 0) {
                const object = intersects[0].object;
                this.handleClick(object);
            } else {
                // Check if clicking on the ocean (globe itself)
                const globeIntersects = raycaster.intersectObject(this.globe);
                if (globeIntersects.length > 0) {
                    this.clearSelection();
                }
            }
        });
    }

    highlightObject(object) {
        // Clear previous selection
        if (this.selectedObject) {
            // Restore original color and opacity
            this.selectedObject.material.color.setHex(0x2a4a5a);  // Dark blue-gray
            this.selectedObject.material.opacity = 0.4;
        }

        // Highlight new selection
        if (object) {
            this.selectedObject = object;
            // Highlight with yellow and make more opaque
            object.material.color.setHex(0xffff00);  // Yellow
            object.material.opacity = 0.6;
        }
    }

    clearSelection() {
        // Clear highlighted object
        if (this.selectedObject) {
            this.selectedObject.material.color.setHex(0x2a4a5a);  // Dark blue-gray
            this.selectedObject.material.opacity = 0.4;
            this.selectedObject = null;
        }

        // Hide info panel
        const panel = document.getElementById('infoPanel');
        panel.classList.remove('visible');
    }

    handleClick(object) {
        const userData = object.userData;

        // Highlight the clicked boundary
        if (userData.type === 'country-boundary' || userData.type === 'region-boundary') {
            this.highlightObject(object);
        }

        if (userData.type === 'country-boundary') {
            const iso = (userData.properties.iso_a2 || '').replace(/\x00/g, '').trim();
            if (iso && this.countries[iso]) {
                this.showCountryInfo(iso);
            }
        } else if (userData.type === 'region-boundary') {
            const iso = (userData.properties.iso_a2 || '').replace(/\x00/g, '').trim();
            const regionCode = (userData.properties.iso_3166_2 || '').replace(/\x00/g, '').trim();
            const regionName = (userData.properties.name || '').replace(/\x00/g, '').trim();
            console.log(`Clicked region: ${regionCode} (${regionName})`);
            // Try to show parent country info with region highlighted
            if (iso && this.countries[iso]) {
                this.showCountryInfo(iso, null, regionName);
            }
        } else if (userData.type === 'airport') {
            this.showAirportInfo(userData.airport);
        } else if (userData.type === 'capital') {
            this.showCountryInfo(userData.country.code, userData.capital);
        }
    }

    showCountryInfo(isoCode, highlightCapital = null, highlightRegion = null) {
        const country = this.countries[isoCode];
        if (!country) return;

        const panel = document.getElementById('infoPanel');

        // Helper to format numbers
        const fmt = (num) => num ? num.toLocaleString() : 'N/A';

        // Population
        const pop = country.people?.population?.total;
        const popStr = fmt(pop);
        const medianAge = country.people?.median_age || null;

        // Capital
        const capitalName = country.government?.capital?.name || 'N/A';
        const capitalStyle = highlightCapital ? 'background: rgba(255, 0, 255, 0.3); padding: 2px 6px; border-radius: 4px; font-weight: bold;' : '';

        // Area
        const area = country.geography?.area;
        const totalArea = area?.total_sq_km ? `${fmt(area.total_sq_km)} km²` : 'N/A';
        const landArea = area?.land_sq_km ? `${fmt(area.land_sq_km)} km²` : null;

        // Terrain and elevation
        const terrain = country.geography?.terrain || 'N/A';
        const naturalHazards = country.geography?.natural_hazards || null;
        const environmentIssues = country.geography?.environment_issues || null;
        const elevation = country.geography?.elevation;

        // Elevation data is just text strings, not structured objects
        const highPoint = elevation?.highest_point || null;
        const lowPoint = elevation?.lowest_point || null;

        // Economy
        const gdp = country.economy?.gdp?.value ? `$${fmt(country.economy.gdp.value)}` : null;
        const gdpPerCapita = country.economy?.gdp_per_capita?.value ? `$${fmt(country.economy.gdp_per_capita.value)}` : null;
        const currency = country.economy?.currency?.name || null;

        // Religions
        const religions = country.people?.religions || null;
        const nationality = country.people?.nationality || null;

        // Regions section
        let regionsHTML = '';
        if (country.regions && country.regions.length > 0) {
            regionsHTML = `
                <div class="section">
                    <div class="section-title">Subdivisions (${country.regions.length})</div>
                    <div class="regions-grid">
                        ${country.regions.map(r => `
                            <div class="region-chip">
                                <span>${r.flag}</span>
                                <span>${r.name}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Airports section
        let airportsHTML = '';
        if (country.airports && country.airports.length > 0) {
            airportsHTML = `
                <div class="section">
                    <div class="section-title">Major Airports (${country.airports.length})</div>
                    <div class="airports-list">
                        ${country.airports.map(a => `
                            <div class="airport-chip" title="${a.name}">${a.iata}</div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        panel.innerHTML = `
            <div class="country-header">
                <div class="country-flag">${country.flag}</div>
                <div class="country-name">
                    <h2>${country.name}</h2>
                    <div class="country-code">${country.code} • ${country.iso_a3}</div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Geography</div>
                <div class="data-row">
                    <div class="data-label">Continent</div>
                    <div class="data-value">${country.geography?.continent || 'N/A'}</div>
                </div>
                <div class="data-row">
                    <div class="data-label">Region</div>
                    <div class="data-value">${country.geography?.region || 'N/A'}</div>
                </div>
                <div class="data-row">
                    <div class="data-label">Subregion</div>
                    <div class="data-value">${country.geography?.subregion || 'N/A'}</div>
                </div>
                <div class="data-row">
                    <div class="data-label">Total Area</div>
                    <div class="data-value">${totalArea}</div>
                </div>
                ${landArea ? `<div class="data-row">
                    <div class="data-label">Land Area</div>
                    <div class="data-value">${landArea}</div>
                </div>` : ''}
                <div class="data-row vertical">
                    <div class="data-label">Climate</div>
                    <div class="data-value">${country.geography?.climate || 'N/A'}</div>
                </div>
                <div class="data-row vertical">
                    <div class="data-label">Terrain</div>
                    <div class="data-value">${terrain}</div>
                </div>
                ${highPoint ? `<div class="data-row">
                    <div class="data-label">Highest Point</div>
                    <div class="data-value">${highPoint}</div>
                </div>` : ''}
                ${lowPoint ? `<div class="data-row">
                    <div class="data-label">Lowest Point</div>
                    <div class="data-value">${lowPoint}</div>
                </div>` : ''}
                ${naturalHazards ? `<div class="data-row vertical">
                    <div class="data-label">Natural Hazards</div>
                    <div class="data-value">${naturalHazards}</div>
                </div>` : ''}
                ${environmentIssues ? `<div class="data-row vertical">
                    <div class="data-label">Environment Issues</div>
                    <div class="data-value">${environmentIssues}</div>
                </div>` : ''}
            </div>

            <div class="section">
                <div class="section-title">People & Society</div>
                <div class="data-row">
                    <div class="data-label">Population</div>
                    <div class="data-value">${popStr}</div>
                </div>
                ${medianAge ? `<div class="data-row">
                    <div class="data-label">Median Age</div>
                    <div class="data-value">${medianAge} years</div>
                </div>` : ''}
                ${nationality ? `<div class="data-row">
                    <div class="data-label">Nationality</div>
                    <div class="data-value">${nationality}</div>
                </div>` : ''}
                <div class="data-row">
                    <div class="data-label">Languages</div>
                    <div class="data-value">${country.people?.languages || 'N/A'}</div>
                </div>
                ${religions ? `<div class="data-row">
                    <div class="data-label">Religions</div>
                    <div class="data-value">${religions}</div>
                </div>` : ''}
            </div>

            <div class="section">
                <div class="section-title">Government</div>
                <div class="data-row">
                    <div class="data-label">Capital</div>
                    <div class="data-value"><span style="${capitalStyle}">${capitalName}</span></div>
                </div>
                <div class="data-row">
                    <div class="data-label">Type</div>
                    <div class="data-value">${country.government?.government_type || 'N/A'}</div>
                </div>
                ${country.government?.administrative_divisions ? `<div class="data-row vertical">
                    <div class="data-label">Divisions</div>
                    <div class="data-value">${country.government.administrative_divisions}</div>
                </div>` : ''}
            </div>

            ${gdp || gdpPerCapita || currency ? `
            <div class="section">
                <div class="section-title">Economy</div>
                ${gdp ? `<div class="data-row">
                    <div class="data-label">GDP</div>
                    <div class="data-value">${gdp}</div>
                </div>` : ''}
                ${gdpPerCapita ? `<div class="data-row">
                    <div class="data-label">GDP per Capita</div>
                    <div class="data-value">${gdpPerCapita}</div>
                </div>` : ''}
                ${currency ? `<div class="data-row">
                    <div class="data-label">Currency</div>
                    <div class="data-value">${currency}</div>
                </div>` : ''}
            </div>` : ''}

            ${regionsHTML}
            ${airportsHTML}
        `;

        panel.classList.add('visible');
    }

    showAirportInfo(airport) {
        const panel = document.getElementById('infoPanel');

        panel.innerHTML = `
            <div class="country-header">
                <div class="country-flag">✈️</div>
                <div class="country-name">
                    <h2>${airport.name}</h2>
                    <div class="country-code">${airport.iata} • ${airport.icao}</div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Location</div>
                <div class="data-row">
                    <div class="data-label">City</div>
                    <div class="data-value">${airport.city || 'N/A'}</div>
                </div>
                <div class="data-row">
                    <div class="data-label">Country</div>
                    <div class="data-value">${airport.country || 'N/A'}</div>
                </div>
                <div class="data-row">
                    <div class="data-label">Coordinates</div>
                    <div class="data-value">${airport.lat.toFixed(4)}, ${airport.lon.toFixed(4)}</div>
                </div>
                <div class="data-row">
                    <div class="data-label">Elevation</div>
                    <div class="data-value">${airport.elevation ? airport.elevation + ' m' : 'N/A'}</div>
                </div>
            </div>
        `;

        panel.classList.add('visible');
    }

    updateStats() {
        const countryCount = Object.keys(this.countries).length;
        const airportCount = Object.keys(this.airports).length;
        const regionCount = Object.values(this.countries).reduce((sum, c) => sum + (c.regions?.length || 0), 0);
        const population = Object.values(this.countries).reduce((sum, c) => {
            const pop = c.people?.population?.total;
            return sum + (pop || 0);
        }, 0);

        document.getElementById('countryCount').textContent = countryCount.toLocaleString();
        document.getElementById('airportCount').textContent = airportCount.toLocaleString();
        document.getElementById('regionCount').textContent = regionCount.toLocaleString();
        document.getElementById('populationCount').textContent = (population / 1e9).toFixed(1) + 'B';
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        if (this.settings.autoRotate) {
            this.globe.rotation.y += 0.001;
        }

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

// Control functions
function toggleBoundaries() {
    const btn = document.getElementById('toggleBoundaries');
    viewer.settings.showCountryBoundaries = !viewer.settings.showCountryBoundaries;
    viewer.settings.showRegionBoundaries = viewer.settings.showCountryBoundaries;

    viewer.meshes.countryBoundaries.forEach(mesh => {
        mesh.visible = viewer.settings.showCountryBoundaries;
    });
    viewer.meshes.regionBoundaries.forEach(mesh => {
        mesh.visible = viewer.settings.showRegionBoundaries;
    });

    btn.classList.toggle('active');
}

function toggleAirports() {
    const btn = document.getElementById('toggleAirports');
    viewer.settings.showAirports = !viewer.settings.showAirports;
    viewer.settings.showCapitals = viewer.settings.showAirports;

    viewer.meshes.airports.forEach(mesh => {
        mesh.visible = viewer.settings.showAirports;
    });
    viewer.meshes.capitals.forEach(mesh => {
        mesh.visible = viewer.settings.showCapitals;
    });

    btn.classList.toggle('active');
}

function toggleRotation() {
    const btn = document.getElementById('toggleRotation');
    viewer.settings.autoRotate = !viewer.settings.autoRotate;
    btn.classList.toggle('active');
}

async function loadAllAirports() {
    const btn = document.getElementById('loadAllAirports');

    // If already loaded, just toggle visibility
    if (viewer.allAirportsLoaded) {
        viewer.settings.showAllAirports = !viewer.settings.showAllAirports;
        viewer.meshes.allAirports.forEach(mesh => {
            mesh.visible = viewer.settings.showAllAirports;
        });
        btn.classList.toggle('active');
        return;
    }

    // Show loading state
    btn.textContent = '⏳ Loading...';
    btn.disabled = true;

    try {
        // Fetch full airport dataset
        console.log('Loading additional airports (non-IATA airports)...');
        const response = await fetch('resources/airports_all.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const allAirports = data.airports || {};

        console.log(`Loaded ${Object.keys(allAirports).length} total airports from dataset`);

        // Filter to ONLY airports WITHOUT IATA codes (to add on top of existing IATA airports)
        const nonIataAirports = Object.entries(allAirports).filter(([icao, airport]) => !airport.iata);

        console.log(`Filtering to ${nonIataAirports.length} non-IATA airports (military, private, heliports, etc.)`);

        // Render ONLY non-IATA airports (gray dots)
        let count = 0;
        const additionalAirportMeshes = [];

        for (const [icao, airport] of nonIataAirports) {
            if (!airport.lat || !airport.lon) continue;

            const position = viewer.latLonToVector3(airport.lat, airport.lon, 100.5);

            const geometry = new THREE.SphereGeometry(0.3, 8, 8);  // Slightly smaller
            const material = new THREE.MeshBasicMaterial({
                color: 0x888888,  // Gray for non-commercial
                transparent: true,
                opacity: 0.3  // More transparent
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.copy(position);
            mesh.userData = { type: 'airport', airport };

            additionalAirportMeshes.push(mesh);
            viewer.globe.add(mesh);
            count++;
        }

        viewer.meshes.allAirports = additionalAirportMeshes;
        viewer.allAirportsLoaded = true;
        viewer.settings.showAllAirports = true;

        // Update button
        btn.textContent = `✈️ +${count.toLocaleString()} Airports`;
        btn.disabled = false;
        btn.classList.add('active');

        console.log(`✓ Rendered ${count} additional non-IATA airports`);

    } catch (error) {
        console.error('Failed to load additional airports:', error);
        btn.textContent = '❌ Load Failed';
        btn.disabled = false;
        setTimeout(() => {
            btn.textContent = '✈️ +21K Airports';
        }, 3000);
    }
}

// Initialize
let viewer;
window.addEventListener('DOMContentLoaded', () => {
    viewer = new GlobeViewer();
    window.viewer = viewer;
});
