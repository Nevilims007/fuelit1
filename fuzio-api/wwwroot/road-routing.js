// Browser prototype routing. Replace public OSRM with a production service before launch.
window.FuzioRoadRoute = (() => {
    let generation=0, controller, lastRequest=0, metrics=null;
    const cache=new Map();
    const field=(id,value)=>document.querySelectorAll('[id="'+id+'"]').forEach(el=>el.textContent=value);
    function info(){field('trackingDistance',metrics ? (metrics.distance/1000).toFixed(2)+' km by road' : '—');field('trackingETA',metrics ? Math.max(1,Math.ceil(metrics.duration/60))+' min driving estimate' : '—');}
    function notice(text){document.getElementById('roadRouteStatus').textContent=text;}
    function valid(lat,lon){return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;}
    async function initialize(){
        const version=++generation; controller?.abort();controller=new AbortController();const signal=controller.signal;
        if(trackingTimer){clearInterval(trackingTimer);trackingTimer=null;}
        if(!trackingMap)trackingMap=FuzioMaps.map('trackingMap').setView([latitude||20.59,longitude||78.96],latitude||longitude?14:5);
        else trackingMap.invalidateSize();
        if(trackingRoute){trackingRoute.remove();trackingRoute=null;}
        trackingDriverMarker?.remove();trackingDriverMarker=null;
        trackingCustomerMarker?.remove();trackingCustomerMarker=null;
        metrics=null;info();notice('Finding the road route from your selected bunk…');
        const timer=setTimeout(()=>{if(version===generation)controller.abort();},25000);
        try {
            let pickup=window.selectedPickupStation, destination=[latitude,longitude];
            // Read the saved order, so a later bunk selection cannot change an existing order's route.
            if(currentOrderId){
                const user=JSON.parse(localStorage.getItem('fuelitUser')||'null');
                if(!user?.userId)throw new Error('Sign in to view this order route.');
                const response=await fetch(API_URL+'/api/orders/user/'+encodeURIComponent(user.userId),{signal});
                if(!response.ok)throw new Error('Could not load the saved order.');
                const orders=await response.json();const order=orders.find(o=>o.orderId===currentOrderId);
                if(!order?.pickupStationId)throw new Error('This order has no saved pickup bunk.');
                pickup={name:order.pickupStationName,latitude:order.pickupLatitude,longitude:order.pickupLongitude};
                destination=[order.latitude,order.longitude];
            }
            if(version!==generation)return;
            if(!pickup||!valid(pickup.latitude,pickup.longitude)||!valid(...destination))throw new Error('Choose a pickup bunk and delivery location first.');
            trackingDriverMarker=FuzioMaps.marker([pickup.latitude,pickup.longitude]).addTo(trackingMap).bindPopup('Pickup bunk: '+pickup.name);
            trackingCustomerMarker=FuzioMaps.marker(destination).addTo(trackingMap).bindPopup('Your delivery location');
            const key=[pickup.longitude,pickup.latitude,destination[1],destination[0]].map(n=>n.toFixed(6)).join(',');
            let route=cache.get(key);
            if(!route){
                if(Date.now()-lastRequest<1500)throw new Error('Please wait a moment before retrying.');
                lastRequest=Date.now();
                const coordinates=`${pickup.longitude},${pickup.latitude};${destination[1]},${destination[0]}`;
                const response=await fetch('https://router.project-osrm.org/route/v1/driving/'+coordinates+'?overview=full&geometries=geojson&steps=false&alternatives=false&radiuses=1000;1000',{signal});
                if(!response.ok)throw new Error('Routing service unavailable. Please retry later.');
                const data=await response.json();route=data.routes?.[0];
                if(data.code!=='Ok'||route?.geometry?.type!=='LineString'||route.geometry.coordinates.length<2)throw new Error('No driving route found near these locations. Check the delivery pin.');
                if(!Number.isFinite(route.distance)||!Number.isFinite(route.duration)||!route.geometry.coordinates.every(p=>valid(p[1],p[0])))throw new Error('Routing service returned invalid data.');
                route={...route,snapDistances:(data.waypoints||[]).map(w=>w.distance||0)};
                if(cache.size>=20)cache.clear();cache.set(key,route);
            }
            if(version!==generation)return;
            trackingRoute=FuzioMaps.polyline(route.geometry.coordinates.map(([lon,lat])=>[lat,lon]),{color:'#2161ed',weight:5,opacity:0.85}).addTo(trackingMap);
            trackingMap.fitBounds(trackingRoute.getBounds(),{padding:[40,40]});metrics=route;info();
            const gap=Math.round(Math.max(0,...route.snapDistances));
            notice('Road route: '+pickup.name+' → delivery location. Not live driver tracking. '+(gap>50?`A pin is about ${gap} m from the mapped road; the blue line ends on the nearest routable road.`:'Route follows mapped roads.'));
        } catch(error){if(version===generation)notice(error.name==='AbortError'?'Route request timed out. Tap Retry road route.':error.message);}
        finally{clearTimeout(timer);}
    }
    return {initialize,info};
})();

