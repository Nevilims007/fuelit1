using Microsoft.EntityFrameworkCore;

public static class CloudAccess
{
    public static void UseCloudAccess(this WebApplication app)
    {
        app.Use(async (context,next)=>{
            var path=context.Request.Path.Value??"";
            // Legacy email/WhatsApp auth is not the verified phone flow.
            if(path.StartsWith("/api/whatsapp/",StringComparison.OrdinalIgnoreCase) ||
               path.StartsWith("/api/admin/",StringComparison.OrdinalIgnoreCase) ||
               path.Equals("/api/login",StringComparison.OrdinalIgnoreCase) ||
               path.Equals("/api/auth/firebase-login",StringComparison.OrdinalIgnoreCase)) {
                context.Response.StatusCode=404;return;
            }
            if(path.StartsWith("/api/orders",StringComparison.OrdinalIgnoreCase) || path.StartsWith("/api/ev/",StringComparison.OrdinalIgnoreCase)) {
                var session=context.RequestServices.GetRequiredService<VerifiedSessions>().Read(context);
                if(session is null){context.Response.StatusCode=401;return;}
                var parts=path.Split('/',StringSplitOptions.RemoveEmptyEntries);
                var db=context.RequestServices.GetRequiredService<FuelitDbContext>();
                if(parts.Length>=4 && parts[2]=="user") {
                    if(!int.TryParse(parts[3],out var userId) || userId!=session.Value.Id){context.Response.StatusCode=403;return;}
                } else if(parts.Length>=4) {
                    var id=parts[2];
                    var owned=parts[1]=="orders"
                        ? await db.Orders.AnyAsync(x=>x.OrderId==id && x.UserId==session.Value.Id)
                        : await db.EVBookings.AnyAsync(x=>x.BookingId==id && x.UserId==session.Value.Id);
                    if(!owned){context.Response.StatusCode=404;return;}
                }
            }
            await next();
        });
    }
}

