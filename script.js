
// ==========================================
// ACCESSROUTE AI - FRONTEND JAVASCRIPT
// ==========================================

// Backend address for testing on this computer
const BACKEND_URL = "http://127.0.0.1:5000";

let accessRouteMap = null;
let leafletLoading = null;


// ==========================================
// LOAD LEAFLET MAP
// ==========================================

function loadLeaflet() {
    if (window.L) {
        return Promise.resolve();
    }

    if (leafletLoading) {
        return leafletLoading;
    }

    leafletLoading = new Promise((resolve, reject) => {
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(css);

        const script = document.createElement("script");
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

        script.onload = resolve;

        script.onerror = () => {
            leafletLoading = null;
            reject(new Error("Map library could not load. Check your internet connection."));
        };

        document.head.appendChild(script);
    });

    return leafletLoading;
}


// ==========================================
// FIND ROUTE
// ==========================================

async function findRoute() {
    const start = document.getElementById("start").value.trim();
    const destination = document.getElementById("destination").value.trim();

    const resultBox = document.getElementById("route-result");

    if (!start || !destination) {
        resultBox.textContent =
            "Please enter both starting point and destination.";
        return;
    }

    const preferences = Array.from(
        document.querySelectorAll(".preferences input:checked")
    ).map(input => input.value);

    resultBox.textContent = "Finding your routes. Please wait...";

    try {
        const response = await fetch(`${BACKEND_URL}/api/route`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                start: start,
                destination: destination,
                preferences: preferences
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Route search failed.");
        }

        if (!Array.isArray(data.routes) || data.routes.length === 0) {
            throw new Error("No routes found. Try different locations.");
        }

        // Show route details
        displayRouteResults(data);

        // Load and display map
        await loadLeaflet();
        displayMap(data.routes);

    } catch (error) {
        console.error("Route error:", error);

        resultBox.textContent =
            "Error: " + error.message +
            ". Check that the backend is running and try again.";
    }
}


// ==========================================
// DISPLAY ROUTE DETAILS
// ==========================================

function displayRouteResults(data) {
    const resultBox = document.getElementById("route-result");

    const recommendations = data.recommendations || {};

    let html = `
        <h2>Route Results</h2>

        <p><strong>From:</strong> ${escapeHTML(data.start)}</p>

        <p><strong>To:</strong> ${escapeHTML(data.destination)}</p>

        <p><strong>Transport:</strong>
            ${escapeHTML(data.transport_mode || "Driving")}
        </p>

        <h3>Route Recommendations</h3>

        <ul>
            <li>Shortest route:
                Route ${recommendations.shortest_route ?? "Not available"}
            </li>

            <li>Fastest route:
                Route ${recommendations.fastest_route ?? "Not available"}
            </li>

            <li>Fewest reported barriers:
                Route ${recommendations.fewest_reported_barriers_route ?? "Not available"}
            </li>
        </ul>

        <h3>Available Routes</h3>
    `;

    data.routes.forEach(route => {
        const nearbyReports = route.nearby_reports || [];

        const distance = Number(route.distance_km);
        const distanceText = Number.isFinite(distance)
            ? distance.toFixed(2) + " km"
            : "Not available";

        html += `
            <div class="route-card">

                <h3>Route ${escapeHTML(route.route_number)}</h3>

                <p><strong>Distance:</strong> ${distanceText}</p>

                <p><strong>Estimated time:</strong>
                    ${escapeHTML(route.duration_text || "Not available")}
                </p>

                <p><strong>Nearby reported barriers:</strong>
                    ${route.barrier_count ?? nearbyReports.length}
                </p>
        `;

        if (nearbyReports.length > 0) {
            html += `
                <p><strong>Reports near this route:</strong></p>
                <ul>
            `;

            nearbyReports.forEach(report => {
                html += `
                    <li>
                        ${escapeHTML(report.type)} -
                        ${escapeHTML(report.location)}
                        (${escapeHTML(report.status)})
                    </li>
                `;
            });

            html += "</ul>";
        }

        html += "</div>";
    });

    html += `
        <p class="route-notice">
            ${escapeHTML(data.notice || "")}
        </p>

        <h3>Route Map</h3>

        <div id="access-route-map"
             style="height: 400px; width: 100%; margin-top: 20px;">
        </div>
    `;

    resultBox.innerHTML = html;
}


// ==========================================
// DISPLAY MAP AND ROUTE LINES
// ==========================================

function displayMap(routes) {
    const mapElement = document.getElementById("access-route-map");

    if (!mapElement || !window.L || !routes.length) {
        return;
    }

    if (accessRouteMap) {
        accessRouteMap.remove();
        accessRouteMap = null;
    }

    accessRouteMap = L.map("access-route-map");

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(accessRouteMap);

    const routeColors = [
        "#1769ff",
        "#f28c28",
        "#16a36a",
        "#9b59b6"
    ];

    let allCoordinates = [];

    routes.forEach((route, index) => {
        if (
            !route.geometry ||
            !Array.isArray(route.geometry.coordinates) ||
            route.geometry.coordinates.length === 0
        ) {
            return;
        }

        const coordinates = route.geometry.coordinates.map(
            coordinate => [coordinate[1], coordinate[0]]
        );

        const routeLine = L.polyline(coordinates, {
            color: routeColors[index % routeColors.length],
            weight: index === 0 ? 6 : 4,
            opacity: 0.85
        }).addTo(accessRouteMap);

        routeLine.bindPopup(
            `Route ${route.route_number}<br>` +
            `Distance: ${route.distance_km} km<br>` +
            `Estimated time: ${route.duration_text}<br>` +
            `Nearby reports: ${route.barrier_count ?? 0}`
        );

        allCoordinates = allCoordinates.concat(coordinates);
    });

    if (allCoordinates.length > 0) {
        accessRouteMap.fitBounds(allCoordinates, {
            padding: [30, 30]
        });
    } else {
        mapElement.innerHTML =
            "Map coordinates were not returned by the backend.";
    }
}


// ==========================================
// REPORT A ROAD BARRIER
// ==========================================

async function reportBarrier() {
    const type = document.getElementById("barrier-type").value.trim();

    const location = document.getElementById("barrier-location").value.trim();

    const description = document.getElementById("barrier-description").value.trim();

    const resultBox = document.getElementById("report-result");

    if (!type || !location) {
        resultBox.textContent =
            "Please select a barrier type and enter its location.";
        return;
    }

    resultBox.textContent = "Submitting your barrier report...";

    try {
        const response = await fetch(`${BACKEND_URL}/api/report`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                type: type,
                location: location,
                description: description
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not submit report.");
        }

        resultBox.textContent =
            "Report submitted successfully! It is saved as an unverified community report.";

        document.getElementById("barrier-type").value = "";
        document.getElementById("barrier-location").value = "";
        document.getElementById("barrier-description").value = "";

    } catch (error) {
        console.error("Report error:", error);
        resultBox.textContent = "Error: " + error.message;
    }
}


// ==========================================
// PREVENT HTML INJECTION
// ==========================================

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => {
        const replacements = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        };

        return replacements[character];
    });
}


// ==========================================
// WEBSITE LOADED
// ==========================================

console.log("AccessRoute AI loaded successfully!");
