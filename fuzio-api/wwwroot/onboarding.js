// Phone-first onboarding. Verification credentials stay in memory until registration.
(() => {
    const style = document.createElement('style');
    style.textContent = `
        #onboarding { padding:32px 24px 48px; }
        #onboarding .on-step { color:#2161ed;font-size:13px;font-weight:700;letter-spacing:1px;margin-bottom:16px; }
        #onboarding h1 { font-size:30px;line-height:1.2;margin-bottom:12px; }
        #onboarding p { line-height:1.6; }
        #onboarding label { display:block;font-weight:600;margin:20px 0 8px; }
        #onboarding input { width:100%;padding:16px;border:1px solid #ccd6e5;border-radius:12px;font:inherit; }
        #onboarding input:focus { outline:2px solid #2161ed;outline-offset:2px; }
        #onboarding button { cursor:pointer;font:inherit; }
        #onboarding .on-primary { width:100%;padding:17px;border:0;border-radius:12px;background:#2161ed;color:white;font-weight:700;margin-top:24px; }
        #onboarding button:disabled { opacity:.55;cursor:wait; }
        #onboarding .on-link { background:none;border:0;color:#2161ed;padding:12px 0; }
        #onboarding .on-role { width:100%;text-align:left;background:#f4f7ff;border:1px solid #d9e3f5;border-radius:16px;padding:22px;margin-top:16px;color:#071a3a; }
        #onboarding .on-role strong { display:block;font-size:21px;margin-bottom:8px; }
        #onboarding .on-role span { color:#60708b;line-height:1.5; }
        #onboarding .on-role:hover { border-color:#2161ed; }
        #onboarding .on-note { color:#60708b;font-size:14px; }
        #onboarding .on-message { color:#ad2525;background:#fff1f1;border-radius:10px;padding:12px; }
        #onboarding [hidden] { display:none!important; }
        #on-code { letter-spacing:8px;text-align:center;font-size:26px!important; }
    `;
    document.head.append(style);
    const screen = document.createElement('section');
    screen.id = 'onboarding';
    screen.className = 'screen';
    screen.innerHTML = `
        <div class="on-step" id="on-progress">STEP 1 OF 4 · MOBILE NUMBER</div>
        <div id="on-phone-step">
            <h1>Welcome to Fuzio</h1>
            <p class="subtitle">Fuel, charging and roadside help. Start with your mobile number.</p>
            <form id="on-phone-form">
                <label for="on-phone">Mobile number</label>
                <input id="on-phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="Enter your 10-digit number" maxlength="16" required>
                <p class="on-note">India (+91). We’ll send a verification code to this number.</p>
                <button class="on-primary" id="on-send">Send OTP</button>
            </form>
            <p class="on-note">Already have an account? Verify your number to sign in.</p>
        </div>
        <div id="on-otp-step" hidden>
            <button class="on-link" type="button" id="on-change">← Change mobile number</button>
            <h1>Verify your number</h1>
            <p class="subtitle" id="on-sent"></p>
            <form id="on-otp-form">
                <label for="on-code">6-digit OTP</label>
                <input id="on-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000">
                <button class="on-primary" id="on-verify">Verify & continue</button>
            </form>
            <button class="on-link" type="button" id="on-resend">Resend OTP</button>
        </div>
        <div id="on-role-step" hidden>
            <h1>How will you use Fuzio?</h1>
            <p class="subtitle">Your number is verified. Choose your account type.</p>
            <button class="on-role" type="button" data-role="Customer"><strong>I’m a customer</strong><span>Book fuel delivery, EV charging and roadside assistance.</span></button>
            <button class="on-role" type="button" data-role="Driver"><strong>I’m a driver</strong><span>View delivery requests and manage your deliveries.</span></button>
        </div>
        <div id="on-details-step" hidden>
            <button class="on-link" type="button" id="on-back-role">← Change account type</button>
            <h1 id="on-details-title">Your details</h1>
            <p class="on-note" id="on-verified-phone"></p>
            <form id="on-details-form">
                <label for="on-name">Full name</label>
                <input id="on-name" autocomplete="name" maxlength="100" required placeholder="Your full name">
                <p class="on-note" id="on-vehicle-help"></p>
                <label for="on-vehicle" id="on-vehicle-label">Vehicle name</label>
                <input id="on-vehicle" maxlength="80" placeholder="e.g. Tata Ace">
                <label for="on-plate" id="on-plate-label">Vehicle registration number</label>
                <input id="on-plate" maxlength="25" placeholder="e.g. TN 01 AB 1234" style="text-transform:uppercase">
                <button class="on-primary" id="on-finish">Create account & continue</button>
            </form>
        </div>
        <p id="on-message" class="on-message" role="alert" hidden></p>
    `;
    document.querySelector('.app').append(screen);
    const el = id => document.getElementById('on-' + id);
    let phone = '', confirmation = null, verifiedUser = null, role = '', busy = false;
    let resendAt = 0;
    const originalShowScreen = window.showScreen;
    const hasAccount = () => {
        try { return !!JSON.parse(localStorage.getItem('fuelitUser'))?.userId; }
        catch { localStorage.removeItem('fuelitUser'); return false; }
    };
    function message(text = '') {
        el('message').textContent = text;
        el('message').hidden = !text;
    }
    function step(name) {
        ['phone','otp','role','details'].forEach(value => el(value + '-step').hidden = value !== name);
        const titles = {phone:'1 OF 4 · MOBILE NUMBER',otp:'2 OF 4 · VERIFY OTP',role:'3 OF 4 · ACCOUNT TYPE',details:'4 OF 4 · YOUR DETAILS'};
        el('progress').textContent = 'STEP ' + titles[name];
        message();
        originalShowScreen('onboarding');
        const focus = {phone:'phone',otp:'code',role:null,details:'name'}[name];
        if (focus) el(focus).focus();
    }
    function lock(value) {
        busy = value;
        screen.querySelectorAll('button').forEach(button => button.disabled = value);
    }
    function errorText(error) {
        const errors = {
            'auth/billing-not-enabled':'SMS verification is unavailable until Firebase billing is enabled or another OTP provider is connected.',
            'auth/invalid-verification-code':'That code is incorrect. Please check your SMS and try again.',
            'auth/code-expired':'That OTP has expired. Request a new code.',
            'auth/too-many-requests':'Too many attempts. Please wait before trying again.',
            'auth/invalid-phone-number':'Enter a valid Indian mobile number.',
            'auth/operation-not-allowed':'Phone verification is not enabled for this app yet.'
        };
        return errors[error.code] || error.message || 'Something went wrong. Please try again.';
    }
    async function api(path, body) {
        let response;
        try { response = await fetch(API_URL + path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); }
        catch { throw new Error('Cannot connect to Fuzio server. Start FuelitAPI and try again.'); }
        let data;
        try { data = await response.json(); }
        catch { throw new Error('The server returned an unexpected response. Please try again.'); }
        if (!response.ok) throw new Error(data.message || 'Unable to complete your request.');
        return data;
    }
    function finish(data) {
        if (!data.userId || !['Customer','Driver'].includes(data.role)) throw new Error('Your account response is incomplete. Please try again.');
        localStorage.setItem('fuelitUser', JSON.stringify(data));
        verifiedUser = null;
        confirmation = null;
        updateLoginUI();
        originalShowScreen(data.role === 'Driver' ? 'driverDashboard' : 'home');
    }
    async function send(event) {
        event?.preventDefault();
        if (busy) return;
        const number = formatFirebasePhone(el('phone').value);
        if (!/^\+91[6-9]\d{9}$/.test(number)) return message('Enter a valid 10-digit Indian mobile number.');
        if (Date.now() < resendAt && number === phone) return message('Please wait a minute before requesting another OTP.');
        lock(true); message(); el('send').textContent = 'Sending OTP…';
        try {
            // Invalidate any old challenge before requesting a new one.
            confirmation = null; verifiedUser = null;
            confirmation = (await api('/api/auth/sms/send', {phone:number})).challengeId;
            phone = number; resendAt = Date.now() + 60000;
            el('sent').textContent = 'OTP requested for ' + phone + '. SMS may take a moment. Code expires in 5 minutes.';
            el('code').value = '';
            step('otp');
        } catch (error) { message(errorText(error)); }
        finally { lock(false); el('send').textContent = 'Send OTP'; }
    }
    el('phone-form').addEventListener('submit', send);
    el('resend').addEventListener('click', send);
    el('change').addEventListener('click', () => { confirmation = null; verifiedUser = null; step('phone'); });
    el('otp-form').addEventListener('submit', async event => {
        event.preventDefault(); if (busy) return;
        if (!confirmation && !verifiedUser) return message('Request a new OTP first.');
        lock(true); message(); el('verify').textContent = 'Verifying…';
        try {
            const data = await api('/api/auth/sms/verify', {challengeId:confirmation, code:el('code').value.trim()});
            verifiedUser = data.verificationToken || null;
            if (data.needsProfile) step('role'); else finish(data);
        } catch (error) { message(errorText(error)); }
        finally { lock(false); el('verify').textContent = 'Verify & continue'; }
    });
    screen.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => {
        if (!verifiedUser) return step('phone');
        role = button.dataset.role;
        const driver = role === 'Driver';
        el('details-title').textContent = driver ? 'Your driver profile' : 'Your customer profile';
        el('verified-phone').textContent = 'Verified mobile: ' + phone;
        el('vehicle-help').textContent = driver ? 'Tell us about the vehicle you’ll use for deliveries.' : 'Add your vehicle details now, or leave them empty.';
        el('vehicle-label').textContent = 'Vehicle name' + (driver ? '' : ' (optional)');
        el('plate-label').textContent = 'Vehicle registration number' + (driver ? '' : ' (optional)');
        el('vehicle').required = driver; el('plate').required = driver;
        step('details');
    }));
    el('back-role').addEventListener('click', () => step('role'));
    el('details-form').addEventListener('submit', async event => {
        event.preventDefault(); if (busy) return;
        if (!verifiedUser || !role) return step('phone');
        const name = el('name').value.trim(), vehicleName = el('vehicle').value.trim(), vehicleNumber = el('plate').value.trim().toUpperCase();
        if (!name) return message('Enter your full name.');
        if (role === 'Driver' && (!vehicleName || !vehicleNumber)) return message('Enter both vehicle details to continue.');
        lock(true); message(); el('finish').textContent = 'Creating your account…';
        try { finish(await api('/api/register', {name,role,phone,vehicleName,vehicleNumber,firebaseIdToken:verifiedUser})); }
        catch (error) { message(errorText(error)); }
        finally { lock(false); el('finish').textContent = 'Create account & continue'; }
    });
    // All old sign-in links lead to the same phone-first experience.
    window.showScreen = function(id) {
        if (id === 'login' || id === 'register' || (!hasAccount() && id !== 'onboarding')) { step('phone'); return; }
        originalShowScreen(id);
    };
    window.logoutUser = function() {
        localStorage.removeItem('fuelitUser');
        verifiedUser = null; confirmation = null; role = ''; phone = '';
        el('phone-form').reset(); el('details-form').reset(); el('otp-form').reset();
        firebaseAuth.signOut().catch(() => {});
        updateLoginUI(); step('phone');
    };
    if (whatsappApprovalTimer) clearInterval(whatsappApprovalTimer);
    if (whatsappLoginTimer) clearInterval(whatsappLoginTimer);
    if (!hasAccount()) step('phone');
})();

