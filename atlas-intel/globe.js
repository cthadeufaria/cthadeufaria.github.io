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

        this.meshes = {
            graticule: [],
            countryAreas: [],
            countryBoundaries: [],
            airports: [],
            capitals: [],
            allAirports: []  // For full 29K airport dataset
        };

        this.settings = {
            showCountryBoundaries: true,
            showAirports: true,
            showCapitals: true,
            showAllAirports: false,
            autoRotate: true
        };

        this.allAirportsLoaded = false;  // Track if full airport dataset has been loaded
        this.selectedObject = null;  // Track selected country
        this.selectedObjects = [];  // Track all highlighted boundary segments for a selected country
        this.markerTextures = {};
        this.lastUserInteractionAt = 0;
        this.cameraDistance = 360;
        this.minCameraDistance = 280;
        this.maxCameraDistance = 430;
        this._worldPosition = new THREE.Vector3();
        this._globeCenter = new THREE.Vector3();
        this._cameraDirection = new THREE.Vector3();
        this._pointDirection = new THREE.Vector3();

        this.theme = {
            paper: 0xe8e6dc,
            globe: 0xded8c9,
            globeEmissive: 0xcfc7b8,
            ink: 0x141413,
            mutedInk: 0x3d3d3a,
            graticule: 0x5e5d59,
            boundary: 0x3d3d3a,
            highlight: 0xd97757,
            airport: 0x6396d6,
            capital: 0x6ea100,
            otherAirport: 0x87867f
        };

        // IndexedDB for caching
        this.dbName = 'GlobeDataCache';
        this.dbVersion = 7;  // Refresh cached country data and globe styling
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

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.theme.paper);

        this.camera = new THREE.PerspectiveCamera(
            32,
            container.clientWidth / container.clientHeight,
            0.1,
            1000
        );
        this.camera.position.z = this.cameraDistance;

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: false
        });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.06;
        this.controls.rotateSpeed = 0.28;
        this.controls.enableZoom = false;
        this.controls.enablePan = false;  // Disable panning for cleaner interaction
        this.controls.target.set(0, 0, 0);
        this.controls.update();

        this.controls.addEventListener('start', () => {
            canvas.classList.add('is-dragging');
            this.lastUserInteractionAt = Date.now();
        });
        this.controls.addEventListener('end', () => {
            canvas.classList.remove('is-dragging');
            this.lastUserInteractionAt = Date.now();
        });

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.72);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.45);
        directionalLight.position.set(-4, 3, 7);
        this.scene.add(directionalLight);

        this.applyResponsiveCamera();

        // Handle resize
        window.addEventListener('resize', () => {
            const container = document.getElementById('container');
            this.camera.aspect = container.clientWidth / container.clientHeight;
            this.applyResponsiveCamera();
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(container.clientWidth, container.clientHeight);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        });
    }

    applyResponsiveCamera() {
        const container = document.getElementById('container');
        const isNarrow = container.clientWidth < 820;
        const distance = Math.max(
            this.minCameraDistance,
            Math.min(this.maxCameraDistance, isNarrow ? 410 : this.cameraDistance)
        );

        this.setCameraDistance(distance, false);
        this.camera.fov = isNarrow ? 36 : 32;
        this.camera.updateProjectionMatrix();
    }

    setCameraDistance(distance, markInteraction = true) {
        const clamped = Math.max(this.minCameraDistance, Math.min(this.maxCameraDistance, distance));
        const direction = this.camera.position.clone().sub(this.controls?.target || new THREE.Vector3()).normalize();
        if (direction.lengthSq() === 0) {
            direction.set(0, 0, 1);
        }

        this.cameraDistance = clamped;
        this.camera.position.copy(direction.multiplyScalar(clamped));
        if (this.controls) {
            this.controls.update();
        }
        if (markInteraction) {
            this.lastUserInteractionAt = Date.now();
        }
    }

    createGlobe() {
        // Globe sphere
        const geometry = new THREE.SphereGeometry(100, 64, 64);
        const material = new THREE.MeshPhongMaterial({
            color: this.theme.globe,
            emissive: this.theme.globeEmissive,
            specular: 0xffffff,
            shininess: 2,
            transparent: false,
            opacity: 1,
            depthTest: true,
            depthWrite: true
        });

        this.globe = new THREE.Mesh(geometry, material);
        this.scene.add(this.globe);
        this.renderGraticule();

        // Add atmosphere glow
        const glowGeometry = new THREE.SphereGeometry(102.2, 64, 64);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: this.theme.ink,
            transparent: true,
            opacity: 0.045,
            side: THREE.BackSide
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        this.scene.add(glow);
    }

    renderGraticule() {
        const material = new THREE.LineBasicMaterial({
            color: this.theme.graticule,
            transparent: true,
            opacity: 0.18,
            linewidth: 1,
            depthTest: true,
            depthWrite: false
        });

        for (let lat = -75; lat <= 75; lat += 15) {
            const points = [];
            for (let lon = -180; lon <= 180; lon += 2) {
                points.push(this.latLonToVector3(lat, lon, 100.42));
            }
            this.addGraticuleLine(points, material);
        }

        for (let lon = -180; lon < 180; lon += 15) {
            const points = [];
            for (let lat = -90; lat <= 90; lat += 2) {
                points.push(this.latLonToVector3(lat, lon, 100.42));
            }
            this.addGraticuleLine(points, material);
        }
    }

    addGraticuleLine(points, material) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, material);
        line.userData = { type: 'graticule' };
        line.renderOrder = 1;
        this.meshes.graticule.push(line);
        this.globe.add(line);
    }

    updateLoadingProgress(message, progress) {
        const loadingDiv = document.getElementById('loading');
        const loadingText = loadingDiv.querySelector('div:last-child');
        const spinner = loadingDiv.querySelector('.spinner');

        if (loadingText) {
            loadingText.innerHTML = `
                <div style="margin-bottom: 8px;">${message}</div>
                <div style="font-size: 12px; opacity: 0.7;">
                    <div style="background: rgba(20,20,19,0.08); height: 4px; border-radius: 2px; overflow: hidden; margin-top: 8px;">
                        <div style="background: #d97757; height: 100%; width: ${progress}%; transition: width 0.3s;"></div>
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

            this.updateLoadingProgress('Loading globe resources...', 10);
            const [countriesData, boundariesData, airportsData] = await Promise.all([
                this.fetchWithCache('resources/countries.v2.json'),
                this.fetchWithCache('resources/countries_50m.geojson'),
                this.fetchWithCache('resources/airports_iata.json')
            ]);

            this.countries = countriesData.entities || countriesData.countries || countriesData;
            this.boundaries = boundariesData;
            this.airports = airportsData.airports || airportsData;

            console.log(`✅ Loaded ${Object.keys(this.countries).length} countries`);
            console.log(`✅ Loaded ${this.boundaries.features.length} country boundaries`);
            console.log(`✅ Loaded ${Object.keys(this.airports).length} airports`);

            this.updateLoadingProgress('Rendering globe data...', 72);
            this.renderCountryAreas();
            this.renderCountryBoundaries();
            this.renderCapitals();
            this.renderAirports();

            // Update stats
            this.updateStats();

            // Hide loading screen
            this.updateLoadingProgress('Complete!', 100);
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

    renderCountryAreas() {
        console.log('Rendering country hit areas...');

        if (typeof earcut !== 'function') {
            console.warn('Country area selection unavailable: earcut not loaded');
            return;
        }

        const areaMaterial = new THREE.MeshBasicMaterial({
            color: this.theme.highlight,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false
        });
        areaMaterial.colorWrite = false;

        for (const feature of this.boundaries.features) {
            if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
                continue;
            }

            const coordinates = feature.geometry.type === 'Polygon'
                ? [feature.geometry.coordinates]
                : feature.geometry.coordinates;

            for (const polygon of coordinates) {
                const area = this.createCountryAreaMesh(polygon, feature.properties, areaMaterial);
                if (!area) continue;

                this.meshes.countryAreas.push(area);
                this.globe.add(area);
            }
        }

        console.log(`Rendered ${this.meshes.countryAreas.length} country hit areas`);
    }

    createCountryAreaMesh(polygon, properties, material) {
        const rings = this.prepareCountryAreaRings(polygon);
        if (rings.length === 0) return null;

        const flatCoordinates = [];
        const holes = [];
        const vertices = [];

        rings.forEach((ring, ringIndex) => {
            if (ringIndex > 0) {
                holes.push(flatCoordinates.length / 2);
            }

            for (const point of ring) {
                flatCoordinates.push(point.lon, point.lat);
                vertices.push(this.latLonToVector3(point.lat, point.lon, 100.34));
            }
        });

        const triangles = earcut(flatCoordinates, holes, 2);
        if (triangles.length < 3) return null;

        const positions = new Float32Array(vertices.length * 3);
        vertices.forEach((vertex, index) => {
            positions[index * 3] = vertex.x;
            positions[index * 3 + 1] = vertex.y;
            positions[index * 3 + 2] = vertex.z;
        });

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(triangles);
        geometry.computeBoundingSphere();

        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = {
            type: 'country-area',
            properties
        };
        mesh.renderOrder = 0;
        return mesh;
    }

    prepareCountryAreaRings(polygon) {
        if (!Array.isArray(polygon) || polygon.length === 0) return [];

        const outerRing = this.unwrapCountryRing(polygon[0]);
        if (outerRing.length < 3) return [];

        const outerLongitude = this.averageRingLongitude(outerRing);
        const rings = [outerRing];

        for (const ring of polygon.slice(1)) {
            const holeRing = this.unwrapCountryRing(ring);
            if (holeRing.length < 3) continue;

            const holeLongitude = this.averageRingLongitude(holeRing);
            const longitudeShift = Math.round((outerLongitude - holeLongitude) / 360) * 360;
            rings.push(holeRing.map(point => ({
                lat: point.lat,
                lon: point.lon + longitudeShift
            })));
        }

        return rings;
    }

    unwrapCountryRing(ring) {
        if (!Array.isArray(ring)) return [];

        const points = ring
            .map(([lonValue, latValue]) => ({
                lat: Number(latValue),
                lon: Number(lonValue)
            }))
            .filter(point => (
                Number.isFinite(point.lat)
                && Number.isFinite(point.lon)
                && point.lat >= -90
                && point.lat <= 90
            ));

        if (points.length > 1) {
            const first = points[0];
            const last = points[points.length - 1];
            if (first.lat === last.lat && first.lon === last.lon) {
                points.pop();
            }
        }

        if (points.length < 3) return [];

        const unwrapped = [{ ...points[0] }];
        let previousLon = points[0].lon;

        for (const point of points.slice(1)) {
            let lon = point.lon;
            while (lon - previousLon > 180) lon -= 360;
            while (lon - previousLon < -180) lon += 360;

            unwrapped.push({
                lat: point.lat,
                lon
            });
            previousLon = lon;
        }

        return unwrapped;
    }

    averageRingLongitude(ring) {
        return ring.reduce((sum, point) => sum + point.lon, 0) / ring.length;
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

                // Screen-space WebGL lines stay visually stable as the camera zooms.
                const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
                const lineMaterial = new THREE.LineBasicMaterial({
                    color: this.theme.boundary,
                    transparent: true,
                    opacity: 0.42,
                    linewidth: 1,
                    depthTest: true,
                    depthWrite: false
                });

                const line = new THREE.Line(lineGeometry, lineMaterial);
                line.userData = {
                    type: 'country-boundary',
                    properties: feature.properties,
                    originalColor: this.theme.boundary,
                    originalOpacity: 0.42
                };
                line.renderOrder = 2;
                this.meshes.countryBoundaries.push(line);
                this.globe.add(line);
            }
        }

        console.log(`Rendered ${this.meshes.countryBoundaries.length} country boundary lines`);
    }

    normalizeLatLon(latValue, lonValue) {
        const lat = Number(latValue);
        const lon = Number(lonValue);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
        if (lat === 0 && lon === 0) return null;

        return { lat, lon };
    }

    isValidCoordinatePair(coordinates) {
        if (!coordinates || typeof coordinates !== 'object') return null;
        return this.normalizeLatLon(coordinates.lat, coordinates.lon);
    }

    createMarkerTexture(colorHex, strokeHex = this.theme.paper) {
        const key = `${colorHex}:${strokeHex}`;
        if (this.markerTextures[key]) return this.markerTextures[key];

        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const context = canvas.getContext('2d');
        const radius = 22;

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.beginPath();
        context.arc(32, 32, radius, 0, Math.PI * 2);
        context.fillStyle = `#${colorHex.toString(16).padStart(6, '0')}`;
        context.fill();
        context.lineWidth = 7;
        context.strokeStyle = `#${strokeHex.toString(16).padStart(6, '0')}`;
        context.stroke();

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        this.markerTextures[key] = texture;
        return texture;
    }

    createMarkerSprite(position, colorHex, pixelSize, opacity, userData) {
        const material = new THREE.SpriteMaterial({
            map: this.createMarkerTexture(colorHex),
            color: 0xffffff,
            transparent: true,
            opacity,
            depthTest: true,
            depthWrite: false,
            sizeAttenuation: true
        });

        const sprite = new THREE.Sprite(material);
        sprite.position.copy(position);
        sprite.scale.set(pixelSize, pixelSize, 1);
        sprite.userData = {
            ...userData,
            baseOpacity: opacity,
            originalOpacity: opacity,
            baseVisible: true,
            pixelSize
        };
        sprite.renderOrder = 3;
        return sprite;
    }

    renderAirports() {
        console.log('Rendering airports...');

        let count = 0;
        for (const [icao, airport] of Object.entries(this.airports)) {
            const coordinates = this.normalizeLatLon(airport.lat, airport.lon);
            if (!coordinates) continue;

            const position = this.latLonToVector3(coordinates.lat, coordinates.lon, 100.5);
            const mesh = this.createMarkerSprite(position, this.theme.airport, 4.5, 0.78, { type: 'airport', airport });

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

            const coordinates = this.isValidCoordinatePair(capital.coordinates);
            if (!coordinates) continue;

            const position = this.latLonToVector3(coordinates.lat, coordinates.lon, 100.8);
            const mesh = this.createMarkerSprite(position, this.theme.capital, 6.5, 0.96, {
                type: 'capital',
                country,
                capital: capital.name
            });

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
            const globeIntersects = raycaster.intersectObject(this.globe, false);
            const nearestGlobeDistance = globeIntersects.length > 0 ? globeIntersects[0].distance : Infinity;

            const markerHit = globeIntersects.length > 0 ? this.findMarkerHit(event.clientX, event.clientY) : null;
            if (markerHit) {
                this.handleClick(markerHit);
                return;
            }

            const areaIntersects = raycaster.intersectObjects(this.meshes.countryAreas);
            const areaHit = areaIntersects.find(hit => (
                this.isSelectableIntersection(hit, nearestGlobeDistance, { allowBehindSurface: true })
            ));
            if (areaHit) {
                this.handleClick(areaHit.object);
                return;
            }

            const boundaryIntersects = raycaster.intersectObjects(this.meshes.countryBoundaries);
            const boundaryHit = boundaryIntersects.find(hit => this.isSelectableIntersection(hit, nearestGlobeDistance));

            if (boundaryHit) {
                this.handleClick(boundaryHit.object);
            } else {
                // Check if clicking on the ocean (globe itself)
                if (globeIntersects.length > 0) {
                    this.clearSelection();
                }
            }
        });
    }

    findMarkerHit(clientX, clientY) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const markerGroups = [
            { markers: this.meshes.capitals, priority: 0 },
            { markers: this.meshes.airports, priority: 1 },
            { markers: this.meshes.allAirports, priority: 2 }
        ];
        const hits = [];

        for (const group of markerGroups) {
            for (const marker of group.markers) {
                if (!marker.visible || marker.userData.baseVisible === false) continue;

                marker.getWorldPosition(this._worldPosition);
                if (!this.isFrontHemispherePoint(this._worldPosition)) continue;

                const projected = this._worldPosition.clone().project(this.camera);
                if (projected.z < -1 || projected.z > 1) continue;

                const screenX = rect.left + ((projected.x + 1) * rect.width / 2);
                const screenY = rect.top + ((-projected.y + 1) * rect.height / 2);
                const radius = Math.max(6, (marker.userData.pixelSize || 5) * 1.45);
                const screenDistance = Math.hypot(clientX - screenX, clientY - screenY);

                if (screenDistance <= radius) {
                    hits.push({ marker, screenDistance, priority: group.priority });
                }
            }
        }

        hits.sort((a, b) => a.screenDistance - b.screenDistance || a.priority - b.priority);
        return hits[0]?.marker || null;
    }

    isSelectableIntersection(intersection, nearestGlobeDistance, options = {}) {
        if (!intersection.object.visible) return false;

        if (!options.allowBehindSurface && intersection.distance > nearestGlobeDistance + 0.75) {
            return false;
        }

        return this.isFrontHemispherePoint(intersection.point);
    }

    isFrontHemispherePoint(worldPoint) {
        if (!worldPoint) return false;

        const globeCenter = new THREE.Vector3();
        this.globe.getWorldPosition(globeCenter);

        const cameraDirection = this.camera.position.clone().sub(globeCenter).normalize();
        const pointDirection = worldPoint.clone().sub(globeCenter).normalize();

        return cameraDirection.dot(pointDirection) >= -0.02;
    }

    getFeatureIso(properties) {
        return String(properties?.iso_a2 || '').replace(/\x00/g, '').trim().toUpperCase();
    }

    restoreSelectedBoundaries() {
        for (const object of this.selectedObjects) {
            object.material.color.setHex(object.userData.originalColor || this.theme.boundary);
            object.material.opacity = object.userData.originalOpacity ?? 0.9;
        }

        this.selectedObjects = [];
        this.selectedObject = null;
    }

    highlightCountryBoundaries(isoCode) {
        this.restoreSelectedBoundaries();

        this.selectedObjects = this.meshes.countryBoundaries.filter(object => (
            this.getFeatureIso(object.userData.properties) === isoCode
        ));

        for (const object of this.selectedObjects) {
            object.material.color.setHex(this.theme.highlight);
            object.material.opacity = 1.0;
        }

        this.selectedObject = this.selectedObjects[0] || null;
    }

    selectCountryFromProperties(properties) {
        const iso = this.getFeatureIso(properties);
        if (!iso || !this.countries[iso]) return false;

        this.highlightCountryBoundaries(iso);
        this.showCountryInfo(iso);
        return true;
    }

    clearSelection() {
        // Clear highlighted object
        this.restoreSelectedBoundaries();

        // Hide info panel
        const panel = document.getElementById('infoPanel');
        panel.classList.remove('visible');
        document.body.classList.remove('info-open');
    }

    escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    isWhiteFlag(flag) {
        return !flag || flag === '\u{1F3F3}\uFE0F' || flag === '🏳️';
    }

    getFlagAssetUrl(country) {
        if (country.flag_asset?.svg_url) {
            return country.flag_asset.svg_url;
        }

        const code = String(country.code || '').trim().toLowerCase();
        if (/^[a-z]{2}$/.test(code)) {
            return `https://flagcdn.com/${code}.svg`;
        }

        return null;
    }

    renderCountryFlag(country) {
        const code = String(country.code || '').trim().toUpperCase();
        const emoji = this.isWhiteFlag(country.flag) ? '' : country.flag;
        const fallbackText = emoji || code || '?';
        const escapedFallback = this.escapeHtml(fallbackText);
        const assetUrl = this.getFlagAssetUrl(country);

        if (assetUrl) {
            const escapedName = this.escapeHtml(country.name || code || 'Country');
            const escapedUrl = this.escapeHtml(assetUrl);
            return `
                <img class="country-flag-svg" src="${escapedUrl}" alt="${escapedName} flag" loading="lazy" decoding="async"
                    onerror="this.hidden=true;this.nextElementSibling.hidden=false">
                <span class="country-flag-fallback" hidden>${escapedFallback}</span>
            `;
        }

        if (emoji) {
            return escapedFallback;
        }

        return `<span class="country-flag-code">${this.escapeHtml(code || 'N/A')}</span>`;
    }

    handleClick(object) {
        const userData = object.userData;

        if (userData.type === 'country-boundary' || userData.type === 'country-area') {
            this.selectCountryFromProperties(userData.properties);
        } else if (userData.type === 'airport') {
            this.showAirportInfo(userData.airport);
        } else if (userData.type === 'capital') {
            this.showCountryInfo(userData.country.code, userData.capital);
        }
    }

    showCountryInfo(isoCode, highlightCapital = null) {
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
        const capitalStyle = highlightCapital ? 'background: rgba(110, 161, 0, 0.16); padding: 2px 6px; border-radius: 4px; font-weight: bold;' : '';

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
        const gdpValue = typeof country.economy?.gdp === 'object' ? country.economy.gdp?.value : country.economy?.gdp;
        const gdpPerCapitaValue = typeof country.economy?.gdp_per_capita === 'object' ? country.economy.gdp_per_capita?.value : country.economy?.gdp_per_capita;
        const currency = typeof country.economy?.currency === 'object' ? country.economy.currency?.name : country.economy?.currency;
        const gdp = gdpValue ? `$${fmt(gdpValue)}` : null;
        const gdpPerCapita = gdpPerCapitaValue ? `$${fmt(gdpPerCapitaValue)}` : null;

        // Religions
        const religions = country.people?.religions || null;
        const nationality = country.people?.nationality || null;
        const countryFlagHTML = this.renderCountryFlag(country);

        // Airports section
        let airportsHTML = '';
        const majorAirports = country.infrastructure?.major_airports || country.airports || [];
        if (majorAirports.length > 0) {
            airportsHTML = `
                <div class="section">
                    <div class="section-title">Major Airports (${majorAirports.length})</div>
                    <div class="airports-list">
                        ${majorAirports.map(a => `
                            <div class="airport-chip" title="${a.name}">${a.iata}</div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        panel.innerHTML = `
            <div class="country-header">
                <div class="country-flag">${countryFlagHTML}</div>
                <div class="country-name">
                    <h2>${country.name}</h2>
                    <div class="country-code">${country.code} • ${country.iso3 || country.iso_a3}</div>
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

            ${airportsHTML}
        `;

        panel.scrollTop = 0;
        panel.classList.add('visible');
        document.body.classList.add('info-open');
    }

    showAirportInfo(airport) {
        const panel = document.getElementById('infoPanel');

        panel.innerHTML = `
            <div class="country-header">
                <div class="country-flag airport-mark">AIR</div>
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

        panel.scrollTop = 0;
        panel.classList.add('visible');
        document.body.classList.add('info-open');
    }

    updateStats() {
        const countryCount = Object.keys(this.countries).length;
        const airportCount = Object.keys(this.airports).length;
        const population = Object.values(this.countries).reduce((sum, c) => {
            const pop = c.people?.population?.total;
            return sum + (pop || 0);
        }, 0);

        document.getElementById('countryCount').textContent = countryCount.toLocaleString();
        document.getElementById('airportCount').textContent = airportCount.toLocaleString();
        document.getElementById('populationCount').textContent = (population / 1e9).toFixed(1) + 'B';
    }

    updateMarkerVisibility() {
        if (!this.globe || !this.camera) return;

        this.globe.getWorldPosition(this._globeCenter);
        this._cameraDirection.copy(this.camera.position).sub(this._globeCenter).normalize();

        const markerGroups = [this.meshes.airports, this.meshes.capitals, this.meshes.allAirports];
        for (const group of markerGroups) {
            for (const marker of group) {
                if (marker.userData.baseVisible === false) {
                    marker.visible = false;
                    continue;
                }

                marker.getWorldPosition(this._worldPosition);
                this.updateMarkerScale(marker, this._worldPosition);

                this._pointDirection.copy(this._worldPosition).sub(this._globeCenter).normalize();
                const facing = this._cameraDirection.dot(this._pointDirection);
                const fade = Math.max(0, Math.min(1, (facing + 0.03) / 0.32));

                marker.material.opacity = (marker.userData.baseOpacity ?? 1) * fade;
                marker.visible = fade > 0.04;
            }
        }
    }

    updateMarkerScale(marker, worldPosition) {
        const viewportHeight = this.renderer?.domElement?.clientHeight || window.innerHeight || 1;
        const distance = this.camera.position.distanceTo(worldPosition);
        const fovRadians = THREE.MathUtils.degToRad(this.camera.fov);
        const visibleHeight = 2 * Math.tan(fovRadians / 2) * distance;
        const worldUnitsPerPixel = visibleHeight / viewportHeight;
        const scale = (marker.userData.pixelSize || 5) * worldUnitsPerPixel;

        marker.scale.set(scale, scale, 1);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const idleFor = Date.now() - this.lastUserInteractionAt;
        if (this.settings.autoRotate && idleFor > 1800) {
            this.globe.rotation.y += 0.00035;
        }

        this.controls.update();
        this.updateMarkerVisibility();
        this.renderer.render(this.scene, this.camera);
    }
}

// Control functions
function toggleBoundaries() {
    const btn = document.getElementById('toggleBoundaries');
    viewer.settings.showCountryBoundaries = !viewer.settings.showCountryBoundaries;

    viewer.meshes.countryBoundaries.forEach(mesh => {
        mesh.visible = viewer.settings.showCountryBoundaries;
    });

    btn.classList.toggle('active');
}

function toggleAirports() {
    const btn = document.getElementById('toggleAirports');
    viewer.settings.showAirports = !viewer.settings.showAirports;
    viewer.settings.showCapitals = viewer.settings.showAirports;

    viewer.meshes.airports.forEach(mesh => {
        mesh.userData.baseVisible = viewer.settings.showAirports;
        mesh.visible = viewer.settings.showAirports;
    });
    viewer.meshes.capitals.forEach(mesh => {
        mesh.userData.baseVisible = viewer.settings.showCapitals;
        mesh.visible = viewer.settings.showCapitals;
    });

    btn.classList.toggle('active');
}

function toggleRotation() {
    const btn = document.getElementById('toggleRotation');
    viewer.settings.autoRotate = !viewer.settings.autoRotate;
    viewer.lastUserInteractionAt = Date.now();
    btn.classList.toggle('active');
}

function zoomGlobe(direction) {
    const step = 35;
    viewer.setCameraDistance(viewer.cameraDistance + direction * step);
}

async function loadAllAirports() {
    const btn = document.getElementById('loadAllAirports');

    // If already loaded, just toggle visibility
    if (viewer.allAirportsLoaded) {
        viewer.settings.showAllAirports = !viewer.settings.showAllAirports;
        viewer.meshes.allAirports.forEach(mesh => {
            mesh.userData.baseVisible = viewer.settings.showAllAirports;
            mesh.visible = viewer.settings.showAllAirports;
        });
        btn.classList.toggle('active');
        return;
    }

    // Show loading state
    btn.textContent = 'Loading...';
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
            const coordinates = viewer.normalizeLatLon(airport.lat, airport.lon);
            if (!coordinates) continue;

            const position = viewer.latLonToVector3(coordinates.lat, coordinates.lon, 100.5);
            const mesh = viewer.createMarkerSprite(position, viewer.theme.otherAirport, 3.5, 0.32, { type: 'airport', airport });

            additionalAirportMeshes.push(mesh);
            viewer.globe.add(mesh);
            count++;
        }

        viewer.meshes.allAirports = additionalAirportMeshes;
        viewer.allAirportsLoaded = true;
        viewer.settings.showAllAirports = true;

        // Update button
        btn.textContent = `+${count.toLocaleString()} Airports`;
        btn.disabled = false;
        btn.classList.add('active');

        console.log(`✓ Rendered ${count} additional non-IATA airports`);

    } catch (error) {
        console.error('Failed to load additional airports:', error);
        btn.textContent = 'Load failed';
        btn.disabled = false;
        setTimeout(() => {
            btn.textContent = '+21K Airports';
        }, 3000);
    }
}

// Initialize
let viewer;
window.addEventListener('DOMContentLoaded', () => {
    viewer = new GlobeViewer();
    window.viewer = viewer;
});
