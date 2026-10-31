
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import json
from pathlib import Path
from math import cos, radians, sqrt

app = Flask(__name__)
CORS(app)

HEADERS = {
    "User-Agent": "AccessRouteAI/1.0 StudentProject"
}

# Store reports in a JSON file beside app.py
REPORTS_FILE = Path(__file__).with_name("barrier_reports.json")


def load_reports():
    if not REPORTS_FILE.exists():
        return []

    try:
        with open(REPORTS_FILE, "r", encoding="utf-8") as file:
            return json.load(file)
    except (json.JSONDecodeError, OSError):
        return []


def save_reports(reports):
    with open(REPORTS_FILE, "w", encoding="utf-8") as file:
        json.dump(reports, file, indent=2)


def get_coordinates(place):
    url = "https://nominatim.openstreetmap.org/search"

    response = requests.get(
        url,
        params={"q": place, "format": "json", "limit": 1},
        headers=HEADERS,
        timeout=20
    )
    response.raise_for_status()

    results = response.json()
    if not results:
        return None

    return [
        float(results[0]["lon"]),
        float(results[0]["lat"])
    ]


def distance_to_route_meters(point, line):
    """
    Approximate the shortest distance from a reported point
    to a route line. Coordinates are [longitude, latitude].
    """
    point_lon, point_lat = point
    lat_scale = 111320
    lon_scale = 111320 * cos(radians(point_lat))

    px = point_lon * lon_scale
    py = point_lat * lat_scale

    smallest_distance = float("inf")

    for index in range(len(line) - 1):
        lon1, lat1 = line[index]
        lon2, lat2 = line[index + 1]

        x1 = lon1 * lon_scale
        y1 = lat1 * lat_scale
        x2 = lon2 * lon_scale
        y2 = lat2 * lat_scale

        dx = x2 - x1
        dy = y2 - y1

        if dx == 0 and dy == 0:
            nearest_x, nearest_y = x1, y1
        else:
            position = (
                (px - x1) * dx + (py - y1) * dy
            ) / (dx * dx + dy * dy)

            position = max(0, min(1, position))
            nearest_x = x1 + position * dx
            nearest_y = y1 + position * dy

        distance = sqrt(
            (px - nearest_x) ** 2 +
            (py - nearest_y) ** 2
        )

        smallest_distance = min(smallest_distance, distance)

    return smallest_distance


@app.route("/")
def home():
    return "AccessRoute AI Backend is Running Successfully!"


# Receive and save a community barrier report
@app.route("/api/report", methods=["POST"])
def create_report():
    try:
        data = request.get_json() or {}

        barrier_type = str(data.get("type", "")).strip()
        location = str(data.get("location", "")).strip()
        description = str(data.get("description", "")).strip()

        if not barrier_type or not location:
            return jsonify({
                "error": "Please provide a barrier type and location."
            }), 400

        coordinates = get_coordinates(location)

        if not coordinates:
            return jsonify({
                "error": "Barrier location not found. Try a more complete address."
            }), 404

        reports = load_reports()

        report = {
            "type": barrier_type,
            "location": location,
            "description": description,
            "coordinates": coordinates,
            "status": "Unverified community report"
        }

        reports.append(report)
        save_reports(reports)

        return jsonify({
            "success": True,
            "message": "Barrier report saved. It is currently unverified."
        }), 201

    except requests.RequestException:
        return jsonify({
            "error": "Location service unavailable. Please try again."
        }), 503

    except Exception as error:
        return jsonify({"error": str(error)}), 500


# Calculate routes and check nearby community reports
@app.route("/api/route", methods=["POST"])
def calculate_route():
    try:
        data = request.get_json() or {}

        start = str(data.get("start", "")).strip()
        destination = str(data.get("destination", "")).strip()

        if not start or not destination:
            return jsonify({
                "error": "Please enter starting point and destination."
            }), 400

        start_coords = get_coordinates(start)
        end_coords = get_coordinates(destination)

        if not start_coords or not end_coords:
            return jsonify({
                "error": "Location not found. Please enter a fuller location."
            }), 404

        route_url = (
            "https://router.project-osrm.org/route/v1/driving/"
            f"{start_coords[0]},{start_coords[1]};"
            f"{end_coords[0]},{end_coords[1]}"
        )

        response = requests.get(
            route_url,
            params={
                "overview": "full",
                "geometries": "geojson",
                "alternatives": "2"
            },
            timeout=30
        )
        response.raise_for_status()

        result = response.json()

        if result.get("code") != "Ok" or not result.get("routes"):
            return jsonify({
                "error": "No driving route available."
            }), 404

        reports = load_reports()
        routes = []

        for index, route in enumerate(result["routes"]):
            distance_km = route["distance"] / 1000
            total_minutes = round(route["duration"] / 60)

            hours = total_minutes // 60
            minutes = total_minutes % 60

            if hours > 0:
                time_text = f"{hours} hr {minutes} min"
            else:
                time_text = f"{minutes} min"

            line = route["geometry"]["coordinates"]
            nearby_reports = []

            for report in reports:
                report_coordinates = report.get("coordinates")

                if not report_coordinates:
                    continue

                distance = distance_to_route_meters(
                    report_coordinates,
                    line
                )

                # Count reports within approximately 100 metres
                if distance <= 100:
                    nearby_reports.append({
                        "type": report["type"],
                        "location": report["location"],
                        "status": report["status"]
                    })

            routes.append({
                "route_number": index + 1,
                "distance_km": round(distance_km, 2),
                "duration_minutes": total_minutes,
                "duration_text": time_text,
                "barrier_count": len(nearby_reports),
                "nearby_reports": nearby_reports,
                "geometry": route["geometry"]
            })

        shortest = min(routes, key=lambda item: item["distance_km"])
        fastest = min(routes, key=lambda item: item["duration_minutes"])
        fewer_barriers = min(
            routes,
            key=lambda item: (
                item["barrier_count"],
                item["duration_minutes"]
            )
        )

        return jsonify({
            "success": True,
            "start": start,
            "destination": destination,
            "transport_mode": "Driving",
            "routes": routes,
            "recommendations": {
                "shortest_route": shortest["route_number"],
                "fastest_route": fastest["route_number"],
                "fewest_reported_barriers_route": fewer_barriers["route_number"]
            },
            "notice": (
                "Estimated driving times, not live traffic. "
                "Community reports are unverified. "
                "Fewer reported barriers does not mean wheelchair accessible."
            )
        })

    except requests.RequestException:
        return jsonify({
            "error": "Map routing service unavailable. Please try again."
        }), 503

    except Exception as error:
        return jsonify({"error": str(error)}), 500


if __name__ == "__main__":
    app.run(
    host="0.0.0.0",
    port=5000,
    debug=True
)