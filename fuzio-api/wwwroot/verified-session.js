// Attach verified sessions only to the configured Fuzio API, never map/SMS providers.
(() => {
    try {const user=JSON.parse(localStorage.getItem('fuelitUser')||'null');if(user&&!user.sessionToken)localStorage.removeItem('fuelitUser');}catch{localStorage.removeItem('fuelitUser');}
    const original=window.fetch.bind(window);
    window.fetch=async(input,init={})=>{
        const url=new URL(input instanceof Request?input.url:input,location.href);
        const api=new URL(window.FUZIO_API_URL||'http://127.0.0.1:5087');
        if(url.origin!==api.origin||!url.pathname.startsWith('/api/'))return original(input,init);
        const user=JSON.parse(localStorage.getItem('fuelitUser')||'null');
        const headers=new Headers(input instanceof Request?input.headers:undefined);
        new Headers(init.headers).forEach((v,k)=>headers.set(k,v));
        if(user?.sessionToken)headers.set('Authorization','Bearer '+user.sessionToken);
        const response=await original(input,{...init,headers});
        if(response.status===401&&user?.sessionToken){
            localStorage.removeItem('fuelitUser');
            document.querySelectorAll('[data-delivery-secret]').forEach(el=>el.textContent='');
            window.showScreen?.('login');
        }
        return response;
    };
})();

