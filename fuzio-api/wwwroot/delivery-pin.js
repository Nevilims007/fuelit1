(() => {
    for(const screenId of ['success','tracking','history']) {
        const screen=document.getElementById(screenId);if(!screen)continue;
        const box=document.createElement('div');box.className='summary-card';
        const heading=document.createElement('h2');heading.textContent='Delivery confirmation PIN';
        const note=document.createElement('p');note.textContent='Share this PIN with your driver only after receiving your fuel. This is not your login OTP.';
        const code=document.createElement('p');code.dataset.deliverySecret='';code.style.cssText='font-size:32px;letter-spacing:8px;font-weight:700';code.setAttribute('aria-live','polite');
        const button=document.createElement('button');button.className='secondary-btn';button.textContent='Show my delivery PIN';
        let selectedOrder='';
        if(screenId==='history') {
            const choose=document.createElement('select');choose.setAttribute('aria-label','Choose your active fuel order');
            const load=document.createElement('button');load.className='secondary-btn';load.textContent='Load my active delivery orders';
            choose.onchange=()=>{selectedOrder=choose.value;code.textContent='';};
            load.onclick=async()=>{
                code.textContent='';selectedOrder='';choose.replaceChildren();load.disabled=true;
                try {
                    const user=JSON.parse(localStorage.getItem('fuelitUser')||'null');
                    if(user?.role!=='Customer')throw new Error('Sign in as a customer to view your delivery PIN.');
                    const response=await fetch(API_URL+'/api/orders/user/'+encodeURIComponent(user.userId));
                    if(!response.ok)throw new Error('Could not load orders.');
                    const orders=await response.json();
                    for(const order of orders.filter(o=>!['Delivered','Cancelled'].includes(o.status))){const option=document.createElement('option');option.value=order.orderId;option.textContent=order.orderId+' — '+order.pickupStationName+' — '+order.status;choose.append(option);}
                    selectedOrder=choose.value;
                    note.textContent=selectedOrder?'Share your PIN only after receiving the fuel.':'No active fuel deliveries.';
                }catch(error){note.textContent=error.message;}finally{load.disabled=false;}
            };
            box.append(load,choose);
        }
        button.onclick=async()=>{
            code.textContent='';button.disabled=true;
            note.textContent='Share this PIN only after receiving your fuel. This is not your login OTP.';
            try {
                const id=screenId==='history'?selectedOrder:currentOrderId;
                if(!id)throw new Error('Select an order first.');
                const response=await fetch(API_URL+'/api/orders/'+encodeURIComponent(id)+'/delivery-pin',{cache:'no-store'});
                let data={};try{data=await response.json();}catch{}
                if(!response.ok)throw new Error(data.message||'Sign in as the customer who placed this order.');
                if((screenId==='history'?selectedOrder:currentOrderId)===id&&screen.classList.contains('active'))code.textContent=data.pin;
            }catch(error){note.textContent=error.message;}finally{button.disabled=false;}
        };
        new MutationObserver(()=>{if(!screen.classList.contains('active'))code.textContent='';}).observe(screen,{attributes:true,attributeFilter:['class']});
        box.append(heading,note,code,button);screen.append(box);
    }
    window.completeDelivery=()=>alert('After receiving your fuel, share your delivery PIN with the assigned driver. The driver must verify it to complete delivery.');
    let busy=false;
    window.completeDriverDelivery=async orderId=>{
        if(busy)return;
        const pin=prompt('Enter the customer’s 4-digit delivery PIN after handing over the fuel.');
        if(pin===null)return;
        if(!/^\d{4}$/.test(pin.trim()))return alert('Enter exactly 4 digits.');
        busy=true;
        try {
            const response=await fetch(API_URL+'/api/driver/orders/'+encodeURIComponent(orderId)+'/confirm-delivery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pin.trim()})});
            let data={};try{data=await response.json();}catch{}
            if(!response.ok)throw new Error(data.message||'Sign in as the assigned driver and mark arrival first.');
            alert('PIN verified. Delivery completed.');await loadAcceptedDriverOrder();
        }catch(error){alert(error.message);}finally{busy=false;}
    };
})();

