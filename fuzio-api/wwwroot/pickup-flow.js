// One-time reset of this app's cached test sessions, not unrelated site storage.
(() => {
    const resetVersion = 'pickup-reset-20260914';
    if (localStorage.getItem('fuzioResetVersion') !== resetVersion) {
        ['fuelitUser','fuzioWhatsAppRequest','fuzioWhatsAppLogin'].forEach(key=>localStorage.removeItem(key));
        localStorage.setItem('fuzioResetVersion',resetVersion);
    }
})();
function escapePickup(value) {
    return String(value || 'Pickup not available').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function pickupLinks(order) {
    const link = (lat,lon,label) => {
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
        return '<a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(lat+','+lon)+'&travelmode=driving">'+label+'</a><br>';
    };
    return escapePickup(order.pickupAddress || 'Selected bunk')+'<br>'+link(order.pickupLatitude,order.pickupLongitude,'1. Navigate to pickup bunk')+link(order.latitude,order.longitude,'2. Navigate to customer');
}

