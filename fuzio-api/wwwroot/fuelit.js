// ======================================================
// FUELIT JAVASCRIPT
// ======================================================

const API_URL = window.FUZIO_API_URL || "http://127.0.0.1:5087";
const FUZIO_WHATSAPP_NUMBER = "919677345839";

const firebaseConfig = {
    apiKey: "AIzaSyDOLUtE4lTwcIsXrVD1GTNpGDTKE8jcdb0",
    authDomain: "fuzio-f8103.firebaseapp.com",
    projectId: "fuzio-f8103",
    storageBucket: "fuzio-f8103.firebasestorage.app",
    messagingSenderId: "726897151233",
    appId: "1:726897151233:web:5242f15e47f650d9491f00",
    measurementId: "G-CG0J10EHNN"
};

firebase.initializeApp(firebaseConfig);
const firebaseAuth = firebase.auth();
firebaseAuth.useDeviceLanguage();

let registrationConfirmation = null;
let loginConfirmation = null;
let activeRecaptchaVerifier = null;
let whatsappApprovalTimer = null;
let whatsappLoginTimer = null;

function formatFirebasePhone(phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 10) return "+91" + digits;
    return "+" + digits;
}

function createRecaptcha() {
    if (!activeRecaptchaVerifier) {
        activeRecaptchaVerifier = new firebase.auth.RecaptchaVerifier(
            "firebaseRecaptcha",
            { size: "invisible" }
        );
    }

    return activeRecaptchaVerifier;
}

async function resetRecaptcha() {
    if (!activeRecaptchaVerifier) return;

    try {
        const widgetId = await activeRecaptchaVerifier.render();
        if (window.grecaptcha) {
            window.grecaptcha.reset(widgetId);
        }
    } catch (error) {
        console.warn("Could not reset reCAPTCHA", error);
    }
}

let customerStatusTimer = null;

let PETROL_PRICE = 111;
let DIESEL_PRICE = 100;

let currentOrderId = "";

let FUEL_PRICE = PETROL_PRICE;
const ASSISTANCE_FEE = 30;

let historyFuelOrders = [];
let historyEVBookings = [];

let selectedFuel = "Petrol";
let selectedAmount = 100;
let selectedPayment = "Cash";

let latitude = 0;
let longitude = 0;

let locationMap = null;
let locationMarker = null;

let evMap = null;

let trackingMap = null;
let trackingCustomerMarker = null;
let trackingDriverMarker = null;
let trackingRoute = null;
let trackingTimer = null;

let demoDriverLat = 0;
let demoDriverLng = 0;

let selectedEVStation = "";
let selectedEVChargerType = "";
let selectedEVPrice = 0;
let selectedEVSlot = "";

async function loadDailyFuelPrices() {

    try {

        const response =
            await fetch(
                API_URL +
                "/api/fuelprice?city=Chennai"
            );

        const data =
            await response.json();

        if (!response.ok) {
            console.error(
                "Fuel price error:",
                data
            );
            return;
        }

        PETROL_PRICE =
            Number(data.petrol);

        DIESEL_PRICE =
            Number(data.diesel);

        if (selectedFuel === "Petrol") {
            FUEL_PRICE = PETROL_PRICE;
        } else {
            FUEL_PRICE = DIESEL_PRICE;
        }

        updateFuelDisplay();

    } catch (error) {

        console.error(
            "Could not load daily fuel price:",
            error
        );
    }
}
// ======================================================
// SCREEN NAVIGATION
// ======================================================

function showScreen(screenId) {

    if (
        screenId !== "tracking" &&
        customerStatusTimer
    ) {
        clearInterval(customerStatusTimer);
        customerStatusTimer = null;
    }

    document.querySelectorAll(".screen").forEach(screen => {
        screen.classList.remove("active");
    });

    const screen = document.getElementById(screenId);

    if (screen) {
        screen.classList.add("active");
    }

    if (screenId === "location") {
        setTimeout(initializeLocationMap, 200);
    }

    if (screenId === "ev") {
        setTimeout(initializeEVMap, 200);
    }
    
    if (screenId === "tracking") {

        setTimeout(initializeTrackingMap, 200);

        loadCustomerOrderStatus();

        if (customerStatusTimer) {
            clearInterval(customerStatusTimer);
        }

        customerStatusTimer =
            setInterval(
                loadCustomerOrderStatus,
                3000
            );
    }

    if (screenId === "history") {
        loadHistory();
    }
    if (screenId === "driverDashboard") {
        loadDriverOrders();
        loadAcceptedDriverOrder();
    }
    filterHistory("all");
}


// ======================================================
// HOME
// ======================================================

function openFuel() {
    openNearbyStations("fuel");
}

function openEV() {
    showScreen("ev");
}


// ======================================================
// REGISTER
// ======================================================

function validateRegistrationForm() {

    const name =
        document.getElementById("registerName").value.trim();

    const role =
        document.getElementById("registerRole").value;

    const phone =
        document.getElementById("registerPhone").value.trim();

    const vehicleName =
        document.getElementById("registerVehicleName").value.trim();

    const vehicleNumber =
        document.getElementById("registerVehicleNumber").value.trim();


    if (!name || !phone) {
        alert("Please enter your name and mobile number.");
        return null;
    }

    if (!/^\+?[0-9]{10,15}$/.test(phone)) {
        alert("Please enter a valid mobile number.");
        return null;
    }


    if (role === "Driver") {

        if (!vehicleName || !vehicleNumber) {
            alert(
                "Driver must enter vehicle name and vehicle number."
            );
            return null;
        }
    }

    return { name, role, phone, vehicleName, vehicleNumber };
}

async function openWhatsAppVerification() {
    const form = validateRegistrationForm();
    if (!form) return;

    const whatsappWindow = window.open("about:blank", "_blank");

    try {
        const response = await fetch(
            API_URL + "/api/whatsapp/registration-request",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form)
            }
        );

        const data = await response.json();
        if (!response.ok) {
            if (whatsappWindow) whatsappWindow.close();
            alert(data.message || "Could not create verification request.");
            return;
        }

        localStorage.setItem("fuzioWhatsAppRequest", data.requestCode);

        const message = [
            "Hello Fuzio, I want to verify my account.",
            "Request code: " + data.requestCode,
            "Name: " + form.name,
            "Mobile: " + formatFirebasePhone(form.phone),
            "Role: " + form.role
        ].join("\n");

        const whatsappUrl =
            "https://wa.me/" +
            FUZIO_WHATSAPP_NUMBER +
            "?text=" +
            encodeURIComponent(message);

        if (whatsappWindow) {
            whatsappWindow.location.href = whatsappUrl;
        } else {
            window.location.href = whatsappUrl;
        }

        showWhatsAppApprovalStatus(data.requestCode);
    } catch (error) {
        if (whatsappWindow) whatsappWindow.close();
        console.error(error);
        alert("Cannot connect to Fuzio server.");
    }
}

function showWhatsAppApprovalStatus(requestCode) {
    const statusBox = document.getElementById("whatsappApprovalStatus");
    if (statusBox) {
        statusBox.style.display = "block";
        statusBox.textContent = "⏳ Waiting for admin approval — " + requestCode;
    }

    if (whatsappApprovalTimer) clearInterval(whatsappApprovalTimer);
    checkWhatsAppApproval(requestCode);
    whatsappApprovalTimer = setInterval(
        () => checkWhatsAppApproval(requestCode),
        3000
    );
}

async function checkWhatsAppApproval(requestCode) {
    try {
        const response = await fetch(
            API_URL + "/api/whatsapp/registration-status/" +
            encodeURIComponent(requestCode)
        );

        if (!response.ok) return;
        const data = await response.json();

        if (data.status === "Approved") {
            clearInterval(whatsappApprovalTimer);
            whatsappApprovalTimer = null;
            localStorage.removeItem("fuzioWhatsAppRequest");
            localStorage.setItem("fuelitUser", JSON.stringify(data));
            updateLoginUI();
            alert("Registration approved! Welcome to Fuzio 🎉");

            if (data.role === "Driver") {
                showScreen("driverDashboard");
            } else {
                showScreen("home");
            }
        }
    } catch (error) {
        console.error("Approval status check failed", error);
    }
}

function resumeWhatsAppApproval() {
    const requestCode = localStorage.getItem("fuzioWhatsAppRequest");
    if (requestCode) showWhatsAppApprovalStatus(requestCode);
}

async function sendRegistrationOtp() {
    const form = validateRegistrationForm();
    if (!form) return;

    const sendButton = document.getElementById("sendRegisterOtpBtn");
    if (sendButton.disabled) return;

    sendButton.disabled = true;
    sendButton.textContent = "⏳ SENDING OTP...";

    try {
        const verifier = createRecaptcha();
        registrationConfirmation = await firebaseAuth.signInWithPhoneNumber(
            formatFirebasePhone(form.phone),
            verifier
        );

        document.getElementById("registrationOtpFields").style.display = "block";
        document.getElementById("registerOtp").focus();
        sendButton.textContent = "🔁 RESEND OTP";
        alert("OTP sent to your mobile number.");
    } catch (error) {
        console.error(error);
        await resetRecaptcha();
        sendButton.textContent = "📱 SEND REGISTRATION OTP";
        alert(error.message || "Unable to send OTP. Check Firebase phone settings.");
    } finally {
        sendButton.disabled = false;
    }
}

async function verifyRegistrationOtp() {
    const form = validateRegistrationForm();
    const otp = document.getElementById("registerOtp").value.trim();

    if (!form || !registrationConfirmation) {
        alert("Please send the OTP first.");
        return;
    }

    if (!/^\d{6}$/.test(otp)) {
        alert("Please enter the 6-digit OTP.");
        return;
    }

    try {
        const credential = await registrationConfirmation.confirm(otp);
        const firebaseIdToken = await credential.user.getIdToken();

        const response = await fetch(
            API_URL + "/api/register",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    name: form.name,
                    role: form.role,
                    phone: formatFirebasePhone(form.phone),
                    vehicleName: form.vehicleName,
                    vehicleNumber: form.vehicleNumber,
                    firebaseIdToken: firebaseIdToken
                })
            }
        );

        const data = await response.json();

        if (response.ok) {

            alert("Registration successful! 🎉");
            localStorage.setItem("fuelitUser", JSON.stringify(data));
            updateLoginUI();

            if (data.role === "Driver") {
                showScreen("driverDashboard");
            } else {
                showScreen("home");
            }

        } else {

            alert(
                data.message ||
                "Registration failed."
            );
        }

    } catch (error) {

        console.error(error);

        alert(
            "Cannot connect to Fuzio server." +
            "Make sure C# is running."
        );
    }
}
// ======================================================
// LOGIN
// ======================================================

async function sendLoginOtp() {

    const phone =
        document.getElementById("loginPhone").value.trim();

    if (!/^\+?[0-9]{10,15}$/.test(phone)) {
        alert("Please enter a valid mobile number.");
        return;
    }

    const sendButton = document.getElementById("sendOtpBtn");
    if (sendButton.disabled) return;

    sendButton.disabled = true;
    sendButton.textContent = "⏳ SENDING OTP...";

    try {
        const verifier = createRecaptcha();
        loginConfirmation = await firebaseAuth.signInWithPhoneNumber(
            formatFirebasePhone(phone),
            verifier
        );

        document.getElementById("otpLoginFields").style.display = "block";
        document.getElementById("loginOtp").focus();
        document.getElementById("otpHelpText").textContent =
            "OTP sent to your mobile number.";

        sendButton.textContent = "🔁 RESEND OTP";

    } catch (error) {
        console.error(error);
        await resetRecaptcha();
        sendButton.textContent = "📱 SEND OTP";
        alert(error.message || "Unable to send OTP. Check Firebase phone settings.");
    } finally {
        sendButton.disabled = false;
    }
}

async function openWhatsAppLogin() {
    const phone = document.getElementById("loginPhone").value.trim();
    if (!/^\+?[0-9]{10,15}$/.test(phone)) {
        alert("Please enter a valid mobile number.");
        return;
    }

    const whatsappWindow = window.open("about:blank", "_blank");

    try {
        const response = await fetch(API_URL + "/api/whatsapp/login-request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone: formatFirebasePhone(phone) })
        });

        const data = await response.json();
        if (!response.ok) {
            if (whatsappWindow) whatsappWindow.close();
            alert(data.message || "Could not create login request.");
            return;
        }

        localStorage.setItem("fuzioWhatsAppLogin", data.requestCode);
        const message = [
            "Hello Fuzio, please approve my login.",
            "Request code: " + data.requestCode,
            "Mobile: " + formatFirebasePhone(phone)
        ].join("\n");

        const whatsappUrl = "https://wa.me/" + FUZIO_WHATSAPP_NUMBER +
            "?text=" + encodeURIComponent(message);

        if (whatsappWindow) whatsappWindow.location.href = whatsappUrl;
        else window.location.href = whatsappUrl;

        showWhatsAppLoginStatus(data.requestCode);
    } catch (error) {
        if (whatsappWindow) whatsappWindow.close();
        console.error(error);
        alert("Cannot connect to Fuzio server.");
    }
}

function showWhatsAppLoginStatus(requestCode) {
    const statusBox = document.getElementById("whatsappLoginStatus");
    if (statusBox) {
        statusBox.style.display = "block";
        statusBox.textContent = "⏳ Waiting for login approval — " + requestCode;
    }

    if (whatsappLoginTimer) clearInterval(whatsappLoginTimer);
    checkWhatsAppLoginApproval(requestCode);
    whatsappLoginTimer = setInterval(
        () => checkWhatsAppLoginApproval(requestCode),
        3000
    );
}

async function checkWhatsAppLoginApproval(requestCode) {
    try {
        const response = await fetch(
            API_URL + "/api/whatsapp/login-status/" + encodeURIComponent(requestCode)
        );
        if (!response.ok) return;

        const data = await response.json();
        if (data.status === "Approved") {
            clearInterval(whatsappLoginTimer);
            whatsappLoginTimer = null;
            localStorage.removeItem("fuzioWhatsAppLogin");
            localStorage.setItem("fuelitUser", JSON.stringify(data));
            updateLoginUI();
            alert("Login approved! Welcome back to Fuzio 🎉");

            if (data.role === "Driver") showScreen("driverDashboard");
            else showScreen("home");
        }
    } catch (error) {
        console.error("Login approval status check failed", error);
    }
}

function resumeWhatsAppLogin() {
    const requestCode = localStorage.getItem("fuzioWhatsAppLogin");
    if (requestCode) showWhatsAppLoginStatus(requestCode);
}

async function verifyLoginOtp() {
    const phone = document.getElementById("loginPhone").value.trim();
    const otp = document.getElementById("loginOtp").value.trim();

    if (!/^\d{6}$/.test(otp)) {
        alert("Please enter the 6-digit OTP.");
        return;
    }

    if (!loginConfirmation) {
        alert("Please send the OTP first.");
        return;
    }

    try {
        const credential = await loginConfirmation.confirm(otp);
        const firebaseIdToken = await credential.user.getIdToken();

        const response = await fetch(
            API_URL + "/api/auth/firebase-login",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    phone: formatFirebasePhone(phone),
                    firebaseIdToken: firebaseIdToken
                })
            }
        );

        const data = await response.json();

        if (response.ok) {

            localStorage.setItem(
                "fuelitUser",
                JSON.stringify(data)
            );

            updateLoginUI();

            

                if (data.role === "Driver") {
                    showScreen("driverDashboard");
                } else {
                    showScreen("home");
                }

            alert(
                data.message || "Login successful!"
            );
        } else {
            alert(data.message || "Invalid or expired OTP.");
        }

    } catch (error) {
        console.error(error);
        alert("Cannot connect to Fuzio server.");
    }
}


// ======================================================
// FUEL SELECTION
// ======================================================

function selectFuel(fuel) {

    selectedFuel = fuel;

        if (fuel === "Petrol") {
            FUEL_PRICE = PETROL_PRICE;
        } else {
            FUEL_PRICE = DIESEL_PRICE;
        }


    document.getElementById(
        "petrolBtn"
    ).classList.toggle(
        "selected",
        fuel === "Petrol"
    );


    document.getElementById(
        "dieselBtn"
    ).classList.toggle(
        "selected",
        fuel === "Diesel"
    );


    updateFuelDisplay();
}


// ======================================================
// AMOUNT SELECTION
// ======================================================

function selectAmount(amount) {

    selectedAmount = Number(amount);


    document.getElementById(
        "customAmount"
    ).value = selectedAmount;


    document.querySelectorAll(
        ".amount-btn"
    ).forEach(btn => {

        btn.classList.remove("selected");

    });


    const buttonMap = {
        100: "amount100",
        200: "amount200",
        500: "amount500",
        1000: "amount1000"
    };


    if (buttonMap[amount]) {

        document.getElementById(
            buttonMap[amount]
        ).classList.add("selected");
    }


    updateFuelDisplay();
}


// ======================================================
// CUSTOM AMOUNT
// ======================================================

function customAmountChanged() {

    const value =
        Number(
            document.getElementById(
                "customAmount"
            ).value
        );


    selectedAmount = value || 0;


    document.querySelectorAll(
        ".amount-btn"
    ).forEach(btn => {

        btn.classList.remove("selected");

    });


    updateFuelDisplay();
}


// ======================================================
// FUEL CALCULATION
// ======================================================

function updateFuelDisplay() {

    const quantity =
        selectedAmount / FUEL_PRICE;

    document.getElementById(
        "fuelPrice"
    ).textContent =
        "₹" + FUEL_PRICE + "/L";

    document.getElementById(
        "selectedAmount"
    ).textContent =
        "₹" + selectedAmount;

    document.getElementById(
        "fuelQuantity"
    ).textContent =
        quantity.toFixed(2) + " L";
}

// ======================================================
// LOCATION
// ======================================================

function openLocationPicker() {

    if (selectedAmount <= 0) {

        alert(
            "Please select a valid amount."
        );

        return;
    }


    showScreen("location");
}


// ======================================================
// MAP INITIALIZATION
// ======================================================

function initializeLocationMap() {

    if (locationMap) {

        locationMap.invalidateSize();

        return;
    }


    locationMap = FuzioMaps.map(
        "locationMap"
    ).setView(
        [20.5937, 78.9629],
        5
    );


    locationMap.on(
        "click",
        function(event) {

            setLocation(
                event.latlng.lat,
                event.latlng.lng
            );

        }
    );
}


// ======================================================
// GPS LOCATION
// ======================================================

function getMyLocation() {

    if (!navigator.geolocation) {

        alert(
            "Geolocation is not supported by your browser."
        );

        return;
    }


    FuzioLocation.getCurrentPosition(

        function(position) {

            setLocation(
                position.coords.latitude,
                position.coords.longitude
            );

        },

        function(error) {

            console.error(error);

            alert(
                error.message
            );
        },

        {
            enableHighAccuracy: true,
            timeout: 10000
        }
    );
}


// ======================================================
// SET LOCATION
// ======================================================

function setLocation(lat, lng) {

    latitude = lat;
    longitude = lng;


    if (!locationMap) {
        initializeLocationMap();
    }


    locationMap.setView(
        [lat, lng],
        16
    );


    if (locationMarker) {

        locationMarker.setLatLng(
            [lat, lng]
        );

    } else {

        locationMarker =
            FuzioMaps.marker(
                [lat, lng],
                {
                    draggable: true
                }
            ).addTo(locationMap);


        locationMarker.on(
            "dragend",
            function(event) {

                const position =
                    event.target.getLatLng();

                setLocation(
                    position.lat,
                    position.lng
                );
            }
        );
    }


    const text =
        lat.toFixed(6) +
        ", " +
        lng.toFixed(6);


    document.getElementById(
        "selectedLocation"
    ).textContent = text;


    document.getElementById(
        "homeLocation"
    ).textContent = text;
}


// ======================================================
// CONTINUE TO PAYMENT
// ======================================================

function continueToPayment() {

    if (latitude === 0 && longitude === 0) {

        alert(
            "Please select your location first."
        );

        return;
    }


    updateSummary();

    showScreen("payment");
}


// ======================================================
// PAYMENT
// ======================================================

function selectPayment(payment) {

    selectedPayment = payment;

    const upiBox =
    document.getElementById("upiBox");

if (payment === "UPI") {

    upiBox.style.display = "block";

} else {

    upiBox.style.display = "none";
}


    document.getElementById(
        "cashBtn"
    ).classList.toggle(
        "selected",
        payment === "Cash"
    );


    document.getElementById(
        "upiBtn"
    ).classList.toggle(
        "selected",
        payment === "UPI"
    );

    document.getElementById(
        "upiAmount"
    ).textContent =
        "Amount: ₹" +
    (
        selectedAmount +
        ASSISTANCE_FEE
    );


    updateSummary();
}


// ======================================================
// SUMMARY
// ======================================================

function updateSummary() {

    const quantity =
        selectedAmount / FUEL_PRICE;


    const total =
        selectedAmount +
        ASSISTANCE_FEE;


    document.getElementById(
        "summaryFuel"
    ).textContent =
        selectedFuel;


    document.getElementById(
        "summaryQuantity"
    ).textContent =
        quantity.toFixed(2) + " L";


    document.getElementById(
        "summaryAmount"
    ).textContent =
        "₹" + selectedAmount;


    document.getElementById(
        "summaryTotal"
    ).textContent =
        "₹" + total;
}


// ======================================================
// PLACE ORDER
// ======================================================

async function placeOrder() {
    if (!window.selectedPickupStation) {
        alert("Choose your petrol bunk first.");
        openNearbyStations("fuel");
        return;
    }

    const user =
        JSON.parse(
            localStorage.getItem(
                "fuelitUser"
            )
        );


    if (!user) {

        alert(
            "Please login before placing an order."
        );

        showScreen("login");

        return;
    }


    if (latitude === 0 &&
        longitude === 0) {

        alert(
            "Please select your location."
        );

        showScreen("location");

        return;
    }


    const quantity =
        selectedAmount / FUEL_PRICE;


    try {

        const response = await fetch(
            API_URL + "/api/orders",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({

                    userId: user.userId,

                    fuelType: selectedFuel,

                    amount: selectedAmount,

                    quantity: quantity,

                    payment: selectedPayment,

                    latitude: latitude,

                    longitude: longitude,
                    pickupStationId: window.selectedPickupStation.id,
                    pickupStationName: window.selectedPickupStation.name,
                    pickupAddress: window.selectedPickupStation.address,
                    pickupLatitude: window.selectedPickupStation.latitude,
                    pickupLongitude: window.selectedPickupStation.longitude
                })
            }
        );


        const data =
            await response.json();


        if (response.ok) {

            document.getElementById(
                "successOrderId"
            ).textContent =
                data.orderId;
            
        currentOrderId = data.orderId;

            document.getElementById(
                "successFuel"
            ).textContent =
                data.fuelType;


            document.getElementById(
                "successQuantity"
            ).textContent =
                Number(data.quantity)
                    .toFixed(2) + " L";


            document.getElementById(
                "successPayment"
            ).textContent =
                data.payment;


            document.getElementById(
                "successTotal"
            ).textContent =
                "₹" +
                (
                    Number(data.amount) +
                    ASSISTANCE_FEE
                );


            showScreen("success");

        } else {

            alert(
                data.message ||
                "Order failed."
            );
        }

    } catch (error) {

        console.error(error);

        alert(
            "Cannot connect to Fuelit server."
        );
    }
}


// ======================================================
// ORDER HISTORY
// ======================================================

async function showHistory() {

    showScreen("history");

    await loadHistory();
}


async function loadHistory() {

    const user =
        JSON.parse(
            localStorage.getItem(
                "fuelitUser"
            )
        );

    const historyList =
        document.getElementById(
            "historyList"
        );


    if (!user) {

        historyList.innerHTML = `
            <p class="subtitle">
                Please login to see your order history.
            </p>
        `;

        return;
    }


    try {

        const fuelResponse =
            await fetch(
                API_URL +
                "/api/orders/user/" +
                user.userId
            );


        const evResponse =
            await fetch(
                API_URL +
                "/api/ev/user/" +
                user.userId
            );


        const fuelOrders =
            await fuelResponse.json();

        const evBookings =
            await evResponse.json();

        historyFuelOrders = fuelOrders;
        historyEVBookings = evBookings;
            
        let historyHTML = "";


        // =========================
        // FUEL ORDERS
        // =========================

        if (fuelOrders.length > 0) {

            historyHTML += `
                <h2>⛽ Fuel Orders</h2>
            `;


            historyHTML +=
                fuelOrders.map(order => `

                    <div class="order-card">

                        <div class="order-id">
                            ${order.orderId}
                        </div>

                        <p>
                            ⛽ ${order.fuelType}
                        </p>

                        <p>
                            💧 ${Number(order.quantity).toFixed(2)} L
                        </p>

                        <p>
                            💰 ₹${order.amount}
                        </p>

                        <p>
                            💳 ${order.payment}
                        </p>

                        <div class="status">
                            ${order.status}
                        </div>
                        <div class="status">
                            ${booking.status}
                        </div>

                    
                    </div>

                `).join("");
        }


        // =========================
        // EV BOOKINGS
        // =========================

        if (evBookings.length > 0) {

            historyHTML += `
                <h2 style="margin-top:30px;">
                    ⚡ EV Bookings
                </h2>
            `;


            historyHTML +=
                evBookings.map(booking => `

                    <div class="order-card">

                        <div class="order-id">
                            ${booking.bookingId}
                        </div>

                        <p>
                            ⚡ ${booking.stationName}
                        </p>

                        <p>
                            🔌 ${booking.chargerType}
                        </p>

                        <p>
                            🕒 ${booking.timeSlot}
                        </p>

                        <p>
                            💰 ₹${booking.pricePerKwh} / kWh
                        </p>

                        <div class="status">
                            ${booking.status}
                        </div>

                        <button class="secondary-btn"
                                onclick="cancelEVBooking('${booking.bookingId}')"
                                style="border-color:#d92d20;color:#d92d20;">
                            ❌ CANCEL EV BOOKING
                        </button>

                    </div>

                `).join("");
        }


        if (
            fuelOrders.length === 0 &&
            evBookings.length === 0
        ) {

            historyHTML = `
                <p class="subtitle">
                    No orders or bookings yet.
                </p>
            `;
        }


        historyList.innerHTML =
            historyHTML;


    } catch (error) {

        console.error(error);

        historyList.innerHTML = `
            <p>
                Could not load history.
            </p>
        `;
    }
}


// ======================================================
// EV MAP
// ======================================================

function initializeEVMap() {

    if (evMap) {

        evMap.invalidateSize();

        return;
    }


    evMap = FuzioMaps.map(
        "evMap"
    ).setView(
        [20.5937, 78.9629],
        5
    );
}


// ======================================================
// EV LOCATION
// ======================================================

function getEVLocation() {

    if (!navigator.geolocation) {

        alert(
            "Geolocation is not supported."
        );

        return;
    }


    navigator.geolocation.getCurrentPosition(

        function(position) {

            const lat =
                position.coords.latitude;

            const lng =
                position.coords.longitude;


            initializeEVMap();


            evMap.setView(
                [lat, lng],
                14
            );


            FuzioMaps.marker(
                [lat, lng]
            )
            .addTo(evMap)
            .bindPopup(
                "📍 Your location"
            )
            .openPopup();


            // Demo nearby EV charging stations

const chargers = [
    {
        name: "ChargePoint Anna Nagar",
        lat: lat + 0.008,
        lng: lng + 0.006
    },
    {
        name: "Fuelit EV Station",
        lat: lat - 0.006,
        lng: lng + 0.009
    },
    {
        name: "FastCharge Hub",
        lat: lat + 0.004,
        lng: lng - 0.008
    }
];

chargers.forEach(charger => {

    FuzioMaps.marker(
        [charger.lat, charger.lng]
    )
    .addTo(evMap)
    .bindPopup(
        "⚡ " + charger.name +
        "<br>EV Charging Station"
    );

});
            showNearbyChargers();
        }
    );
}

// ======================================================
// OPEN TRACKING
// ======================================================

function openTracking() {

    if (latitude === 0 && longitude === 0) {

        alert("Customer location not available.");

        return;
    }

    showScreen("tracking");
}

async function loadCustomerOrderStatus() {

    if (!currentOrderId) {
        return;
    }

    try {

        const response =
            await fetch(
                API_URL +
                "/api/orders/" +
                currentOrderId +
                "/status"
            );

        const data =
            await response.json();

        if (!response.ok) {
            return;
        }

        const status = data.status;
        document.getElementById("driverName").textContent =
    data.driverName || "Waiting for driver...";

document.getElementById("driverPhone").textContent =
    data.driverPhone || "-";

document.getElementById("driverVehicle").textContent =
    data.driverVehicle || "-";

document.getElementById("driverVehicleNumber").textContent =
    data.driverVehicleNumber || "-";

document.getElementById("driverRating").textContent =
    data.driverName ? "4.8" : "-";

        document.getElementById(
            "trackingStatus"
        ).textContent =
            "📦 " + status;


        if (status === "Driver Assigned") {

            document.getElementById(
                "statusAssigned"
            ).textContent =
                "✅ Driver Assigned";
        }

        if (status === "On the Way") {

            document.getElementById(
                "statusAssigned"
            ).textContent =
                "✅ Driver Assigned";

            document.getElementById(
                "statusOnWay"
            ).textContent =
                "✅ On the Way";
            if (!trackingTimer) {
                simulateDriverMovement();
            }
        }

        if (status === "Driver Arrived") {

            document.getElementById(
                "statusAssigned"
            ).textContent =
                "✅ Driver Assigned";

            document.getElementById(
                "statusOnWay"
            ).textContent =
                "✅ On the Way";

            document.getElementById(
                "statusArrived"
            ).textContent =
                "✅ Driver Arrived";
        }

        if (status === "Delivered") {

            document.getElementById(
                "statusAssigned"
            ).textContent =
                "✅ Driver Assigned";

            document.getElementById(
                "statusOnWay"
            ).textContent =
                "✅ On the Way";

            document.getElementById(
                "statusArrived"
            ).textContent =
                "✅ Driver Arrived";

            document.getElementById(
                "statusDelivered"
            ).textContent =
                "✅ Delivered";
        }

    } catch (error) {

        console.error(error);
    }
}
// ======================================================
// INITIALIZE TRACKING MAP
// ======================================================

function initializeTrackingMap() {
    FuzioRoadRoute.initialize();
}

function toggleDriverFields() {

    const role =
        document.getElementById("registerRole").value;

    const driverFields =
        document.getElementById("driverExtraFields");

    if (role === "Driver") {
        driverFields.style.display = "block";
    } else {
        driverFields.style.display = "none";
    }
}
// ======================================================
// DRAW ROUTE
// ======================================================

function updateTrackingRoute() {
    FuzioRoadRoute.initialize();
}


// ======================================================
// DISTANCE
// ======================================================

function calculateDistanceMeters(
    lat1,
    lng1,
    lat2,
    lng2
) {

    const point1 =
        FuzioMaps.latLng(lat1, lng1);

    const point2 =
        FuzioMaps.latLng(lat2, lng2);

    return point1.distanceTo(point2);
}


// ======================================================
// UPDATE TRACKING INFO
// ======================================================

function updateTrackingInformation() {
    FuzioRoadRoute.info();
}


// ======================================================
// DEMO DRIVER MOVEMENT
// ======================================================

function simulateDriverMovement() {
    // Real driver GPS is not connected. Do not fabricate movement.
    if (trackingTimer) { clearInterval(trackingTimer); trackingTimer = null; }
}


// ======================================================
// COMPLETE DELIVERY
// ======================================================

async function completeDelivery() {

    if (!currentOrderId) {

        alert("Order ID not found.");

        return;
    }

    try {

        const response =
            await fetch(
                API_URL +
                "/api/orders/" +
                currentOrderId +
                "/delivered",
                {
                    method: "PUT"
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            alert(
                data.message ||
                "Could not complete delivery."
            );

            return;
        }


        if (trackingTimer) {

            clearInterval(
                trackingTimer
            );

            trackingTimer = null;
        }


        document.getElementById(
            "statusDelivered"
        ).textContent =
            "✅ Delivered";


        document.getElementById(
            "trackingStatus"
        ).textContent =
            "✅ Delivery completed";


        alert(
            "Delivery completed successfully! ✅"
        );


        showScreen("home");

    } catch (error) {

        console.error(error);

        alert(
            "Cannot connect to Fuelit server."
        );
    }
}

function showNearbyChargers() {

    const chargerList =
        document.getElementById("chargerList");

    chargerList.innerHTML = `

        <div class="order-card">

            <div class="order-id">
                ⚡ ChargePoint Anna Nagar
            </div>

            <p>Distance: 1.2 km</p>

            <p>Type: CCS2 / Type 2</p>

            <p>Price: ₹18 per kWh</p>

            <button class="primary-btn"
                    onclick="openEVBooking(
                        'ChargePoint Anna Nagar',
                        'CCS2 / Type 2',
                        18
                    )">

                BOOK CHARGER

            </button>

        </div>


        <div class="order-card">

            <div class="order-id">
                ⚡ Fuelit EV Station
            </div>

            <p>Distance: 2.4 km</p>

            <p>Type: Fast Charger</p>

            <p>Price: ₹20 per kWh</p>

            <button class="primary-btn"
                    onclick="openEVBooking(
                        'Fuelit EV Station',
                        'Fast Charger',
                        20
                    )">

                BOOK CHARGER

            </button>

        </div>
    `;
}


function bookEVCharger(stationName) {

    const bookingId =
        "EV-" +
        Date.now();

    alert(
        "EV Charger Booked! ⚡\n\n" +
        "Station: " + stationName + "\n" +
        "Booking ID: " + bookingId
    );
}
function updateLoginUI() {

    const user =
        JSON.parse(
            localStorage.getItem("fuelitUser")
        );

    const userTop =
        document.getElementById("userTop");

    const loginButton =
        document.getElementById("loginRegisterBtn");

    const logoutButton =
        document.getElementById("logoutBtn");


    if (user) {

        userTop.style.display = "block";

        userTop.textContent =
            "👤 " + (user.name || user.phone);

        loginButton.style.display = "none";

        logoutButton.style.display = "inline-block";

    } else {

        userTop.style.display = "none";

        loginButton.style.display = "block";

        logoutButton.style.display = "none";
    }
}

function logoutUser() {

    localStorage.removeItem(
        "fuelitUser"
    );

    updateLoginUI();

    alert(
        "Logged out successfully."
    );

    showScreen("home");
}
function callDriver() {

    const driverPhone =
        "+919876543210";

    window.location.href =
        "tel:" + driverPhone;
}


async function cancelOrder() {

    const confirmCancel =
        confirm(
            "Are you sure you want to cancel this order?"
        );

    if (!confirmCancel) {
        return;
    }

    if (!currentOrderId) {

        alert("Order ID not found.");

        return;
    }

    try {

        const response =
            await fetch(
                API_URL +
                "/api/orders/" +
                currentOrderId +
                "/cancel",
                {
                    method: "PUT"
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            alert(
                data.message ||
                "Could not cancel order."
            );

            return;
        }

        if (trackingTimer) {

            clearInterval(
                trackingTimer
            );

            trackingTimer = null;
        }

        document.getElementById(
            "trackingStatus"
        ).textContent =
            "❌ Order Cancelled";

        alert(
            "Order cancelled successfully."
        );

        showScreen("home");

    } catch (error) {

        console.error(error);

        alert(
            "Cannot connect to Fuelit server."
        );
    }
}
function openEVBooking(
    stationName,
    chargerType,
    price
) {

    selectedEVStation = stationName;
    selectedEVChargerType = chargerType;
    selectedEVPrice = price;
    selectedEVSlot = "";

    document.getElementById(
        "evStationName"
    ).textContent =
        stationName;

    document.getElementById(
        "evChargerType"
    ).textContent =
        chargerType;

    document.getElementById(
        "evPrice"
    ).textContent =
        "₹" + price + " / kWh";

    document.getElementById(
        "selectedEVSlot"
    ).textContent =
        "No slot selected";

    showScreen("evBooking");
}
function selectEVSlot(slot) {

    selectedEVSlot = slot;

    document.getElementById(
        "selectedEVSlot"
    ).textContent =
        slot;
}

async function confirmEVBooking() {

    const user =
        JSON.parse(
            localStorage.getItem("fuelitUser")
        );

    if (!user) {

        alert(
            "Please login before booking an EV charger."
        );

        showScreen("login");

        return;
    }


    if (!selectedEVSlot) {

        alert(
            "Please select a charging time slot."
        );

        return;
    }


    try {

        const response =
            await fetch(
                API_URL + "/api/ev/book",
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify({

                        userId: user.userId,

                        stationName:
                            selectedEVStation,

                        chargerType:
                            selectedEVChargerType,

                        pricePerKwh:
                            selectedEVPrice,

                        timeSlot:
                            selectedEVSlot
                    })
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            alert(
                data.message ||
                "EV booking failed."
            );

            return;
        }


        alert(
            "EV Charger Booked Successfully! ⚡\n\n" +
            "Booking ID: " +
            data.bookingId +
            "\n" +
            "Station: " +
            data.stationName +
            "\n" +
            "Slot: " +
            data.timeSlot
        );


        showScreen("home");

    } catch (error) {

        console.error(error);

        alert(
            "Cannot connect to Fuelit server."
        );
    }
}

function filterHistory(type) {

    let html = "";


    if (type === "all" || type === "fuel") {

        const fuelOrders =
            type === "cancelled"
                ? []
                : historyFuelOrders;

        if (fuelOrders.length > 0) {

            html += `<h2>⛽ Fuel Orders</h2>`;

            html += fuelOrders.map(order => `

                <div class="order-card">

                    <div class="order-id">
                        ${order.orderId}
                    </div>

                    <p>⛽ ${order.fuelType}</p>

                    <p>
                        💧 ${Number(order.quantity).toFixed(2)} L
                    </p>

                    <p>💰 ₹${order.amount}</p>

                    <p>💳 ${order.payment}</p>

                    <div class="status">
                        ${order.status}
                    </div>

                </div>

            `).join("");
        }
    }


    if (type === "all" || type === "ev") {

        if (historyEVBookings.length > 0) {

            html += `
                <h2 style="margin-top:30px;">
                    ⚡ EV Bookings
                </h2>
            `;

            html += historyEVBookings.map(booking => `

                <div class="order-card">

                    <div class="order-id">
                        ${booking.bookingId}
                    </div>

                    <p>⚡ ${booking.stationName}</p>

                    <p>🔌 ${booking.chargerType}</p>

                    <p>🕒 ${booking.timeSlot}</p>

                    <p>
                        💰 ₹${booking.pricePerKwh} / kWh
                    </p>

                    <div class="status">
                        ${booking.status}
                    </div>

                    <button class="secondary-btn"
                            onclick="cancelEVBooking('${booking.bookingId}')"
                            style="border-color:#d92d20;color:#d92d20;">
                        ❌ CANCEL EV BOOKING
                    </button>

                    </div>
                </div>

            `).join("");
        }
    }


    if (type === "cancelled") {

        const cancelledOrders =
            historyFuelOrders.filter(
                order =>
                    order.status
                        .toLowerCase() ===
                    "cancelled"
            );

        if (cancelledOrders.length > 0) {

            html += `<h2>❌ Cancelled Orders</h2>`;

            html += cancelledOrders.map(order => `

                <div class="order-card">

                    <div class="order-id">
                        ${order.orderId}
                    </div>

                    <p>⛽ ${order.fuelType}</p>

                    <p>💰 ₹${order.amount}</p>

                    <div class="status">
                        ${order.status}
                    </div>

                </div>

            `).join("");

        } else {

            html =
                `<p class="subtitle">
                    No cancelled orders.
                </p>`;
        }
    }


    if (!html) {

        html =
            `<p class="subtitle">
                No history available.
            </p>`;
    }


    document.getElementById(
        "historyList"
    ).innerHTML = html;
}
function markUPIPaid() {

    alert(
        "UPI payment marked as successful ✅"
    );

    selectedPayment = "UPI";
}
async function openProfile() {

    const user =
        JSON.parse(
            localStorage.getItem(
                "fuelitUser"
            )
        );


    if (!user) {

        alert(
            "Please login first."
        );

        showScreen("login");

        return;
    }


    document.getElementById(
        "profileName"
    ).textContent =
        user.name || "Fuzio User";


    document.getElementById(
        "profilePhone"
    ).textContent =
        user.phone || "-";


    showScreen("profile");


    try {

        // Fuel orders

        const fuelResponse =
            await fetch(
                API_URL +
                "/api/orders/user/" +
                user.userId
            );


        const fuelOrders =
            await fuelResponse.json();


        // EV bookings

        const evResponse =
            await fetch(
                API_URL +
                "/api/ev/user/" +
                user.userId
            );


        const evBookings =
            await evResponse.json();

        let recentHTML = "";

            if (fuelOrders.length > 0) {

                const latestFuel = fuelOrders[0];

                recentHTML += `
                    <p>
                        ⛽ Latest Fuel Order:
                        <strong>${latestFuel.orderId}</strong>
                    </p>

                    <p>
                        Status:
                        <strong>${latestFuel.status}</strong>
                    </p>
                `;
            }

            if (evBookings.length > 0) {

                const latestEV = evBookings[0];

                recentHTML += `
                    <p style="margin-top:15px;">
                        ⚡ Latest EV Booking:
                        <strong>${latestEV.bookingId}</strong>
                    </p>

                    <p>
                        Status:
                        <strong>${latestEV.status}</strong>
                    </p>
                `;
            }

            if (!recentHTML) {

                recentHTML = `
                    <p class="subtitle">
                        No recent activity.
                    </p>
                `;
            }

            document.getElementById(
                "profileRecentActivity"
            ).innerHTML = recentHTML;    


        document.getElementById(
            "profileFuelOrders"
        ).textContent =
            fuelOrders.length;


        document.getElementById(
            "profileEVBookings"
        ).textContent =
            evBookings.length;


    } catch (error) {

        console.error(error);

        document.getElementById(
            "profileFuelOrders"
        ).textContent = "0";

        document.getElementById(
            "profileEVBookings"
        ).textContent = "0";
    }
}

async function cancelEVBooking(bookingId) {

    const confirmCancel =
        confirm(
            "Are you sure you want to cancel this EV booking?"
        );

    if (!confirmCancel) {
        return;
    }

    try {

        const response =
            await fetch(
                API_URL +
                "/api/ev/" +
                bookingId +
                "/cancel",
                {
                    method: "PUT"
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            alert(
                data.message ||
                "Could not cancel EV booking."
            );

            return;
        }

        alert(
            "EV booking cancelled successfully."
        );

        await loadHistory();

    } catch (error) {

        console.error(error);

        alert(
            "Cannot connect to Fuelit server."
        );
    }
}
async function loadDriverOrders() {

    const driverOrderList =
        document.getElementById("driverOrderList");

    try {

        const response =
            await fetch(
                API_URL + "/api/driver/orders"
            );

        const orders =
            await response.json();

        if (!response.ok) {
            driverOrderList.innerHTML =
                "<p>Could not load orders.</p>";
            return;
        }

        if (orders.length === 0) {
            driverOrderList.innerHTML =
                "<p>No available orders yet.</p>";
            return;
        }

        driverOrderList.innerHTML =
            orders.map(order => `
                <div class="order-card">

                    <div class="order-id">
                        ${order.orderId}
                    </div>

                    <p>
                        ⛽ ${order.fuelType}
                    </p>

                    <p>
                        💧 ${Number(order.quantity).toFixed(2)} L
                    </p>

                    <p>
                        💰 ₹${order.amount}
                    </p>

                    <p>
                        💳 ${order.payment}
                    </p>

                    <p>
                        Pickup: ${escapePickup(order.pickupStationName)}<br>
                        ${pickupLinks(order)}
                        Delivery: ${order.latitude}, ${order.longitude}
                    </p>
                    <button class="primary-btn"
                            onclick="acceptDriverOrder('${order.orderId}')">
                        ✅ ACCEPT ORDER
                    </button>

                </div>
            `).join("");

    } catch (error) {

        console.error(error);

        driverOrderList.innerHTML =
            "<p>Cannot connect to server.</p>";
    }
}
async function loadAcceptedDriverOrder() {

    const acceptedBox =
        document.getElementById("acceptedDriverOrder");

    try {

        const response =
            await fetch(
                API_URL +
                "/api/driver/accepted-order?driverId=" + JSON.parse(localStorage.getItem("fuelitUser") || "{}").userId
            );

        const data =
            await response.json();

        if (!data.found) {

            acceptedBox.innerHTML =
                "<p>No accepted order yet.</p>";

            return;
        }

        acceptedBox.innerHTML = `
            <div class="order-card">

                <div class="order-id">
                    ${data.orderId}
                </div>

                <p>⛽ ${data.fuelType}</p>

                <p>
                    💧 ${Number(data.quantity).toFixed(2)} L
                </p>

                <p>💰 ₹${data.amount}</p>

                <p>💳 ${data.payment}</p>

                <p>
                    Pickup: ${escapePickup(data.pickupStationName)}<br>
                    ${pickupLinks(data)}
                    Delivery: ${data.latitude}, ${data.longitude}
                </p>

                <div class="status">
                    ${data.status}
                </div>
                <button class="primary-btn"
                        onclick="startDriverDelivery('${data.orderId}')">
                    ⛽ FUEL COLLECTED — START DELIVERY
                </button>
                <button class="secondary-btn"
                     onclick="markDriverArrived('${data.orderId}')">
                    📍 ARRIVED
                </button>
                <button class="primary-btn"
                        onclick="completeDriverDelivery('${data.orderId}')">
                    🔐 VERIFY CUSTOMER PIN
                </button>                
            </div>
        `;

    } catch (error) {

        console.error(error);

        acceptedBox.innerHTML =
            "<p>Could not load accepted order.</p>";
    }
}
async function acceptDriverOrder(orderId) {

    const confirmAccept =
        confirm(
            "Accept this order?"
        );

    if (!confirmAccept) {
        return;
    }

    try {

        const driver =
            JSON.parse(
                localStorage.getItem("fuelitUser")
            );

        const response =
            await fetch(
                API_URL +
                "/api/driver/orders/" +
                orderId +
                "/accept?driverId=" +
                driver.userId,
                {
                    method: "PUT"
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            alert(
                data.message ||
                "Could not accept order."
            );

            return;
        }

        alert(
            "Order accepted successfully 🚚"
        );

        await loadDriverOrders();

    } catch (error) {

        console.error(error);

        alert(
            "Cannot connect to Fuelit server."
        );
    }
}
async function startDriverDelivery(orderId) {

    try {

        const response =
            await fetch(
                API_URL +
                "/api/driver/orders/" +
                orderId +
                "/start",
                {
                    method: "PUT"
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            alert(
                data.message ||
                "Could not start delivery."
            );

            return;
        }

        alert(
            "Delivery started 🚚"
        );

        await loadAcceptedDriverOrder();

    } catch (error) {

        console.error(error);

        alert(
            "Cannot connect to Fuelit server."
        );
    }
}
async function markDriverArrived(orderId) {

    try {

        const response =
            await fetch(
                API_URL +
                "/api/driver/orders/" +
                orderId +
                "/arrived",
                {
                    method: "PUT"
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            alert(
                data.message ||
                "Could not update arrival."
            );

            return;
        }

        alert(
            "Driver marked as arrived 📍"
        );

        await loadAcceptedDriverOrder();

    } catch (error) {

        console.error(error);

        alert(
            "Cannot connect to Fuelit server."
        );
    }
}
async function completeDriverDelivery(orderId) {

    try {

        const response =
            await fetch(
                API_URL +
                "/api/driver/orders/" +
                orderId +
                "/delivered",
                {
                    method: "PUT"
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            alert(
                data.message ||
                "Could not complete delivery."
            );

            return;
        }

        alert(
            "Delivery completed successfully ✅"
        );

        await loadAcceptedDriverOrder();
        await loadDriverOrders();

    } catch (error) {

        console.error(error);

        alert(
            "Cannot connect to Fuelit server."
        );
    }
}
// ======================================================
// INITIAL DISPLAY
// ======================================================
loadDailyFuelPrices();
updateFuelDisplay();
updateLoginUI();
// Phone-first onboarding owns authentication; do not resume old approval polls.
const savedUser =
    JSON.parse(
        localStorage.getItem("fuelitUser")
    );

    if (savedUser && savedUser.role === "Driver") {
        showScreen("driverDashboard");
    }

