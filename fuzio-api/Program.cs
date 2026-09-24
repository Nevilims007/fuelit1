using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using System.Security.Cryptography;
using System.Text;
using FuelitAPI.Models;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddJsonFile("sms-gateway.local.json", optional: true, reloadOnChange: true);
// Deployment environment variables override optional laptop-only settings.
builder.Configuration.AddEnvironmentVariables();
builder.Services.AddScoped<PhoneOtpService>();
builder.Services.AddScoped<PersistentOtp>();
builder.Services.AddScoped<VerifiedSessions>();
builder.Services.AddDataProtection();


// ======================================================
// DATABASE
// ======================================================

var postgresConnection = builder.Configuration.GetConnectionString("Postgres");
builder.Services.AddDbContext<FuelitDbContext>(options =>
{
    if (!string.IsNullOrWhiteSpace(postgresConnection))
        options.UseNpgsql(postgresConnection);
    else
        options.UseSqlite("Data Source=fuelit.db");
});
if (!string.IsNullOrWhiteSpace(postgresConnection))
    builder.Services.AddDataProtection().SetApplicationName("Fuzio.Cloud.v1").PersistKeysToDbContext<FuelitDbContext>();

builder.Services.AddScoped<EmailService>();
builder.Services.AddHttpClient();

// ======================================================
// CORS
// ======================================================

builder.Services.AddCors(options =>
{
    options.AddPolicy("FuelitPolicy", policy =>
    {
        var origins=builder.Configuration.GetSection("AllowedOrigins").Get<string[]>() ?? new[]{"http://127.0.0.1:5500","http://localhost:5500"};
        policy.WithOrigins(origins)
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});


var app = builder.Build();
app.MapPhoneOtp();
app.MapNearbyPlaces();


// ======================================================
// CORS
// ======================================================

app.UseCors("FuelitPolicy");
app.UseCloudAccess();
app.Use(async (context,next) => {
    var path=context.Request.Path.Value ?? "";
    if(path.StartsWith("/api/driver/")) {
        var session=context.RequestServices.GetRequiredService<VerifiedSessions>().Read(context);
        if(session is null || session.Value.Role!="Driver") {context.Response.StatusCode=401;await context.Response.WriteAsJsonAsync(new {message="Please sign in as a driver with mobile OTP."});return;}
        if(context.Request.Query.TryGetValue("driverId",out var id) && id.ToString()!=session.Value.Id.ToString()) {context.Response.StatusCode=403;return;}
        var parts=path.Split('/');
        if(parts.Length>=6 && parts[3]=="orders" && parts[5]!="accept") {
            var database=context.RequestServices.GetRequiredService<FuelitDbContext>();
            var owned=await database.Orders.AnyAsync(o=>o.OrderId==parts[4] && o.DriverId==session.Value.Id);
            if(!owned){context.Response.StatusCode=403;return;}
        }
    }
    await next();
});
app.MapDeliverySecurity();


// ======================================================
// CREATE DATABASE
// ======================================================

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider
        .GetRequiredService<FuelitDbContext>();

    db.Database.EnsureCreated();
    // Legacy column upgrades apply only to the existing local SQLite database.
    // A new PostgreSQL database is created from the EF model above.
    if (db.Database.IsSqlite())
    {
    db.Database.ExecuteSqlRaw("CREATE TABLE IF NOT EXISTS VerifiedLoginSessions (TokenHash TEXT NOT NULL PRIMARY KEY, UserId INTEGER NOT NULL, ExpiresAt INTEGER NOT NULL);");
    db.Database.ExecuteSqlRaw("CREATE TABLE IF NOT EXISTS OtpChallenges (Id TEXT NOT NULL PRIMARY KEY, Phone TEXT NOT NULL, Hash BLOB NOT NULL, Expires INTEGER NOT NULL, Attempts INTEGER NOT NULL);");
    db.Database.ExecuteSqlRaw("CREATE TABLE IF NOT EXISTS OtpSendAttempts (Id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, Phone TEXT NOT NULL, Created INTEGER NOT NULL);");
    db.Database.ExecuteSqlRaw("CREATE TABLE IF NOT EXISTS OtpProofs (Id TEXT NOT NULL PRIMARY KEY, Phone TEXT NOT NULL, Expires INTEGER NOT NULL);");
    db.Database.ExecuteSqlRaw("CREATE TABLE IF NOT EXISTS DeliveryPins (OrderId TEXT NOT NULL PRIMARY KEY, ProtectedCode TEXT NOT NULL, Attempts INTEGER NOT NULL, Used INTEGER NOT NULL);");

        try
        {
            db.Database.ExecuteSqlRaw(
                "ALTER TABLE Users ADD COLUMN Phone TEXT NOT NULL DEFAULT '';"
            );
        }
        catch
        {
            // Phone column already exists
        }

        try
        {
            db.Database.ExecuteSqlRaw(
                "ALTER TABLE Users ADD COLUMN VehicleName TEXT NOT NULL DEFAULT '';"
            );
        }
        catch
        {
            // VehicleName column already exists
        }

        try
        {
            db.Database.ExecuteSqlRaw(
                "ALTER TABLE Users ADD COLUMN VehicleNumber TEXT NOT NULL DEFAULT '';"
            );
        }
        catch
        {
            // VehicleNumber column already exists
        }

        try
            {
                db.Database.ExecuteSqlRaw(
                    "ALTER TABLE Users ADD COLUMN Role TEXT NOT NULL DEFAULT 'Customer';"
                );
            }
            catch
            {
                // Role column already exists
            }
        try
            {
                db.Database.ExecuteSqlRaw(
                    "ALTER TABLE Orders ADD COLUMN DriverId INTEGER NULL;"
                );
            }
            catch
            {
                // already exists
            }

    db.Database.ExecuteSqlRaw(@"
        CREATE TABLE IF NOT EXISTS EVBookings
        (
            Id INTEGER NOT NULL
                CONSTRAINT PK_EVBookings
                PRIMARY KEY AUTOINCREMENT,

            BookingId TEXT NOT NULL,

            UserId INTEGER NOT NULL,

            StationName TEXT NOT NULL,

            ChargerType TEXT NOT NULL,

            PricePerKwh TEXT NOT NULL,

            TimeSlot TEXT NOT NULL,

            Status TEXT NOT NULL,

            CreatedAt TEXT NOT NULL
        );
    ");

    db.Database.ExecuteSqlRaw(@"
        CREATE TABLE IF NOT EXISTS WhatsAppRegistrations
        (
            Id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            RequestCode TEXT NOT NULL,
            Name TEXT NOT NULL,
            Phone TEXT NOT NULL,
            Role TEXT NOT NULL,
            VehicleName TEXT NOT NULL,
            VehicleNumber TEXT NOT NULL,
            Status TEXT NOT NULL,
            UserId INTEGER NULL,
            CreatedAt TEXT NOT NULL
        );
    ");

    db.Database.ExecuteSqlRaw(@"
        CREATE TABLE IF NOT EXISTS WhatsAppLoginRequests
        (
            Id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            RequestCode TEXT NOT NULL,
            Phone TEXT NOT NULL,
            Status TEXT NOT NULL,
            UserId INTEGER NOT NULL,
            CreatedAt TEXT NOT NULL
        );
    ");
    }
}


// ======================================================
// TEST API
// ======================================================

app.MapGet("/", () =>
{
    return Results.Ok(new
    {
        message = "Fuelit API is running!"
    });
});


// ======================================================
// REGISTER
// ======================================================

app.MapPost("/api/register",
    async (
        RegisterRequest request,
        VerifiedSessions sessions,
        PhoneOtpService phoneOtp,
        FuelitDbContext db,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration) =>
    {

        if (string.IsNullOrWhiteSpace(request.Name) ||
            string.IsNullOrWhiteSpace(request.Phone) ||
            string.IsNullOrWhiteSpace(request.Role))
        {
            return Results.BadRequest(new
            {
                message = "Please enter name, mobile number and role."
            });
        }

        var phone = NormalizePhone(request.Phone);

        if (phone.Length < 10 || phone.Length > 15)
        {
            return Results.BadRequest(new { message = "Invalid mobile number." });
        }

        var verifiedPhone = request.FirebaseIdToken?.StartsWith("sms_") == true
            ? (phoneOtp.ConsumeProof(request.FirebaseIdToken, phone) ? phone : null)
            : await VerifyFirebasePhoneAsync(
            request.FirebaseIdToken,
            httpClientFactory,
            configuration);

        if (verifiedPhone != phone)
        {
            return Results.Json(
                new { message = "Firebase phone verification failed." },
                statusCode: StatusCodes.Status401Unauthorized);
        }


        var existingUser =
            await db.Users
                .FirstOrDefaultAsync(
                    u => u.Phone == phone);


        if (existingUser != null)
        {
            return Results.BadRequest(new
            {
                message = "Mobile number already registered."
            });
        }


        if (request.Role != "Customer" && request.Role != "Driver")
            return Results.BadRequest(new { message = "Choose Customer or Driver." });

        if (request.Role == "Driver" &&
            (string.IsNullOrWhiteSpace(request.VehicleName) || string.IsNullOrWhiteSpace(request.VehicleNumber)))
            return Results.BadRequest(new { message = "Enter your vehicle name and registration number." });

        var user = new User
        {
            Name = request.Name.Trim(),
            Email = $"{phone}@phone.fuzio.local",
            PasswordHash = "",
            Role = request.Role,

            Phone = phone,
            VehicleName = request.VehicleName ?? "",
            VehicleNumber = request.VehicleNumber ?? "",

            CreatedAt = DateTime.UtcNow
        };

        db.Users.Add(user);

        await db.SaveChangesAsync();


        return Results.Ok(new
        {
            success = true,
            message = "Registration successful!",
            sessionToken = sessions.Issue(user),
            userId = user.Id,
            name = user.Name,
            email = user.Email,
            role = user.Role,
            phone = user.Phone,
            vehicleName = user.VehicleName,
            vehicleNumber = user.VehicleNumber
        });
    });


// ======================================================
// MOBILE OTP LOGIN
// ======================================================

app.MapPost("/api/whatsapp/registration-request",
    async (WhatsAppRegistrationRequest request, FuelitDbContext db) =>
    {
        var phone = NormalizePhone(request.Phone);

        if (string.IsNullOrWhiteSpace(request.Name) ||
            phone.Length < 10 || phone.Length > 15 ||
            string.IsNullOrWhiteSpace(request.Role))
        {
            return Results.BadRequest(new { message = "Enter valid registration details." });
        }

        if (await db.Users.AnyAsync(u => u.Phone == phone))
        {
            return Results.BadRequest(new { message = "Mobile number already registered." });
        }

        var existing = await db.WhatsAppRegistrations
            .Where(r => r.Phone == phone && r.Status == "Pending")
            .OrderByDescending(r => r.Id)
            .FirstOrDefaultAsync();

        if (existing != null)
        {
            return Results.Ok(new
            {
                success = true,
                requestCode = existing.RequestCode,
                status = existing.Status
            });
        }

        var registration = new WhatsAppRegistration
        {
            RequestCode = $"FZ-{RandomNumberGenerator.GetInt32(100000, 1000000)}",
            Name = request.Name.Trim(),
            Phone = phone,
            Role = request.Role,
            VehicleName = request.VehicleName ?? "",
            VehicleNumber = request.VehicleNumber ?? "",
            Status = "Pending",
            CreatedAt = DateTime.UtcNow
        };

        db.WhatsAppRegistrations.Add(registration);
        await db.SaveChangesAsync();

        return Results.Ok(new
        {
            success = true,
            requestCode = registration.RequestCode,
            status = registration.Status
        });
    });

app.MapGet("/api/whatsapp/registration-status/{requestCode}",
    async (string requestCode, FuelitDbContext db) =>
    {
        var registration = await db.WhatsAppRegistrations
            .FirstOrDefaultAsync(r => r.RequestCode == requestCode);

        if (registration == null)
        {
            return Results.NotFound(new { message = "Registration request not found." });
        }

        User? user = null;
        if (registration.UserId.HasValue)
        {
            user = await db.Users.FindAsync(registration.UserId.Value);
        }

        return Results.Ok(new
        {
            status = registration.Status,
            userId = user?.Id,
            name = user?.Name,
            email = user?.Email,
            role = user?.Role,
            phone = user?.Phone,
            vehicleName = user?.VehicleName,
            vehicleNumber = user?.VehicleNumber
        });
    });

app.MapPost("/api/admin/whatsapp-registrations",
    async (AdminPinRequest request, FuelitDbContext db, IConfiguration configuration) =>
    {
        if (request.Pin != configuration["WhatsAppAdmin:Pin"])
        {
            return Results.Json(new { message = "Invalid admin PIN." }, statusCode: 401);
        }

        var registrations = await db.WhatsAppRegistrations
            .Where(r => r.Status == "Pending")
            .OrderByDescending(r => r.Id)
            .ToListAsync();

        return Results.Ok(registrations.Select(r => new
        {
            r.RequestCode,
            r.Name,
            r.Phone,
            r.Role,
            r.VehicleName,
            r.VehicleNumber,
            r.CreatedAt
        }));
    });

app.MapPost("/api/admin/whatsapp-registrations/{requestCode}/approve",
    async (string requestCode, AdminPinRequest request, FuelitDbContext db, IConfiguration configuration) =>
    {
        if (request.Pin != configuration["WhatsAppAdmin:Pin"])
        {
            return Results.Json(new { message = "Invalid admin PIN." }, statusCode: 401);
        }

        var registration = await db.WhatsAppRegistrations
            .FirstOrDefaultAsync(r => r.RequestCode == requestCode);

        if (registration == null)
        {
            return Results.NotFound(new { message = "Registration request not found." });
        }

        if (registration.Status == "Approved")
        {
            return Results.Ok(new { success = true, message = "Already approved." });
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Phone == registration.Phone);
        if (user == null)
        {
            user = new User
            {
                Name = registration.Name,
                Email = $"{registration.Phone}@whatsapp.fuzio.local",
                PasswordHash = "",
                Role = registration.Role,
                Phone = registration.Phone,
                VehicleName = registration.VehicleName,
                VehicleNumber = registration.VehicleNumber,
                CreatedAt = DateTime.UtcNow
            };

            db.Users.Add(user);
            await db.SaveChangesAsync();
        }

        registration.Status = "Approved";
        registration.UserId = user.Id;
        await db.SaveChangesAsync();

        return Results.Ok(new { success = true, message = "Registration approved." });
    });

app.MapPost("/api/whatsapp/login-request",
    async (WhatsAppLoginRequest request, FuelitDbContext db) =>
    {
        var phone = NormalizePhone(request.Phone);
        var user = await db.Users.FirstOrDefaultAsync(u => u.Phone == phone);

        if (user == null)
        {
            return Results.BadRequest(new
            {
                message = "Mobile number not registered. Please create an account first."
            });
        }

        var existing = await db.WhatsAppLoginRequests
            .Where(r => r.Phone == phone && r.Status == "Pending")
            .OrderByDescending(r => r.Id)
            .FirstOrDefaultAsync();

        if (existing != null)
        {
            return Results.Ok(new { success = true, requestCode = existing.RequestCode });
        }

        var loginRequest = new WhatsAppLoginApproval
        {
            RequestCode = $"LG-{RandomNumberGenerator.GetInt32(100000, 1000000)}",
            Phone = phone,
            Status = "Pending",
            UserId = user.Id,
            CreatedAt = DateTime.UtcNow
        };

        db.WhatsAppLoginRequests.Add(loginRequest);
        await db.SaveChangesAsync();

        return Results.Ok(new { success = true, requestCode = loginRequest.RequestCode });
    });

app.MapGet("/api/whatsapp/login-status/{requestCode}",
    async (string requestCode, FuelitDbContext db) =>
    {
        var loginRequest = await db.WhatsAppLoginRequests
            .FirstOrDefaultAsync(r => r.RequestCode == requestCode);

        if (loginRequest == null)
        {
            return Results.NotFound(new { message = "Login request not found." });
        }

        User? user = null;
        if (loginRequest.Status == "Approved")
        {
            user = await db.Users.FindAsync(loginRequest.UserId);
        }

        return Results.Ok(new
        {
            status = loginRequest.Status,
            userId = user?.Id,
            name = user?.Name,
            email = user?.Email,
            role = user?.Role,
            phone = user?.Phone,
            vehicleName = user?.VehicleName,
            vehicleNumber = user?.VehicleNumber
        });
    });

app.MapPost("/api/admin/whatsapp-login-requests",
    async (AdminPinRequest request, FuelitDbContext db, IConfiguration configuration) =>
    {
        if (request.Pin != configuration["WhatsAppAdmin:Pin"])
        {
            return Results.Json(new { message = "Invalid admin PIN." }, statusCode: 401);
        }

        var requests = await db.WhatsAppLoginRequests
            .Where(r => r.Status == "Pending")
            .OrderByDescending(r => r.Id)
            .ToListAsync();

        var users = await db.Users.ToDictionaryAsync(u => u.Id);
        return Results.Ok(requests.Select(r => new
        {
            r.RequestCode,
            r.Phone,
            Name = users.TryGetValue(r.UserId, out var user) ? user.Name : "",
            r.CreatedAt
        }));
    });

app.MapPost("/api/admin/whatsapp-login-requests/{requestCode}/approve",
    async (string requestCode, AdminPinRequest request, FuelitDbContext db, IConfiguration configuration) =>
    {
        if (request.Pin != configuration["WhatsAppAdmin:Pin"])
        {
            return Results.Json(new { message = "Invalid admin PIN." }, statusCode: 401);
        }

        var loginRequest = await db.WhatsAppLoginRequests
            .FirstOrDefaultAsync(r => r.RequestCode == requestCode);

        if (loginRequest == null)
        {
            return Results.NotFound(new { message = "Login request not found." });
        }

        loginRequest.Status = "Approved";
        await db.SaveChangesAsync();
        return Results.Ok(new { success = true, message = "Login approved." });
    });

app.MapPost("/api/auth/firebase-login",
    async (
        FirebaseLoginRequest request,
        FuelitDbContext db,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration) =>
    {
        var phone = NormalizePhone(request.Phone);

        var verifiedPhone = await VerifyFirebasePhoneAsync(
            request.FirebaseIdToken,
            httpClientFactory,
            configuration);

        if (verifiedPhone != phone)
        {
            return Results.Json(
                new { message = "Firebase phone verification failed." },
                statusCode: StatusCodes.Status401Unauthorized);
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Phone == phone);
        if (user == null)
        {
            return Results.Ok(new { success = true, needsProfile = true });
        }

        return Results.Ok(new
        {
            success = true,
            message = "Login successful!",
            userId = user.Id,
            name = user.Name,
            email = user.Email,
            role = user.Role,
            phone = user.Phone,
            vehicleName = user.VehicleName,
            vehicleNumber = user.VehicleNumber
        });
    });


// ======================================================
// LOGIN
// ======================================================

app.MapPost("/api/login",
    async (
        LoginRequest request,
        FuelitDbContext db) =>
    {

        var email =
            request.Email.Trim().ToLower();


        var user =
            await db.Users
                .FirstOrDefaultAsync(
                    u => u.Email == email);


        if (user == null)
        {
            return Results.BadRequest(new
            {
                message = "Invalid email or password."
            });
        }


        var passwordHash =
            HashPassword(request.Password);


        if (user.PasswordHash != passwordHash)
        {
            return Results.BadRequest(new
            {
                message = "Invalid email or password."
            });
        }


        return Results.Ok(new
        {
            success = true,
            message = "Login successful!",
            userId = user.Id,
            name = user.Name,
            email = user.Email,
            role = user.Role,

            phone = user.Phone,
            vehicleName = user.VehicleName,
            vehicleNumber = user.VehicleNumber
        });
    });


// ======================================================
// CREATE ORDER
// ======================================================

app.MapPost("/api/orders", 
    async (
        OrderRequest request,
        HttpContext context, VerifiedSessions sessions, IDataProtectionProvider protection,
        FuelitDbContext db,
        EmailService emailService) =>
    {
        var session = sessions.Read(context);
        if(session is null || session.Value.Role!="Customer" || session.Value.Id!=request.UserId) return Results.Unauthorized();
        var user =
            await db.Users
                .FindAsync(request.UserId);

        if (user == null)
        {
            return Results.BadRequest(new
            {
                message = "User not found."
            });
        }

        if (user.Role != "Customer") return Results.BadRequest(new { message = "Only customers can order fuel." });
        if (request.FuelType is not ("Petrol" or "Diesel") || request.Payment is not ("Cash" or "UPI"))
            return Results.BadRequest(new { message = "Choose a valid fuel and payment type." });
        if (string.IsNullOrWhiteSpace(request.PickupStationId) || string.IsNullOrWhiteSpace(request.PickupStationName) ||
            !double.IsFinite(request.PickupLatitude) || Math.Abs(request.PickupLatitude) > 90 ||
            !double.IsFinite(request.PickupLongitude) || Math.Abs(request.PickupLongitude) > 180 ||
            !double.IsFinite(request.Latitude) || Math.Abs(request.Latitude) > 90 ||
            !double.IsFinite(request.Longitude) || Math.Abs(request.Longitude) > 180)
            return Results.BadRequest(new { message = "Choose a petrol bunk and valid delivery location first." });
        if (request.Amount <= 0)
        {
            return Results.BadRequest(new
            {
                message = "Invalid amount."
            });
        }


        if (request.Quantity <= 0)
        {
            return Results.BadRequest(new
            {
                message = "Invalid fuel quantity."
            });
        }


        // ==================================================
        // GENERATE ORDER ID
        // ==================================================

        var orderId =
            "FIT-" +
            DateTime.Now.ToString("yyyyMMddHHmmss") +
            "-" +
            Random.Shared.Next(100, 999);


        var order = new Order
        {
            OrderId = orderId,

            UserId = request.UserId,

            PickupStationId = request.PickupStationId,
            PickupStationName = request.PickupStationName,
            PickupAddress = request.PickupAddress ?? "",
            PickupLatitude = request.PickupLatitude,
            PickupLongitude = request.PickupLongitude,
            FuelType = request.FuelType,

            Amount = request.Amount,

            Quantity = request.Quantity,

            Payment = request.Payment,

            Latitude = request.Latitude,

            Longitude = request.Longitude,

            Status = "Confirmed",

            CreatedAt = DateTime.UtcNow
        };


        db.Orders.Add(order);
        db.DeliveryPins.Add(new DeliveryPin { OrderId=orderId, ProtectedCode=protection.CreateProtector("Fuzio.DeliveryPin.v1").Protect(RandomNumberGenerator.GetInt32(1000,10000).ToString()) });

        await db.SaveChangesAsync();
        try
        {
            await emailService.SendOrderConfirmationAsync(
                user.Email,
                order.OrderId,
                order.FuelType,
                order.Quantity,
                order.Payment,
                order.Amount + 30
            );
        }
        catch (Exception ex)
        {
            Console.WriteLine(
                "Email failed: " + ex.Message
            );
        }

        return Results.Ok(new
        {
            success = true,

            message =
                "Order created successfully!",

            orderId = order.OrderId,

            fuelType = order.FuelType,

            amount = order.Amount,

            quantity = order.Quantity,

            payment = order.Payment,

            latitude = order.Latitude,

            longitude = order.Longitude,

            status = order.Status
        });
    });


// ======================================================
// GET USER ORDER HISTORY
// ======================================================

app.MapGet(
    "/api/orders/user/{userId:int}",
    async (
        int userId,
        FuelitDbContext db) =>
    {

        var orders =
            await db.Orders
                .Where(o => o.UserId == userId)
                .OrderByDescending(
                    o => o.CreatedAt)
                .ToListAsync();


        return Results.Ok(orders);
    });

app.MapPut("/api/orders/{orderId}/cancel", async (
    string orderId,
    FuelitDbContext db) =>
{
    var order =
        await db.Orders
            .FirstOrDefaultAsync(
                o => o.OrderId == orderId
            );

    if (order == null)
    {
        return Results.NotFound(new
        {
            message = "Order not found."
        });
    }

    if(order.Status is not ("Confirmed" or "Driver Assigned"))
        return Results.BadRequest(new {message="This order can no longer be cancelled."});
    order.Status = "Cancelled";

    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        success = true,
        status = order.Status
    });
});
app.MapPut("/api/orders/{orderId}/delivered", () => Results.BadRequest(new { message = "Delivery PIN required. The assigned driver must use Confirm delivery with the customer's PIN." }));
app.MapPost("/api/ev/book", async (
    EVBookingRequest request,
    HttpContext context,
    VerifiedSessions sessions,
    FuelitDbContext db,
    EmailService emailService) =>
{
    var verified=sessions.Read(context);
    if(verified is null || verified.Value.Id!=request.UserId || verified.Value.Role!="Customer")return Results.Unauthorized();
    var user =
        await db.Users
            .FindAsync(request.UserId);

    if (user == null)
    {
        return Results.BadRequest(new
        {
            message = "User not found."
        });
    }

    var bookingId =
        "EV-" +
        DateTime.Now.ToString("yyyyMMddHHmmss") +
        "-" +
        Random.Shared.Next(100, 999);

    var booking =
        new EVBooking
        {
            BookingId = bookingId,
            UserId = request.UserId,
            StationName = request.StationName,
            ChargerType = request.ChargerType,
            PricePerKwh = request.PricePerKwh,
            TimeSlot = request.TimeSlot,
            Status = "Booked",
            CreatedAt = DateTime.UtcNow
        };

    db.EVBookings.Add(booking);

    await db.SaveChangesAsync();

    try
    {
        await emailService.SendEVBookingConfirmationAsync(
            user.Email,
            booking.BookingId,
            booking.StationName,
            booking.ChargerType,
            booking.TimeSlot,
            booking.PricePerKwh
        );
    }
    catch (Exception ex)
    {
        Console.WriteLine(
            "EV email failed: " + ex.Message
        );
    }

    return Results.Ok(new
    {
        success = true,
        bookingId = booking.BookingId,
        stationName = booking.StationName,
        chargerType = booking.ChargerType,
        pricePerKwh = booking.PricePerKwh,
        timeSlot = booking.TimeSlot,
        status = booking.Status
    });
});

app.MapGet("/api/ev/user/{userId}", async (
    int userId,
    FuelitDbContext db) =>
{
    var bookings =
        await db.EVBookings
            .Where(b => b.UserId == userId)
            .OrderByDescending(b => b.CreatedAt)
            .ToListAsync();

    return Results.Ok(bookings);
});
app.MapGet("/api/fuelprice", async (
    string city,
    IConfiguration configuration) =>
{
    var apiKey =
        configuration["FuelPriceApi:ApiKey"];

    if (string.IsNullOrWhiteSpace(apiKey))
    {
        return Results.BadRequest(new
        {
            message = "Fuel price API key is missing."
        });
    }

    using var client = new HttpClient();

    client.DefaultRequestHeaders.Add(
        "x-api-key",
        apiKey
    );


    async Task<decimal?> GetPrice(string fuelType)
    {
        var url =
            "https://fuel.indianapi.in/live_fuel_price" +
            "?fuel_type=" + fuelType +
            "&location_type=city";

        var response =
            await client.GetAsync(url);
            

        if (!response.IsSuccessStatusCode)
        {
            return null;
        }

        var content =
            await response.Content
                .ReadAsStringAsync();

        using var document =
            JsonDocument.Parse(content);


        foreach (
            var item in
            document.RootElement
                .EnumerateArray()
        )
        {
            var cityName =
                item.GetProperty("city")
                    .GetString();

            if (
                string.Equals(
                    cityName,
                    city,
                    StringComparison.OrdinalIgnoreCase
                )
            )
            {
                var priceText =
                    item.GetProperty("price")
                        .GetString();

                if (
                    decimal.TryParse(
                        priceText,
                        out var price
                    )
                )
                {
                    return price;
                }
            }
        }

        return null;
    }


    var petrolPrice =
        await GetPrice("petrol");

    var dieselPrice =
        await GetPrice("diesel");

    Console.WriteLine("Petrol = " + petrolPrice);
    Console.WriteLine("Diesel = " + dieselPrice);


    if (
        petrolPrice == null ||
        dieselPrice == null
    )
    {
        return Results.NotFound(new
        {
            message =
                "Fuel price not found for " +
                city
        });
    }


    return Results.Ok(new
    {
        city = city,
        petrol = petrolPrice,
        diesel = dieselPrice,
        updatedAt =
            DateTime.Now
    });
});
app.MapPut("/api/ev/{bookingId}/cancel", async (
    string bookingId,
    FuelitDbContext db) =>
{
    var booking =
        await db.EVBookings
            .FirstOrDefaultAsync(
                b => b.BookingId == bookingId
            );

    if (booking == null)
    {
        return Results.NotFound(new
        {
            message = "EV booking not found."
        });
    }

    booking.Status = "Cancelled";

    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        success = true,
        status = booking.Status
    });
});
app.MapGet("/api/driver/orders", async (
    FuelitDbContext db) =>
{
    var orders =
        await db.Orders
            .Where(o => o.Status == "Confirmed")
            .OrderByDescending(o => o.CreatedAt)
            .ToListAsync();

    return Results.Ok(orders);
});
app.MapPut("/api/driver/orders/{orderId}/accept", async (
    string orderId,
    int driverId,
    FuelitDbContext db) =>
{
    var order =
        await db.Orders
            .FirstOrDefaultAsync(o => o.OrderId == orderId);

    if (order == null)
    {
        return Results.NotFound(new
        {
            message = "Order not found."
        });
    }

    var driver = await db.Users.FindAsync(driverId);
    if (driver?.Role != "Driver") return Results.BadRequest(new { message = "Register as a driver first." });
    if (order.Status != "Confirmed" || order.DriverId != null)
        return Results.BadRequest(new { message = "This order is already assigned." });
    var assigned = await db.Orders
        .Where(o => o.Id == order.Id && o.Status == "Confirmed" && o.DriverId == null)
        .ExecuteUpdateAsync(setters => setters.SetProperty(o => o.Status, "Driver Assigned").SetProperty(o => o.DriverId, (int?)driverId));
    if (assigned != 1) return Results.BadRequest(new { message = "Another driver accepted this order." });
    order.Status = "Driver Assigned";
    order.DriverId = driverId;

    return Results.Ok(new
    {
        success = true,
        orderId = order.OrderId,
        status = order.Status,
        driverId = order.DriverId
    });
});
app.MapGet("/api/driver/accepted-order", async (
    int driverId, FuelitDbContext db) =>
{
    var order =
        await db.Orders
            .Where(o => o.DriverId == driverId && (
                        o.Status == "Driver Assigned" ||
                        o.Status == "On the Way" ||
                        o.Status == "Driver Arrived"))
            .OrderByDescending(o => o.CreatedAt)
            .FirstOrDefaultAsync();

    if (order == null)
    {
        return Results.Ok(new
        {
            found = false
        });
    }

    return Results.Ok(new
    {
        found = true,
        pickupStationName = order.PickupStationName,
        pickupAddress = order.PickupAddress,
        pickupLatitude = order.PickupLatitude,
        pickupLongitude = order.PickupLongitude,
        orderId = order.OrderId,
        fuelType = order.FuelType,
        amount = order.Amount,
        quantity = order.Quantity,
        payment = order.Payment,
        latitude = order.Latitude,
        longitude = order.Longitude,
        status = order.Status
    });
});
app.MapPut("/api/driver/orders/{orderId}/start", async (
    string orderId,
    FuelitDbContext db) =>
{
    var order =
        await db.Orders
            .FirstOrDefaultAsync(
                o => o.OrderId == orderId
            );

    if (order == null)
    {
        return Results.NotFound(new
        {
            message = "Order not found."
        });
    }

    if (order.Status != "Driver Assigned")
        return Results.BadRequest(new { message = "Accept the order before confirming fuel pickup." });
    order.Status = "On the Way";

    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        success = true,
        orderId = order.OrderId,
        status = order.Status
    });
});
app.MapPut("/api/driver/orders/{orderId}/arrived", async (
    string orderId,
    FuelitDbContext db) =>
{
    var order =
        await db.Orders
            .FirstOrDefaultAsync(
                o => o.OrderId == orderId
            );

    if (order == null)
    {
        return Results.NotFound(new
        {
            message = "Order not found."
        });
    }

    if (order.Status != "On the Way")
        return Results.BadRequest(new { message = "Confirm fuel pickup before arriving at the customer." });
    order.Status = "Driver Arrived";

    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        success = true,
        orderId = order.OrderId,
        status = order.Status
    });
});
app.MapPut("/api/driver/orders/{orderId}/delivered", () => Results.BadRequest(new { message = "Delivery PIN required. The assigned driver must use Confirm delivery with the customer's PIN." }));
app.MapGet("/api/orders/{orderId}/status", async (
    string orderId,
    FuelitDbContext db) =>
{
    var order =
        await db.Orders
            .FirstOrDefaultAsync(
                o => o.OrderId == orderId
            );

    if (order == null)
    {
        return Results.NotFound(new
        {
            message = "Order not found."
        });
    }

    User? driver = null;

    if (order.DriverId != null)
    {
        driver =
            await db.Users
                .FirstOrDefaultAsync(
                    u => u.Id == order.DriverId
                );
    }

    return Results.Ok(new
    {
        orderId = order.OrderId,
        status = order.Status,

        driverName = driver?.Name ?? "",
        driverPhone = driver?.Phone ?? "",
        driverVehicle = driver?.VehicleName ?? "",
        driverVehicleNumber = driver?.VehicleNumber ?? ""
    });
});
// ======================================================
// RUN
// ======================================================

app.Run();


// ======================================================
// PASSWORD HASH
// ======================================================

static string HashPassword(string password)
{
    using var sha256 =
        SHA256.Create();

    var bytes =
        Encoding.UTF8.GetBytes(password);

    var hash =
        sha256.ComputeHash(bytes);

    return Convert.ToHexString(hash);
}

static string NormalizePhone(string? phone)
{
    if (string.IsNullOrWhiteSpace(phone)) return "";
    var digits = new string(phone.Where(char.IsDigit).ToArray());

    if (digits.Length == 12 && digits.StartsWith("91"))
    {
        return digits[2..];
    }

    return digits;
}

static async Task<string> VerifyFirebasePhoneAsync(
    string? firebaseIdToken,
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration)
{
    if (string.IsNullOrWhiteSpace(firebaseIdToken)) return "";

    var apiKey = configuration["Firebase:ApiKey"];
    if (string.IsNullOrWhiteSpace(apiKey)) return "";

    var client = httpClientFactory.CreateClient();
    var response = await client.PostAsJsonAsync(
        $"https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={apiKey}",
        new { idToken = firebaseIdToken });

    if (!response.IsSuccessStatusCode) return "";

    using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    if (!json.RootElement.TryGetProperty("users", out var users) ||
        users.GetArrayLength() == 0 ||
        !users[0].TryGetProperty("phoneNumber", out var phoneNumber))
    {
        return "";
    }

    return NormalizePhone(phoneNumber.GetString());
}



// ======================================================
// DATABASE CONTEXT
// ======================================================

public class FuelitDbContext : DbContext, IDataProtectionKeyContext
{
    public FuelitDbContext(
        DbContextOptions<FuelitDbContext> options)
        : base(options)
    {
    }


    protected override void OnModelCreating(ModelBuilder modelBuilder) {
        modelBuilder.Entity<DeliveryPin>().HasKey(p=>p.OrderId);
        modelBuilder.Entity<VerifiedLoginSession>().HasKey(p=>p.TokenHash);
    }
    public DbSet<VerifiedLoginSession> VerifiedLoginSessions => Set<VerifiedLoginSession>();
    public DbSet<DataProtectionKey> DataProtectionKeys {get;set;} = null!;
    public DbSet<OtpChallenge> OtpChallenges => Set<OtpChallenge>();
    public DbSet<OtpSendAttempt> OtpSendAttempts => Set<OtpSendAttempt>();
    public DbSet<OtpProof> OtpProofs => Set<OtpProof>();
    public DbSet<DeliveryPin> DeliveryPins => Set<DeliveryPin>();

    public DbSet<User> Users =>
        Set<User>();


    public DbSet<Order> Orders =>
        Set<Order>();
    
    public DbSet<EVBooking> EVBookings =>
        Set<EVBooking>();    

    public DbSet<WhatsAppRegistration> WhatsAppRegistrations =>
        Set<WhatsAppRegistration>();

    public DbSet<WhatsAppLoginApproval> WhatsAppLoginRequests =>
        Set<WhatsAppLoginApproval>();
}


// ======================================================
// USER
// ======================================================

public class User
{
    public int Id { get; set; }

    public string Name { get; set; } = "";

    public string Email { get; set; } = "";

    public string PasswordHash { get; set; } = "";

    public string Role { get; set; } = "Customer";

   

    public string Phone { get; set; } = "";
    public string VehicleName { get; set; } = "";
    public string VehicleNumber { get; set; } = "";

    public DateTime CreatedAt { get; set; } 
}


// ======================================================
// ORDER
// ======================================================

public class Order
{
    public string PickupStationId { get; set; } = "";
    public string PickupStationName { get; set; } = "";
    public string PickupAddress { get; set; } = "";
    public double PickupLatitude { get; set; }
    public double PickupLongitude { get; set; }
    public int Id { get; set; }

    public string OrderId { get; set; } = "";

    public int UserId { get; set; }

    public int? DriverId { get; set; }

    public string FuelType { get; set; } = "";

    public decimal Amount { get; set; }

    public decimal Quantity { get; set; }

    public string Payment { get; set; } = "";

    public double Latitude { get; set; }

    public double Longitude { get; set; }

    public string Status { get; set; } = "";

    public DateTime CreatedAt { get; set; }
}

public class WhatsAppRegistration
{
    public int Id { get; set; }
    public string RequestCode { get; set; } = "";
    public string Name { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Role { get; set; } = "Customer";
    public string VehicleName { get; set; } = "";
    public string VehicleNumber { get; set; } = "";
    public string Status { get; set; } = "Pending";
    public int? UserId { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class WhatsAppLoginApproval
{
    public int Id { get; set; }
    public string RequestCode { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Status { get; set; } = "Pending";
    public int UserId { get; set; }
    public DateTime CreatedAt { get; set; }
}


// ======================================================
// REQUEST MODELS
// ======================================================

public record RegisterRequest(
    string Name,
    string Role,
    string Phone,
    string VehicleName,
    string VehicleNumber,
    string FirebaseIdToken
);

public record LoginRequest(
    string Email,
    string Password
);


public record CreateOrderRequest(
    int UserId,
    string FuelType,
    decimal Amount,
    decimal Quantity,
    string Payment,
    double Latitude,
    double Longitude
);

public record OrderRequest(
    int UserId, string FuelType, decimal Amount, decimal Quantity, string Payment,
    double Latitude, double Longitude, string PickupStationId, string PickupStationName,
    string? PickupAddress, double PickupLatitude, double PickupLongitude
);

public record EVBookingRequest(
    int UserId,
    string StationName,
    string ChargerType,
    decimal PricePerKwh,
    string TimeSlot
);

public record FirebaseLoginRequest(string Phone, string FirebaseIdToken);

public record WhatsAppRegistrationRequest(
    string Name,
    string Phone,
    string Role,
    string VehicleName,
    string VehicleNumber
);

public record AdminPinRequest(string Pin);

public record WhatsAppLoginRequest(string Phone);

