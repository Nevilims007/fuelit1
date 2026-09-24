using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;

// Persistent state survives service restarts and free-host sleep cycles.
public sealed class PhoneOtpService(IConfiguration config, IHttpClientFactory clients, PersistentOtp state)
{
    private static readonly SemaphoreSlim gate = new(1, 1);
    public static string Normalize(string? phone)
    {
        var digits = Regex.Replace(phone ?? "", @"\D", "");
        return digits.Length == 12 && digits.StartsWith("91") ? digits[2..] : digits;
    }
    private static byte[] Hash(string id, string code) => SHA256.HashData(Encoding.UTF8.GetBytes(id + code));

    public async Task<string> Send(string phone)
    {
        if (!Regex.IsMatch(phone, @"^[6-9]\d{9}$")) throw new InvalidOperationException("Enter a valid Indian mobile number.");
        await gate.WaitAsync();
        try
        {
            var url = config["SmsGateway:Url"];
            var password = config["SmsGateway:Password"];
            var cloudMode = string.Equals(config["SmsGateway:Mode"], "Cloud", StringComparison.OrdinalIgnoreCase);
            if ((!cloudMode && string.IsNullOrWhiteSpace(url)) || string.IsNullOrWhiteSpace(password) || string.IsNullOrWhiteSpace(config["SmsGateway:Username"]))
                throw new InvalidOperationException("SMS gateway is not configured.");
            await state.Reserve(phone);
            var challengeId = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
            var code = RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
            using var client = clients.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(12);
            client.DefaultRequestHeaders.Authorization = new("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(config["SmsGateway:Username"] + ":" + password)));
            // Cloud credentials are separate from the Android local server credentials.
            var endpoint = cloudMode
                ? "https://api.sms-gate.app/3rdparty/v1/messages"
                : url!.TrimEnd('/') + "/message";
            using var response = await client.PostAsJsonAsync(endpoint, new
            {
                textMessage = new { text = $"Your Fuzio verification OTP is {code}. Valid for 5 minutes. Do not share this code." },
                phoneNumbers = new[] { "+91" + phone }, withDeliveryReport = true
            });
            if (!response.IsSuccessStatusCode) throw new InvalidOperationException("SMS gateway rejected the request. Check its service and credentials.");
            using var result = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            if (!result.RootElement.TryGetProperty("id", out _) ||
                (result.RootElement.TryGetProperty("state", out var messageState) && messageState.GetString() == "Failed"))
                throw new InvalidOperationException("SMS could not be sent. Check the phone's SMS permission and SIM.");
            await state.SaveChallenge(challengeId,phone,code);
            return challengeId;
        }
        catch (HttpRequestException) { throw new InvalidOperationException("Cannot reach your SMS phone. Keep its hotspot and gateway service on."); }
        catch (TaskCanceledException) { throw new InvalidOperationException("SMS phone timed out. Check its connection before requesting another OTP."); }
        finally { gate.Release(); }
    }

    public async Task<(string Phone, string Proof)> Verify(string id, string code)
    {
        await gate.WaitAsync();
        try
        {
            return await state.Verify(id,code);
        }
        finally { gate.Release(); }
    }
    public bool ConsumeProof(string? proof, string phone)
    {
        return state.Consume(proof,phone);
    }
}

public static class PhoneOtpEndpoints
{
    public static void MapPhoneOtp(this WebApplication app)
    {
        app.MapPost("/api/auth/sms/send", async (SmsSend request, PhoneOtpService otp) =>
        {
            try { return Results.Ok(new { challengeId = await otp.Send(PhoneOtpService.Normalize(request.Phone)) }); }
            catch (InvalidOperationException error) { return Results.BadRequest(new { message = error.Message }); }
        });
        app.MapPost("/api/auth/sms/verify", async (SmsVerify request, PhoneOtpService otp, FuelitDbContext db, VerifiedSessions sessions) =>
        {
            try
            {
                var verified = await otp.Verify(request.ChallengeId ?? "", request.Code ?? "");
                var user = await db.Users.FirstOrDefaultAsync(u => u.Phone == verified.Phone);
                if (user == null) return Results.Ok(new { needsProfile = true, verificationToken = verified.Proof });
                otp.ConsumeProof(verified.Proof, verified.Phone);
                return Results.Ok(new { success = true, sessionToken = sessions.Issue(user), userId = user.Id, name = user.Name, role = user.Role, phone = user.Phone, vehicleName = user.VehicleName, vehicleNumber = user.VehicleNumber });
            }
            catch (InvalidOperationException error) { return Results.BadRequest(new { message = error.Message }); }
        });
    }
}
public record SmsSend(string Phone);
public record SmsVerify(string ChallengeId, string Code);

