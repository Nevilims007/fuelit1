using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

public sealed class VerifiedSessions(FuelitDbContext db)
{
    private static string TokenHash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    public string Issue(User user) {
        var token=Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        db.VerifiedLoginSessions.Add(new VerifiedLoginSession {
            TokenHash=TokenHash(token), UserId=user.Id, ExpiresAt=DateTimeOffset.UtcNow.AddHours(24).ToUnixTimeSeconds()
        });
        db.SaveChanges();
        return token;
    }
    public (int Id,string Role)? Read(HttpContext context) {
        var header=context.Request.Headers.Authorization.ToString();
        if(!header.StartsWith("Bearer ") || header.Length != 71)return null;
        var hash=TokenHash(header[7..]);
        var now=DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var session=db.VerifiedLoginSessions.AsNoTracking().FirstOrDefault(s=>s.TokenHash==hash && s.ExpiresAt>now);
        if(session is null)return null;
        var user=db.Users.AsNoTracking().FirstOrDefault(u=>u.Id==session.UserId);
        return user is null ? null : (user.Id,user.Role);
    }
}
public sealed class VerifiedLoginSession
{
    public string TokenHash {get;set;} = "";
    public int UserId {get;set;}
    public long ExpiresAt {get;set;}
}
public sealed class DeliveryPin
{
    public string OrderId {get;set;} = "";
    public string ProtectedCode {get;set;} = "";
    public int Attempts {get;set;}
    public bool Used {get;set;}
}
public record DeliveryConfirmation(string Pin);
public static class DeliverySecurity
{
    private static readonly SemaphoreSlim Gate=new(1,1);
    public static void MapDeliverySecurity(this WebApplication app) {
        app.MapGet("/api/orders/{orderId}/delivery-pin",async (string orderId,HttpContext context,VerifiedSessions sessions,FuelitDbContext db,IDataProtectionProvider protection)=>{
            var session=sessions.Read(context);
            if(session is null || session.Value.Role!="Customer")return Results.Unauthorized();
            await Gate.WaitAsync();
            try {
                var order=await db.Orders.FirstOrDefaultAsync(o=>o.OrderId==orderId && o.UserId==session.Value.Id);
                if(order is null)return Results.NotFound();
                if(order.Status is "Delivered" or "Cancelled")return Results.BadRequest(new {message="This order is closed. The delivery PIN cannot be used."});
                var record=await db.DeliveryPins.FindAsync(orderId);
                var protector=protection.CreateProtector("Fuzio.DeliveryPin.v1");
                if(record is null){
                    record=new DeliveryPin{OrderId=orderId,ProtectedCode=protector.Protect(RandomNumberGenerator.GetInt32(1000,10000).ToString())};
                    db.DeliveryPins.Add(record);await db.SaveChangesAsync();
                }
                if(record.Used || record.Attempts>=5)return Results.BadRequest(new {message="Delivery PIN locked or already used. Contact support; do not create another order just to bypass this lock."});
                context.Response.Headers.CacheControl="no-store";
                return Results.Ok(new {pin=protector.Unprotect(record.ProtectedCode),message="Share only after receiving your fuel."});
            } finally {Gate.Release();}
        });
        app.MapPost("/api/driver/orders/{orderId}/confirm-delivery",async (string orderId,DeliveryConfirmation request,HttpContext context,VerifiedSessions sessions,FuelitDbContext db,IDataProtectionProvider protection)=>{
            var session=sessions.Read(context);
            if(session is null || session.Value.Role!="Driver")return Results.Unauthorized();
            await Gate.WaitAsync();
            try {
                var order=await db.Orders.FirstOrDefaultAsync(o=>o.OrderId==orderId && o.DriverId==session.Value.Id);
                if(order is null)return Results.NotFound();
                if(order.Status!="Driver Arrived")return Results.BadRequest(new {message="Mark arrival first. Completed/cancelled orders cannot be confirmed again."});
                var record=await db.DeliveryPins.FindAsync(orderId);
                if(record is null)return Results.BadRequest(new {message="Ask the customer to open their delivery PIN."});
                if(record.Used || record.Attempts>=5)return Results.BadRequest(new {message="PIN locked or used. Contact support."});
                var expected=protection.CreateProtector("Fuzio.DeliveryPin.v1").Unprotect(record.ProtectedCode);
                var supplied=request.Pin??"";
                if(!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected),Encoding.UTF8.GetBytes(supplied))){
                    record.Attempts++;await db.SaveChangesAsync();
                    return Results.BadRequest(new {message=record.Attempts>=5?"PIN locked after 5 incorrect attempts. Contact support.":$"Incorrect delivery PIN. {5-record.Attempts} attempts left."});
                }
                record.Used=true;record.ProtectedCode="";order.Status="Delivered";
                await db.SaveChangesAsync();
                return Results.Ok(new {success=true,status=order.Status});
            } finally {Gate.Release();}
        });
    }
}

