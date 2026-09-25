// MapLibre-backed map helpers. App coordinates stay [latitude, longitude].
// No Leaflet runtime or OSM raster tile requests.
window.FuzioMaps = (() => {
    const coords = point => [point[1], point[0]];
    let sequence=0;
    function map(id) {
        const container=document.getElementById(id);
        if (!window.maplibregl) {
            container.textContent='Map library could not load. Check your internet connection.';
            throw new Error('MapLibre is unavailable');
        }
        const notice=document.createElement('p');
        notice.setAttribute('role','status');
        notice.textContent='Loading map…';container.after(notice);
        let native;
        try {
            native=new maplibregl.Map({container:id,style:'https://tiles.openfreemap.org/styles/liberty',center:[78.96,20.59],zoom:5,maxZoom:19,attributionControl:true});
        } catch(error) {notice.textContent='Map unavailable. Enable browser graphics acceleration and reload.';throw error;}
        native.addControl(new maplibregl.NavigationControl(),'top-left');
        native.on('load',()=>{notice.textContent='';});
        native.on('error',()=>{notice.textContent='Some map data could not load. Check your connection; nearby place cards can still be used.';});
        const api={native,
            setView(point,zoom){native.jumpTo({center:coords(point),zoom});return api;},
            invalidateSize(){requestAnimationFrame(()=>native.resize());return api;},
            on(type,handler){native.on(type,event=>handler({...event,latlng:event.lngLat,target:api}));return api;},
            removeLayer(layer){layer.remove();return api;},
            fitBounds(bounds,options={}){native.fitBounds(bounds,{padding:options.padding?.[0]||40,maxZoom:17,duration:0});return api;}
        };
        new ResizeObserver(()=>native.resize()).observe(container);
        return api;
    }
    function marker(point,options={}) {
        const native=new maplibregl.Marker({color:options.fillColor||'#2161ed',draggable:!!options.draggable}).setLngLat(coords(point));
        let owner;
        const api={
            addTo(target){owner=target.native?target:target.map;native.addTo(owner.native);target.items?.add(api);return api;},
            bindPopup(content){const popup=new maplibregl.Popup({offset:25});if(typeof content==='string')popup.setText(content);else popup.setDOMContent(content);native.setPopup(popup);return api;},
            openPopup(){if(!native.getPopup()?.isOpen())native.togglePopup();return api;},
            setLatLng(point){native.setLngLat(coords(point));return api;},
            getLatLng(){return native.getLngLat();},
            on(type,handler){if(type==='click')native.getElement().addEventListener('click',event=>{event.stopPropagation();handler({target:api});});else native.on(type,()=>handler({target:api}));return api;},
            remove(){native.remove();return api;}
        };return api;
    }
    function layerGroup(){return {items:new Set(),map:null,addTo(map){this.map=map;return this;},clearLayers(){this.items.forEach(item=>item.remove());this.items.clear();}};}
    function polyline(points,options={}) {
        const id='fuzio-line-'+(++sequence);let map,removed=false;
        const api={
            addTo(owner){map=owner.native;const draw=()=>{if(removed)return;map.addSource(id,{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:points.map(coords)}}});map.addLayer({id,type:'line',source:id,paint:{'line-color':options.color||'#2161ed','line-width':options.weight||4,'line-opacity':options.opacity??1}});};if(map.isStyleLoaded())draw();else map.once('load',draw);return api;},
            remove(){removed=true;if(map?.getLayer(id))map.removeLayer(id);if(map?.getSource(id))map.removeSource(id);},
            getBounds(){const bounds=new maplibregl.LngLatBounds();points.forEach(point=>bounds.extend(coords(point)));return bounds;}
        };return api;
    }
    function latLng(lat,lng){return {lat,lng,distanceTo(other){const r=Math.PI/180;const h=Math.sin((other.lat-lat)*r/2)**2+Math.cos(lat*r)*Math.cos(other.lat*r)*Math.sin((other.lng-lng)*r/2)**2;return 6371000*2*Math.asin(Math.sqrt(Math.min(1,h)));}};}
    return {map,marker,circleMarker:marker,layerGroup,polyline,latLng};
})();

