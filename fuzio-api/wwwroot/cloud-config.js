// Public API address only. Never put database/SMS credentials in this file.
(() => {
    window.FUZIO_API_URL = 'https://fuzio-api-cloud.onrender.com';
    const migrationKey = 'fuzioCloudSessionVersion';
    if (localStorage.getItem(migrationKey) !== '20260924') {
        // The old laptop server's tokens cannot authenticate against the cloud.
        localStorage.removeItem('fuelitUser');
        localStorage.setItem(migrationKey, '20260924');
    }
})();

