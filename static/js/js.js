const form = document.getElementById("bookForm");
const footerYear = document.getElementById("footerYear");

if (footerYear) footerYear.textContent = new Date().getFullYear();

if (form && window.L) {
    const STEPS = Object.freeze({ DESTINATION: "destination", PICKUP: "pickup", ROUTE: "route", DETAILS: "details" });
    const element = (id) => document.getElementById(id);
    const ui = {
        flow: element("mapFlow"), mapElement: element("bookingMap"), mapTitle: element("mapTitle"), mapStep: element("mapStep"),
        mapTools: element("mapTools"), mapPanel: element("mapPanel"), routePanel: element("routePanel"), notice: element("mapNotice"), error: element("mapError"),
        confirmLocation: element("confirmLocation"), mapBack: element("mapBack"), currentLocation: element("currentLocation"), search: element("locationSearch"), results: element("searchResults"),
        destinationProgress: element("destinationProgress"), pickupProgress: element("pickupProgress"), routeProgress: element("routeProgress"),
        continueBooking: element("continueBooking"), details: element("bookingDetails"), laterDateTime: element("laterDateTime"), finalSummary: element("finalSummary"), contactFields: element("contactFields"), submit: element("submitBooking"),
        from: element("fromPlace"), to: element("toPlace"), pickupLat: element("pickupLatitude"), pickupLng: element("pickupLongitude"), destinationLat: element("destinationLatitude"), destinationLng: element("destinationLongitude"),
        distanceInput: element("distanceKm"), durationInput: element("estimatedTime"), fareInput: element("estimatedFare"), day: element("bookingDay"),
    };
    const serviceArea = { latitude: Number(ui.mapElement.dataset.serviceLatitude), longitude: Number(ui.mapElement.dataset.serviceLongitude), radius: Number(ui.mapElement.dataset.serviceRadius) * 1000 };
    const state = { step: STEPS.DESTINATION, destination: null, pickup: null, candidate: null, route: null, requestId: 0 };
    const map = L.map("bookingMap").setView([serviceArea.latitude, serviceArea.longitude], 13);
    const markers = { pickup: null, destination: null };
    let candidateMarker = null;
    let routeLayer = null;
    let searchTimer;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
    L.circle([serviceArea.latitude, serviceArea.longitude], { radius: serviceArea.radius, color: "#15935e", fillColor: "#15935e", fillOpacity: .07, interactive: false }).addTo(map);

    const labelFor = (point) => point.label || `الإحداثيات: ${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
    const iconFor = (type) => L.divIcon({ className: "", html: `<span class="map-marker ${type}">${type === STEPS.PICKUP ? "📍" : "🏁"}</span>`, iconSize: [30, 30], iconAnchor: [15, 28] });
    const setError = (message = "") => { ui.error.textContent = message; ui.error.classList.toggle("d-none", !message); };
    const setProgress = () => {
        ui.destinationProgress.className = state.step === STEPS.DESTINATION ? "active" : "complete";
        ui.pickupProgress.className = state.step === STEPS.PICKUP ? "active" : (state.pickup ? "complete" : "");
        ui.routeProgress.className = [STEPS.ROUTE, STEPS.DETAILS].includes(state.step) ? "active" : "";
    };

    function selectStep(step) {
        state.step = step;
        state.candidate = state[step] ? { ...state[step] } : null;
        if (candidateMarker) {
            map.removeLayer(candidateMarker);
            candidateMarker = null;
        }
        ui.mapTools.classList.remove("d-none");
        ui.mapPanel.classList.remove("d-none");
        ui.routePanel.classList.add("d-none");
        ui.currentLocation.classList.toggle("d-none", step !== STEPS.PICKUP);
        ui.mapTitle.textContent = step === STEPS.DESTINATION ? "حدد الوجهة" : "حدد مكان الانطلاق";
        ui.mapStep.textContent = step === STEPS.DESTINATION ? "1 من 4" : "2 من 4";
        ui.confirmLocation.textContent = step === STEPS.DESTINATION ? "تأكيد الوجهة" : "تأكيد مكان الانطلاق";
        ui.notice.textContent = step === STEPS.DESTINATION ? "اضغط على الخريطة لتحديد الوجهة." : "حدد مكان الانطلاق أو استخدم موقعك الحالي.";
        ui.confirmLocation.disabled = !state.candidate;
        setError();
        setProgress();
        const point = state.candidate || state[step] || { latitude: serviceArea.latitude, longitude: serviceArea.longitude };
        setTimeout(() => { map.invalidateSize(); map.setView([point.latitude, point.longitude], state.candidate ? 15 : 13); }, 0);
    }

    async function describeCandidate() {
        const candidate = state.candidate;
        if (!candidate) return;
        const requestId = ++state.requestId;
        ui.notice.textContent = "جاري تحديد الموقع...";
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ar&lat=${candidate.latitude}&lon=${candidate.longitude}`);
            const data = await response.json();
            if (response.ok && requestId === state.requestId && state.candidate === candidate && data.display_name) candidate.label = data.display_name;
        } catch (error) {
            // Coordinates remain valid when reverse geocoding is unavailable.
        }
        if (requestId === state.requestId) ui.notice.textContent = labelFor(candidate);
    }

    function setCandidate(latitude, longitude) {
        state.candidate = { latitude, longitude };
        const icon = L.divIcon({
            className: "",
            html: `<span class="selection-pin ${state.step}"><i class="bi bi-geo-alt-fill"></i></span>`,
            iconSize: [38, 46],
            iconAnchor: [19, 44],
        });
        if (candidateMarker) {
            candidateMarker.setLatLng([latitude, longitude]);
            candidateMarker.setIcon(icon);
        } else {
            candidateMarker = L.marker([latitude, longitude], { draggable: true, icon }).addTo(map);
            candidateMarker.on("dragend", (event) => {
                const location = event.target.getLatLng();
                setCandidate(location.lat, location.lng);
            });
        }
        ui.confirmLocation.disabled = false;
        describeCandidate();
    }

    function updateMarker(type, point) {
        if (markers[type]) markers[type].setLatLng([point.latitude, point.longitude]);
        else markers[type] = L.marker([point.latitude, point.longitude], { icon: iconFor(type), keyboard: false }).addTo(map);
    }

    async function showRoute() {
        state.step = STEPS.ROUTE;
        setProgress();
        ui.mapTitle.textContent = "جاري حساب مسار الرحلة...";
        ui.mapStep.textContent = "3 من 4";
        ui.mapTools.classList.add("d-none");
        ui.mapPanel.classList.add("d-none");
        ui.routePanel.classList.remove("d-none");
        ui.routePanel.classList.add("route-loading");
        ui.routePanel.querySelector("#continueBooking").disabled = true;
        try {
            const response = await fetch("/route-estimate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pickup_latitude: state.pickup.latitude, pickup_longitude: state.pickup.longitude, destination_latitude: state.destination.latitude, destination_longitude: state.destination.longitude }) });
            const route = await response.json();
            if (!response.ok || !route.geometry) throw new Error(route.error || "تعذر حساب مسار الرحلة. حاول مرة أخرى.");
            state.route = route;
            if (routeLayer) map.removeLayer(routeLayer);
            routeLayer = L.geoJSON(route.geometry, { style: { color: "#f5b400", weight: 5, opacity: .9 } }).addTo(map);
            updateMarker(STEPS.PICKUP, state.pickup);
            updateMarker(STEPS.DESTINATION, state.destination);
            map.fitBounds(routeLayer.getBounds(), { padding: [40, 40], maxZoom: 16 });
            ui.mapTitle.textContent = "معاينة رحلتك";
            ui.routePanel.classList.remove("route-loading");
            ui.routePanel.querySelector("#continueBooking").disabled = false;
            element("routePickup").textContent = labelFor(state.pickup); element("routeDestination").textContent = labelFor(state.destination);
            element("routeDistance").textContent = `${route.distance_km.toFixed(1)} كم`; element("routeDuration").textContent = `${route.estimated_minutes} دقيقة`; element("routeFare").textContent = `${route.estimated_fare.toFixed(2)} ل.س`;
            ui.distanceInput.value = route.distance_km; ui.durationInput.value = route.estimated_minutes; ui.fareInput.value = route.estimated_fare;
            setTimeout(() => { map.invalidateSize(); map.fitBounds(routeLayer.getBounds(), { padding: [40, 40], maxZoom: 16 }); }, 0);
        } catch (error) {
            ui.mapTitle.textContent = "تعذر حساب مسار الرحلة";
            ui.routePanel.classList.remove("route-loading");
            setError(error.message || "تعذر حساب مسار الرحلة. حاول مرة أخرى.");
            ui.mapPanel.classList.remove("d-none");
            ui.notice.textContent = "يمكنك تعديل أي موقع ثم إعادة المحاولة.";
        }
    }

    function confirmLocation() {
        if (!state.candidate) return;
        if (state.step === STEPS.PICKUP && map.distance([state.candidate.latitude, state.candidate.longitude], [serviceArea.latitude, serviceArea.longitude]) > serviceArea.radius) return setError("نعتذر، خدمة الانطلاق متاحة ضمن منطقة الخدمة فقط.");
        if (state.step === STEPS.PICKUP && state.destination && map.distance([state.candidate.latitude, state.candidate.longitude], [state.destination.latitude, state.destination.longitude]) < 20) return setError("اختر مكان انطلاق مختلفاً عن الوجهة.");
        const point = { ...state.candidate, label: labelFor(state.candidate) };
        if (candidateMarker) {
            map.removeLayer(candidateMarker);
            candidateMarker = null;
        }
        if (state.step === STEPS.DESTINATION) { state.destination = point; ui.to.value = point.label; ui.destinationLat.value = point.latitude.toFixed(6); ui.destinationLng.value = point.longitude.toFixed(6); updateMarker(STEPS.DESTINATION, point); selectStep(STEPS.PICKUP); }
        else { state.pickup = point; ui.from.value = point.label; ui.pickupLat.value = point.latitude.toFixed(6); ui.pickupLng.value = point.longitude.toFixed(6); updateMarker(STEPS.PICKUP, point); showRoute(); }
    }

    function continueToDetails() {
        state.step = STEPS.DETAILS;
        ui.flow.classList.add("d-none");
        form.style.display = "block";
        ui.details.classList.remove("d-none");
        element("detailPickup").textContent = labelFor(state.pickup); element("detailDestination").textContent = labelFor(state.destination);
        element("finalDistance").textContent = element("routeDistance").textContent; element("finalDuration").textContent = element("routeDuration").textContent; element("finalFare").textContent = element("routeFare").textContent;
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    map.on("click", (event) => setCandidate(event.latlng.lat, event.latlng.lng));
    ui.confirmLocation.addEventListener("click", confirmLocation);
    ui.continueBooking.addEventListener("click", continueToDetails);
    ui.currentLocation.addEventListener("click", () => {
        if (!navigator.geolocation) return setError("لا يدعم هذا الجهاز تحديد موقعك الحالي.");
        ui.notice.textContent = "جاري تحديد موقعك الحالي...";
        navigator.geolocation.getCurrentPosition((position) => { map.setView([position.coords.latitude, position.coords.longitude], 16); setCandidate(position.coords.latitude, position.coords.longitude); }, () => setError("تعذر تحديد موقعك الحالي. اختر الموقع يدوياً من الخريطة."), { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 });
    });
    document.querySelectorAll("[data-edit-location]").forEach((button) => button.addEventListener("click", () => { ui.flow.classList.remove("d-none"); ui.details.classList.add("d-none"); selectStep(button.dataset.editLocation); }));
    ui.mapBack.addEventListener("click", () => { if (state.step === STEPS.PICKUP && state.destination) selectStep(STEPS.DESTINATION); else if (state.step === STEPS.ROUTE) selectStep(STEPS.PICKUP); });

    ui.search.addEventListener("input", () => { clearTimeout(searchTimer); const query = ui.search.value.trim(); ui.results.replaceChildren(); ui.results.classList.add("d-none"); if (query.length < 3) return; searchTimer = setTimeout(async () => { try { const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ar&q=${encodeURIComponent(query)}`); const places = await response.json(); places.forEach((place) => { const item = document.createElement("li"); const button = document.createElement("button"); button.type = "button"; button.textContent = place.display_name; button.addEventListener("click", () => { const latitude = Number(place.lat); const longitude = Number(place.lon); map.setView([latitude, longitude], 16); setCandidate(latitude, longitude); ui.results.classList.add("d-none"); }); item.appendChild(button); ui.results.appendChild(item); }); ui.results.classList.toggle("d-none", places.length === 0); } catch (error) { setError("تعذر البحث عن الموقع. اختره من الخريطة."); } }, 350); });

    document.querySelectorAll("[data-time]").forEach((button) => button.addEventListener("click", () => { const later = button.dataset.time === "later"; document.querySelectorAll("[data-time]").forEach((item) => item.classList.toggle("active", item === button)); ui.laterDateTime.classList.toggle("d-none", !later); if (!later) { ui.day.value = new Date().toISOString().slice(0, 16); ui.finalSummary.classList.remove("d-none"); ui.contactFields.classList.remove("d-none"); ui.submit.classList.remove("d-none"); } }));
    ui.laterDateTime.addEventListener("change", () => { if (ui.laterDateTime.value) { ui.day.value = ui.laterDateTime.value; ui.finalSummary.classList.remove("d-none"); ui.contactFields.classList.remove("d-none"); ui.submit.classList.remove("d-none"); } });
    form.addEventListener("submit", (event) => { if (!state.route || !ui.day.value) { event.preventDefault(); return; } ui.submit.disabled = true; ui.submit.textContent = "جاري إرسال الحجز..."; element("sendingLoad").classList.remove("d-none"); });

    selectStep(STEPS.DESTINATION);
} else if (form) {
    document.getElementById("mapError")?.classList.remove("d-none");
}
