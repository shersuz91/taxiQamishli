const serviceAreaMap = document.getElementById("serviceAreaMap");

if (serviceAreaMap && window.L) {
    const latitudeInput = document.getElementById("service_center_latitude");
    const longitudeInput = document.getElementById("service_center_longitude");
    const radiusInput = document.getElementById("service_radius_km");
    const latitude = Number(serviceAreaMap.dataset.latitude);
    const longitude = Number(serviceAreaMap.dataset.longitude);
    const map = L.map("serviceAreaMap").setView([latitude, longitude], 12);
    const marker = L.marker([latitude, longitude], { draggable: true }).addTo(map);
    const serviceCircle = L.circle([latitude, longitude], {
        radius: Number(serviceAreaMap.dataset.radius) * 1000,
        color: "#f59e0b",
        fillColor: "#fbbf24",
        fillOpacity: 0.2,
    }).addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
    }).addTo(map);

    function updateCenter(latitudeValue, longitudeValue) {
        marker.setLatLng([latitudeValue, longitudeValue]);
        serviceCircle.setLatLng([latitudeValue, longitudeValue]);
        latitudeInput.value = Number(latitudeValue).toFixed(6);
        longitudeInput.value = Number(longitudeValue).toFixed(6);
    }

    marker.on("dragend", (event) => {
        const location = event.target.getLatLng();
        updateCenter(location.lat, location.lng);
    });
    map.on("click", (event) => updateCenter(event.latlng.lat, event.latlng.lng));
    radiusInput.addEventListener("input", () => {
        const radius = Number(radiusInput.value);
        if (Number.isFinite(radius) && radius > 0) {
            serviceCircle.setRadius(radius * 1000);
        }
    });
}
