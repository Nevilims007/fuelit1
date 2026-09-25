(() => {
    const section = document.createElement('section');
    section.id = 'nearbyStations'; section.className = 'screen';
    section.innerHTML = `<button class="back-btn" onclick="showScreen('home')">← Home</button>
        <h1 id="nearbyTitle">Choose your petrol bunk</h1>
        <p>Real mapped places. Enable location, or tap the map to choose a search area.</p>
        <button id="nearbyGps" class="primary-btn">📍 Use my current location</button>
        <p id="nearbyAccuracy" role="status"></p>
        <label for="nearbyRadius">Search radius</label>
        <select id="nearbyRadius"><option value="3000">3 km</option><option value="5000" selected>5 km</option><option value="10000">10 km</option></select>
        <div id="nearbyMap" style="height:380px;border-radius:18px;margin:16px 0"></div>
        <button id="nearbySearch" class="secondary-btn">Search selected area</button>
        <p id="nearbyStatus" role="status" aria-live="polite"></p>
        <p style="color:#60708b;font-size:13px">Names and locations: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>. Coverage varies; mapped locations may be approximate. Distances are straight-line, not driving distance. Opening hours are mapped information, not live status. These are not confirmed Fuzio delivery partners.</p>
        <label for="nearbyFilter">Find a brand or branch in these results</label>
        <input id="nearbyFilter" type="search" placeholder="Bharat Petroleum, IndianOil, HP or address" style="width:100%;padding:14px;border:1px solid #ccd6e5;border-radius:12px;margin:8px 0 16px">
        <p id="nearbyFilterStatus" role="status"></p>
        <div id="nearbyList"></div>`;
    document.querySelector('.app').append(section);
    const $ = id => document.getElementById(id);
    let map, pins, origin, center, mode = 'fuel', activeRequest, generation = 0;
    const status = text => $('nearbyStatus').textContent = text;
    function initialize() {
        if (map) { map.invalidateSize(); return; }
        map = FuzioMaps.map('nearbyMap').setView([20.59,78.96],5);
        pins = FuzioMaps.layerGroup().addTo(map);
        map.on('click', event => {
            generation++; activeRequest?.abort();
            setCenter(event.latlng.lat, event.latlng.lng, 'Selected search area');
            status('Area selected. Tap Search selected area.');
        });
    }
    function setCenter(lat,lon,label) {
        $('nearbyAccuracy').textContent=label==='Selected search area'?'Manually selected area — not your detected current location.':'';
        center = {lat,lon}; pins.clearLayers(); $('nearbyList').replaceChildren();
        if (origin) origin.remove();
        origin = FuzioMaps.circleMarker([lat,lon],{radius:9,color:'#fff',weight:3,fillColor:'#2161ed',fillOpacity:1}).addTo(map).bindPopup(label);
        map.setView([lat,lon],14);
    }
    function element(tag,text) { const e=document.createElement(tag); e.textContent=text; return e; }
    function brandLabel(station) {
        const raw = (station.brand || '').trim();
        const candidate = raw || station.name || '';
        if (/\b(bharat petroleum|bharath petroleum|bpcl)\b/i.test(candidate)) return 'Bharat Petroleum';
        if (/\b(indian\s*oil|iocl)\b/i.test(candidate)) return 'IndianOil';
        if (/\b(hindustan petroleum|hpcl|hp)\b/i.test(candidate)) return 'HP';
        return raw || 'Brand not listed';
    }
    function filterCards() {
        const query = $('nearbyFilter').value.trim().toLowerCase().replace(/\s/g,'');
        let visible=0;
        $('nearbyList').querySelectorAll('article').forEach(card=>{
            card.hidden=!card.dataset.search.includes(query);
            if(!card.hidden)visible++;
        });
        $('nearbyFilterStatus').textContent=query ? `${visible} matching places in loaded results. Map pins show all results.` : '';
    }
    $('nearbyFilter').oninput=filterCards;
    async function search() {
        if (!center) return status('Use your current location or tap a point on the map first.');
        activeRequest?.abort(); const controller = new AbortController(); activeRequest = controller;
        const request = ++generation;
        pins.clearLayers(); $('nearbyList').replaceChildren(); $('nearbyFilterStatus').textContent=''; status('Finding real nearby places…');
        const timeout = setTimeout(() => controller.abort(),30000);
        try {
            const params = new URLSearchParams({lat:center.lat,lon:center.lon,kind:mode,radius:$('nearbyRadius').value});
            const response = await fetch(API_URL + '/api/places/nearby?' + params,{signal:controller.signal});
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Live station search failed.');
            if (request !== generation) return;
            status(data.stations.length ? `${data.stations.length} mapped places found. Choose a card or pin.` : 'No mapped places found in this area. Try 10 km or another area.');
            data.stations.forEach(station => {
                const card = element('article',''); card.className='order-card';
                const brand = brandLabel(station);
                card.dataset.search=[brand,station.name,station.address].join(' ').toLowerCase().replace(/\s/g,'');
                const badge=element('p',mode==='fuel'?brand:'EV charging');
                badge.style.cssText='color:#2161ed;font-weight:700;margin-bottom:6px';
                card.append(badge);
                card.append(element('h2',station.name),element('p',station.address || 'Street address not available'),
                    element('p',station.distanceKm.toFixed(2)+' km straight-line from selected location'),
                    element('p',`Location: ${station.latitude.toFixed(6)}, ${station.longitude.toFixed(6)}`));
                if (station.hours) card.append(element('p','Mapped hours: '+station.hours));
                const popup = element('div',''); popup.append(element('strong',station.name),element('p',station.address || 'Address not listed'));
                const marker = FuzioMaps.marker([station.latitude,station.longitude]).addTo(pins).bindPopup(popup);
                marker.on('click',()=>card.scrollIntoView({behavior:'smooth',block:'nearest'}));
                const view = element('button','Show on map'); view.className='secondary-btn';
                view.onclick=()=>{map.setView([station.latitude,station.longitude],16);marker.openPopup();$('nearbyMap').scrollIntoView({behavior:'smooth',block:'center'});};
                const directions=element('a','Get driving directions ↗');
                directions.href='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(station.latitude+','+station.longitude)+'&travelmode=driving';
                directions.target='_blank';directions.rel='noopener';directions.style.cssText='display:block;padding:14px 0;color:#2161ed';
                card.append(view,directions);
                if (mode === 'fuel') {
                    const choose = element('button','Select this bunk for pickup');
                    choose.className='primary-btn';
                    choose.onclick=()=>{
                        window.selectedPickupStation = {...station};
                        let summary=document.getElementById('pickupSummary');
                        if(!summary) {
                            summary=element('div','');summary.id='pickupSummary';
                            document.getElementById('fuel').prepend(summary);
                        }
                        summary.replaceChildren(element('p',brand),element('h2','Pickup: '+station.name),element('p',station.address || 'Street address not listed'),element('p',`Selected pickup coordinates: ${station.latitude.toFixed(6)}, ${station.longitude.toFixed(6)}`),element('p','Your driver will collect fuel at this selected location. Choose your delivery location separately.'));
                        const change=element('button','Change petrol bunk');change.className='secondary-btn';
                        change.onclick=()=>openNearbyStations('fuel');summary.append(change);
                        showScreen('fuel');
                    };
                    card.append(choose);
                }
                $('nearbyList').append(card);
            });
            filterCards();
        } catch(error) {
            if (request === generation) status(error.name === 'AbortError' ? 'Search timed out. Please retry.' : 'Unable to load live places. '+error.message);
        } finally { clearTimeout(timeout); }
    }
    $('nearbyGps').onclick=()=>{
        if (!navigator.geolocation) return status('Location is unavailable. Tap the map to select an area.');
        const request = ++generation; activeRequest?.abort();status('Getting your current location…');
        FuzioLocation.getCurrentPosition(position=>{
            if (request !== generation) return;
            setCenter(position.coords.latitude,position.coords.longitude,'Detected device location');
            const accuracy=Math.round(position.coords.accuracy);
            $('nearbyAccuracy').textContent=Number.isFinite(accuracy)?`Estimated accuracy: ${accuracy} metres. ${accuracy>1000?'This is approximate; tap the map to correct the search point.':'Check the map pin before continuing.'}`:'Check the detected map pin before continuing.';
            search();
        },error=>{if(request === generation)status(error.message);});
    };
    $('nearbySearch').onclick=search;
    $('nearbyRadius').onchange=()=>{if(center)search();};
    window.openNearbyStations = kind => {
        generation++; activeRequest?.abort();mode=kind==='charging_station'?'charging_station':'fuel';
        showScreen('nearbyStations');
        $('nearbyTitle').textContent=mode==='fuel'?'Choose your petrol bunk':'Real EV charging locations';
        $('nearbyFilter').value=''; $('nearbyFilterStatus').textContent='';
        initialize();pins.clearLayers();$('nearbyList').replaceChildren();
        status('Tap Use my current location to search nearby, or select an area on the map.');
        if(center)search();
    };
    // Replace the entry into the old demo charging-station experience.
    window.openEV=()=>window.openNearbyStations('charging_station');
})();

