/* Pure Prediction - main app script */

(function () {
  const DEFAULT_CONFIG = {
    openWeatherApiKey: null,
    useOpenMeteo: true,
    mapProvider: "OSM",
    mapTilerApiKey: null,
    defaultRadiusKm: 20
  };

  const CONFIG = Object.assign(
    {},
    DEFAULT_CONFIG,
    window.PURE_PREDICTION_CONFIG || {}
  );

  const state = {
    map: null,
    userLocation: null,
    mode: "land",
    spots: [],
    selectedSpotId: null,
    spotLayer: null
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheDom();
    bindEvents();
    initMap();
    loadSampleSpots();
  }

  function cacheDom() {
    els.modeLand = document.getElementById("mode-land");
    els.modeBoat = document.getElementById("mode-boat");
    els.btnLocate = document.getElementById("btn-locate");
    els.searchInput = document.getElementById("search-input");
    els.btnSearch = document.getElementById("btn-search");
    els.spotList = document.getElementById("spot-list");
    els.bestCardBody = document.getElementById("best-opportunity-body");
    els.mapLoading = document.getElementById("map-loading");
    els.mapError = document.getElementById("map-error");
    els.detailSheet = document.getElementById("spot-detail-sheet");
    els.detailName = document.getElementById("detail-name");
    els.detailMeta = document.getElementById("detail-meta");
    els.detailConditions = document.getElementById("detail-conditions");
    els.detailReasons = document.getElementById("detail-reasons");
    els.detailAlternatives = document.getElementById("detail-alternatives");
    els.detailClose = document.getElementById("detail-close");
  }

  function bindEvents() {
    els.modeLand.addEventListener("click", () => setMode("land"));
    els.modeBoat.addEventListener("click", () => setMode("boat"));
    els.btnLocate.addEventListener("click", useMyLocation);
    els.btnSearch.addEventListener("click", handleSearch);
    els.detailClose.addEventListener("click", hideDetailSheet);

    els.spotList.addEventListener("click", (e) => {
      const item = e.target.closest("[data-spot-id]");
      if (!item) return;
      const id = item.getAttribute("data-spot-id");
      openSpotDetail(id);
    });

    els.detailAlternatives.addEventListener("click", (e) => {
      const item = e.target.closest("[data-alt-id]");
      if (!item) return;
      const id = item.getAttribute("data-alt-id");
      openSpotDetail(id);
    });
  }

  function setMode(mode) {
    if (mode !== "land" && mode !== "boat") return;
    state.mode = mode;
    els.modeLand.classList.toggle("active", mode === "land");
    els.modeBoat.classList.toggle("active", mode === "boat");
    refreshVisibleSpots();
    updateBestOpportunity();
  }

  function initMap() {
    els.mapLoading.classList.remove("hidden");
    try {
      state.map = L.map("map", {
        center: [-33.8688, 151.2093], // Sydney default
        zoom: 11
      });

      const tileLayer = getTileLayer();
      tileLayer.addTo(state.map);

      els.mapLoading.classList.add("hidden");
    } catch (err) {
      console.error(err);
      els.mapLoading.classList.add("hidden");
      showMapError("Could not load map. Please refresh.");
    }
  }

  function getTileLayer() {
    if (CONFIG.mapProvider === "MapTiler" && CONFIG.mapTilerApiKey) {
      return L.tileLayer(
        "https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=" +
          CONFIG.mapTilerApiKey,
        {
          attribution: "© MapTiler © OpenStreetMap contributors",
          maxZoom: 19
        }
      );
    }

    return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors"
    });
  }

  function showMapError(msg) {
    if (!msg) {
      els.mapError.classList.add("hidden");
      els.mapError.textContent = "";
      return;
    }
    els.mapError.textContent = msg;
    els.mapError.classList.remove("hidden");
  }
  function useMyLocation() {
    if (!navigator.geolocation) {
      showMapError("Geolocation is not supported by this browser.");
      return;
    }
    showMapError("");
    els.mapLoading.classList.remove("hidden");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        els.mapLoading.classList.add("hidden");
        const { latitude, longitude } = pos.coords;
        state.userLocation = { lat: latitude, lon: longitude };
        state.map.setView([latitude, longitude], 12);
        refreshVisibleSpots();
        updateBestOpportunity();
      },
      (err) => {
        els.mapLoading.classList.add("hidden");
        showMapError("Location error. Please allow location access.");
        console.warn(err);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function handleSearch() {
    const q = els.searchInput.value.trim();
    if (!q) return;
    showMapError("");
    geocodeSearch(q);
  }

  async function geocodeSearch(query) {
    els.mapLoading.classList.remove("hidden");
    try {
      const url =
        "https://nominatim.openstreetmap.org/search?format=json&q=" +
        encodeURIComponent(query);
      const resp = await fetch(url, {
        headers: {
          "Accept-Language": "en",
          "User-Agent": "PurePredictionDemo/1.0"
        }
      });
      if (!resp.ok) throw new Error("Geocoding failed");
      const results = await resp.json();
      if (!results.length) {
        showMapError("No results for that place.");
        els.mapLoading.classList.add("hidden");
        return;
      }
      const best = results[0];
      const lat = parseFloat(best.lat);
      const lon = parseFloat(best.lon);
      state.userLocation = { lat, lon };
      state.map.setView([lat, lon], 11);
      refreshVisibleSpots();
      updateBestOpportunity();
      els.mapLoading.classList.add("hidden");
    } catch (err) {
      console.error(err);
      els.mapLoading.classList.add("hidden");
      showMapError("Could not search that place right now.");
    }
  }

  function loadSampleSpots() {
    // For MVP we use static sample spots. Replace this later with Overpass API calls.
    fetch("data/sample-spots.json")
      .then((r) => r.json())
      .then((data) => {
        state.spots = data.spots || [];
        plotSpotsOnMap();
        refreshVisibleSpots();
        updateBestOpportunity();
      })
      .catch((err) => {
        console.error("Could not load sample spots", err);
      });
  }

  function plotSpotsOnMap() {
    if (!state.map) return;
    if (state.spotLayer) {
      state.map.removeLayer(state.spotLayer);
    }
    const markers = state.spots.map((spot) => {
      const marker = L.circleMarker([spot.lat, spot.lon], {
        radius: 6,
        weight: 1,
        color: "#38bdf8",
        fillColor: "#38bdf8",
        fillOpacity: 0.8
      });
      marker.on("click", () => openSpotDetail(spot.id));
      return marker;
    });
    state.spotLayer = L.layerGroup(markers).addTo(state.map);
  }

  function refreshVisibleSpots() {
    const filtered = state.spots.filter((s) => s.mode === state.mode);
    renderSpotList(filtered);
  }

  function renderSpotList(spots) {
    els.spotList.innerHTML = "";
    if (!spots.length) {
      els.spotList.innerHTML =
        '<li class="spot-item"><span class="spot-name">No spots loaded for this mode yet.</span></li>';
      return;
    }

    spots
      .map((spot) => ({
        spot,
        score: computeSpotScore(spot)
      }))
      .sort((a, b) => b.score - a.score)
      .forEach(({ spot, score }) => {
        const li = document.createElement("li");
        li.className = "spot-item";
        li.dataset.spotId = spot.id;

        const nameSpan = document.createElement("span");
        nameSpan.className = "spot-name";
        nameSpan.textContent = spot.name;

        const meta = document.createElement("div");
        meta.className = "spot-meta";
        meta.textContent = `${spot.distance_km.toFixed(1)} km · ${spot.access}`;

        const left = document.createElement("div");
        left.appendChild(nameSpan);
        left.appendChild(meta);

        const scoreSpan = document.createElement("span");
        scoreSpan.className = "spot-score";
        if (score < 0.4) scoreSpan.classList.add("low");
        else if (score < 0.7) scoreSpan.classList.add("medium");
        scoreSpan.textContent = Math.round(score * 100);

        li.appendChild(left);
        li.appendChild(scoreSpan);

        els.spotList.appendChild(li);
      });
  }

  function computeSpotScore(spot) {
    const distanceFactor = state.userLocation
      ? Math.max(0, 1 - spot.distance_km / CONFIG.defaultRadiusKm)
      : 0.5;
    const base = spot.base_score != null ? spot.base_score : 0.5;
    return 0.6 * base + 0.4 * distanceFactor;
  }
  function updateBestOpportunity() {
    const filtered = state.spots.filter((s) => s.mode === state.mode);
    if (!filtered.length) {
      els.bestCardBody.textContent =
        "No spots for this mode yet. This will update once data is loaded.";
      return;
    }

    const withScores = filtered.map((spot) => ({
      spot,
      score: computeSpotScore(spot)
    }));
    withScores.sort((a, b) => b.score - a.score);
    const best = withScores[0];
    const score = Math.round(best.score * 100);

    els.bestCardBody.textContent = `${best.spot.name} · ${best.spot.distance_km.toFixed(
      1
    )} km away · score ${score}. Tap to view details.`;

    els.bestCardBody.parentElement.onclick = () => openSpotDetail(best.spot.id);
  }

  function openSpotDetail(id) {
    const spot = state.spots.find((s) => s.id === id);
    if (!spot) return;
    state.selectedSpotId = id;

    els.detailName.textContent = spot.name;
    els.detailMeta.textContent = `${spot.distance_km.toFixed(
      1
    )} km · ${spot.access} · Mode ${spot.mode === "land" ? "Land" : "Boat"}`;

    els.detailConditions.innerHTML = "";
    els.detailReasons.innerHTML = "";
    els.detailAlternatives.innerHTML = "";

    const conds = [
      `Sample wind: ${spot.mock_wind_kph ?? 10} km/h`,
      `Sample temp: ${spot.mock_temp_c ?? 20} °C`,
      `Mock wave: ${spot.mock_wave_m ?? 0.3} m`
    ];

    conds.forEach((c) => {
      const li = document.createElement("li");
      li.textContent = c;
      els.detailConditions.appendChild(li);
    });

    const reasons = [
      "Proximity to your current or searched location.",
      "Static base quality score in demo data.",
      "Placeholder weather factors. Replace with real API data here."
    ];

    reasons.forEach((r) => {
      const li = document.createElement("li");
      li.textContent = r;
      els.detailReasons.appendChild(li);
    });

    const alternatives = computeAlternatives(spot);
    if (!alternatives.length) {
      const li = document.createElement("li");
      li.textContent = "No clearly better spots nearby in this demo data.";
      els.detailAlternatives.appendChild(li);
    } else {
      alternatives.forEach(({ other, summary }) => {
        const li = document.createElement("li");
        li.className = "alternative-item";
        li.dataset.altId = other.id;

        const h4 = document.createElement("h4");
        h4.textContent = `${other.name} · ${other.distance_km.toFixed(1)} km`;

        const p = document.createElement("p");
        p.textContent = summary;

        li.appendChild(h4);
        li.appendChild(p);
        els.detailAlternatives.appendChild(li);
      });
    }

    els.detailSheet.classList.remove("hidden");
  }

  function hideDetailSheet() {
    els.detailSheet.classList.add("hidden");
  }

  function computeAlternatives(selected) {
    const candidates = state.spots.filter(
      (s) =>
        s.mode === state.mode &&
        s.id !== selected.id &&
        s.distance_km <= CONFIG.defaultRadiusKm
    );
    const selectedScore = computeSpotScore(selected);
    const picks = [];

    candidates.forEach((other) => {
      const score = computeSpotScore(other);
      if (score <= selectedScore + 0.05) return;

      const diffs = [];
      const sWind = selected.mock_wind_kph ?? 10;
      const oWind = other.mock_wind_kph ?? 10;
      if (oWind + 2 < sWind) {
        diffs.push(`lower wind (${oWind} vs ${sWind} km/h)`);
      }

      const sTemp = selected.mock_temp_c ?? 20;
      const oTemp = other.mock_temp_c ?? 20;
      if (Math.abs(oTemp - 20) < Math.abs(sTemp - 20)) {
        diffs.push("closer to ideal water temperature");
      }

      const sWave = selected.mock_wave_m ?? 0.3;
      const oWave = other.mock_wave_m ?? 0.3;
      if (oWave + 0.2 < sWave) {
        diffs.push(`calmer surface (waves ${oWave} m vs ${sWave} m)`);
      }

      if (!diffs.length) return;
      const summary = `Better score and ${diffs.join(", ")}.`;
      picks.push({ other, summary, score });
    });

    picks.sort((a, b) => b.score - a.score);
    return picks.slice(0, 3);
  }
})();
 