const bookForm = document.getElementById("bookForm");
const circles = document.querySelectorAll(".circle");
const sendingLoad = document.getElementById("sendingLoad");

let delay = 0;
circles.forEach((circle) => {
    circle.style.backgroundColor = circle.getAttribute("color_");
    circle.style.animationDelay = `${delay}s`;
    delay += 0.1;
});

if (bookForm && window.L) {
    const mapStatus = document.getElementById("mapStatus");
    const mapError = document.getElementById("mapError");
    const bookingSummary = document.getElementById("bookingSummary");
    const locationInputs = {
        pickup: {
            address: document.getElementById("fromPlace"),
            latitude: document.getElementById("pickupLatitude"),
            longitude: document.getElementById("pickupLongitude"),
            summary: document.getElementById("summaryPickup"),
        },
        destination: {
            address: document.getElementById("toPlace"),
            latitude: document.getElementById("destinationLatitude"),
            longitude: document.getElementById("destinationLongitude"),
            summary: document.getElementById("summaryDestination"),
        },
    };
    const summaryFields = {
        distance: document.getElementById("summaryDistance"),
        time: document.getElementById("summaryTime"),
        fare: document.getElementById("summaryFare"),
        distanceInput: document.getElementById("distanceKm"),
        timeInput: document.getElementById("estimatedTime"),
        fareInput: document.getElementById("estimatedFare"),
    };
    const modeButtons = document.querySelectorAll("[data-location-mode]");
    const mapElement = document.getElementById("bookingMap");
    const bookingsEnabled = mapElement.dataset.bookingsEnabled === "true";
    const serviceArea = {
        latitude: Number(mapElement.dataset.serviceLatitude),
        longitude: Number(mapElement.dataset.serviceLongitude),
        radiusMeters: Number(mapElement.dataset.serviceRadius) * 1000,
    };
    const map = L.map("bookingMap", { scrollWheelZoom: false }).setView([serviceArea.latitude, serviceArea.longitude], 13);
    const points = { pickup: null, destination: null };
    const markers = { pickup: null, destination: null };
    let activeMode = "pickup";
    let routeLayer = null;
    let routeEstimate = null;
    let routeRequestId = 0;
    const geocodeRequestIds = { pickup: 0, destination: 0 };

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
    }).addTo(map);

    const serviceAreaCircle = L.circle([serviceArea.latitude, serviceArea.longitude], {
        radius: serviceArea.radiusMeters,
        color: "#198754",
        fillColor: "#198754",
        fillOpacity: 0.08,
        interactive: false,
    }).addTo(map);

    if (!bookingsEnabled) {
        mapStatus.textContent = "الحجز عبر الإنترنت غير متاح حالياً.";
        bookForm.querySelector("button[type='submit']").disabled = true;
    }

    function coordinateLabel(latitude, longitude) {
        return `الإحداثيات: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }

    function showError(message) {
        mapError.textContent = message;
        mapError.classList.remove("d-none");
    }

    function clearError() {
        mapError.textContent = "";
        mapError.classList.add("d-none");
    }

    function setMode(mode) {
        activeMode = mode;
        modeButtons.forEach((button) => {
            button.classList.toggle("active", button.dataset.locationMode === mode);
        });
        mapStatus.textContent = mode === "pickup"
            ? "اضغط على الخريطة لتحديد نقطة الانطلاق أو اسحب علامتها الخضراء."
            : "اضغط على الخريطة لتحديد الوجهة أو اسحب علامتها الحمراء.";
    }

    function markerIcon(mode) {
        return L.divIcon({
            className: "",
            html: `<div class="map-marker ${mode}"></div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 22],
        });
    }

    function resetRoute() {
        routeEstimate = null;
        routeRequestId += 1;
        summaryFields.distanceInput.value = "";
        summaryFields.timeInput.value = "";
        summaryFields.fareInput.value = "";
        bookingSummary.classList.add("d-none");
        if (routeLayer) {
            map.removeLayer(routeLayer);
            routeLayer = null;
        }
    }

    function pickupIsWithinServiceArea() {
        if (!points.pickup) {
            return false;
        }
        return map.distance(
            [points.pickup.latitude, points.pickup.longitude],
            [serviceArea.latitude, serviceArea.longitude],
        ) <= serviceArea.radiusMeters;
    }

    async function reverseGeocode(mode, latitude, longitude) {
        const requestId = ++geocodeRequestIds[mode];
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ar&lat=${latitude}&lon=${longitude}`,
            );
            if (!response.ok) {
                return;
            }
            const data = await response.json();
            if (requestId === geocodeRequestIds[mode] && points[mode]
                && points[mode].latitude === latitude && points[mode].longitude === longitude
                && data.display_name) {
                locationInputs[mode].address.value = data.display_name;
                locationInputs[mode].summary.textContent = data.display_name;
            }
        } catch (error) {
            // Coordinates remain usable when reverse geocoding is unavailable.
        }
    }

    async function updateRoute() {
        if (!bookingsEnabled) {
            showError("الحجز عبر الإنترنت غير متاح حالياً.");
            return;
        }
        if (!points.pickup || !points.destination) {
            return;
        }
        if (!pickupIsWithinServiceArea()) {
            showError("نعتذر، خدمة الانطلاق متاحة حالياً ضمن منطقة الخدمة فقط.");
            mapStatus.textContent = "اختر نقطة انطلاق داخل الدائرة الخضراء.";
            return;
        }
        const requestId = ++routeRequestId;
        mapStatus.textContent = "جاري حساب مسار القيادة...";
        try {
            const response = await fetch("/route-estimate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pickup_latitude: points.pickup.latitude,
                    pickup_longitude: points.pickup.longitude,
                    destination_latitude: points.destination.latitude,
                    destination_longitude: points.destination.longitude,
                }),
            });
            const data = await response.json();
            if (requestId !== routeRequestId) {
                return;
            }
            if (!response.ok || !data.geometry || !Array.isArray(data.geometry.coordinates)) {
                throw new Error(data.error || "تعذر حساب المسار.");
            }

            routeEstimate = data;
            routeLayer = L.geoJSON(data.geometry, {
                style: { color: "#FFC107", weight: 5, opacity: 0.85 },
            }).addTo(map);
            map.fitBounds(routeLayer.getBounds(), { padding: [30, 30], maxZoom: 15 });
            summaryFields.distance.textContent = `${data.distance_km.toFixed(1)} كم`;
            summaryFields.time.textContent = `${data.estimated_minutes} دقيقة`;
            summaryFields.fare.textContent = `${data.estimated_fare.toFixed(2)} ل.س`;
            summaryFields.distanceInput.value = data.distance_km;
            summaryFields.timeInput.value = data.estimated_minutes;
            summaryFields.fareInput.value = data.estimated_fare;
            bookingSummary.classList.remove("d-none");
            mapStatus.textContent = "تم حساب المسار. راجع ملخص الرحلة ثم أرسل الطلب.";
            clearError();
        } catch (error) {
            if (requestId !== routeRequestId) {
                return;
            }
            routeEstimate = null;
            showError(error.message || "تعذر حساب المسار. تحقق من الاتصال وحاول تغيير النقاط.");
            mapStatus.textContent = "لم يتم حساب مسار صالح بعد.";
        }
    }

    function setLocation(mode, latitude, longitude) {
        resetRoute();
        clearError();
        const point = { latitude, longitude };
        points[mode] = point;
        const fields = locationInputs[mode];
        const label = coordinateLabel(latitude, longitude);
        fields.latitude.value = latitude.toFixed(6);
        fields.longitude.value = longitude.toFixed(6);
        fields.address.value = label;
        fields.summary.textContent = label;

        if (markers[mode]) {
            markers[mode].setLatLng([latitude, longitude]);
        } else {
            markers[mode] = L.marker([latitude, longitude], {
                draggable: true,
                icon: markerIcon(mode),
                title: mode === "pickup" ? "نقطة الانطلاق" : "الوجهة",
            }).addTo(map);
            markers[mode].on("dragend", (event) => {
                const location = event.target.getLatLng();
                setLocation(mode, location.lat, location.lng);
            });
        }

        reverseGeocode(mode, latitude, longitude);
        if (mode === "pickup" && !pickupIsWithinServiceArea()) {
            showError("نعتذر، خدمة الانطلاق متاحة حالياً ضمن منطقة الخدمة فقط.");
            mapStatus.textContent = "اختر نقطة انطلاق داخل الدائرة الخضراء.";
            return;
        }
        if (points.pickup && points.destination) {
            updateRoute();
        } else {
            setMode(mode === "pickup" ? "destination" : "pickup");
        }
    }

    modeButtons.forEach((button) => {
        button.addEventListener("click", () => setMode(button.dataset.locationMode));
    });

    map.on("click", (event) => setLocation(activeMode, event.latlng.lat, event.latlng.lng));

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                if (points.pickup) {
                    return;
                }
                const { latitude, longitude } = position.coords;
                setLocation("pickup", latitude, longitude);
                map.setView([latitude, longitude], 15);
            },
            () => {
                mapStatus.textContent = "يمكنك تحديد نقطة الانطلاق بنفسك بالضغط على الخريطة.";
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 },
        );
    }

    bookForm.addEventListener("submit", (event) => {
        if (!bookingsEnabled || !points.pickup || !points.destination || !routeEstimate) {
            event.preventDefault();
            showError("يرجى اختيار نقطة الانطلاق والوجهة وانتظار حساب مسار صالح قبل إرسال الطلب.");
            return;
        }
        sendingLoad.style.display = "flex";
    });
} else if (bookForm) {
    const mapError = document.getElementById("mapError");
    mapError.textContent = "تعذر تحميل الخريطة. تحقق من اتصال الإنترنت ثم أعد تحميل الصفحة.";
    mapError.classList.remove("d-none");
    bookForm.addEventListener("submit", (event) => event.preventDefault());
}
