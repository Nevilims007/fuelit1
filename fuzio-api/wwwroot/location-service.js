// Browser location may come from Wi-Fi/network positioning, not a GPS receiver.
(() => {
    function message(error) {
        if(error.code===1) return 'Location permission is blocked for this website. Allow Location in site settings and Windows Location settings, then retry. You can also tap the map to select a place.';
        if(error.code===3) return 'Location detection timed out. Try again outdoors/on a phone, or zoom and tap the map to select your place.';
        return 'Your device could not determine its location, even if permission is ON. Keep Wi-Fi and Windows Location services on, or zoom and tap the map to select your place.';
    }
    function getCurrentPosition(success,failure=()=>{}) {
        if(!window.isSecureContext) return failure({code:2,message:'Open the public HTTPS Fuzio link or localhost. Do not open the HTML file directly.'});
        if(!navigator.geolocation) return failure({code:2,message:'This browser does not provide location. Select your place on the map.'});
        const read=options=>new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,options));
        read({enableHighAccuracy:false,timeout:12000,maximumAge:60000})
            .catch(error=>{
                if(error.code===1) throw error;
                return read({enableHighAccuracy:true,timeout:20000,maximumAge:0});
            })
            .then(position=>{
                if(!Number.isFinite(position.coords.latitude)||!Number.isFinite(position.coords.longitude))throw {code:2};
                success(position);
            })
            .catch(error=>failure({code:error.code||2,message:message(error)}));
    }
    window.FuzioLocation={getCurrentPosition,message};
})();

