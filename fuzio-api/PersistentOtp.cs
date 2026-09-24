using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;

public sealed class OtpChallenge
{
    public string Id { get; set; } = "";
    public string Phone { get; set; } = "";
    public byte[] Hash { get; set; } = [];
    public long Expires { get; set; }
    public int Attempts { get; set; }
}
public sealed class OtpSendAttempt
{
    public int Id { get; set; }
    public string Phone { get; set; } = "";
    public long Created { get; set; }
}
public sealed class OtpProof
{
    public string Id { get; set; } = "";
    public string Phone { get; set; } = "";
    public long Expires { get; set; }
}

// All callers take the same PostgreSQL transaction lock, including overlapping
// deployments. SMS attempts are committed before contacting the carrier gateway.
public sealed class PersistentOtp(FuelitDbContext db)
{
    public static long Now => DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    public static byte[] Hash(string id, string code) => SHA256.HashData(Encoding.UTF8.GetBytes(id + code));
    public static string ProofHash(string proof) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(proof)));
    public async Task Lock()
    {
        if(db.Database.IsNpgsql()) await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(764219031)");
    }
    public async Task Reserve(string phone)
    {
        await using var tx = await db.Database.BeginTransactionAsync(); await Lock();
        var now=Now;
        await db.OtpSendAttempts.Where(x=>x.Created<now-3600).ExecuteDeleteAsync();
        await db.OtpChallenges.Where(x=>x.Expires<now).ExecuteDeleteAsync();
        await db.OtpProofs.Where(x=>x.Expires<now).ExecuteDeleteAsync();
        var recent=db.OtpSendAttempts.Where(x=>x.Phone==phone);
        if(await recent.CountAsync()>=5 || await db.OtpSendAttempts.CountAsync()>=20 || await recent.AnyAsync(x=>x.Created>now-60))
            throw new InvalidOperationException("OTP request limit reached. Please wait before trying again.");
        await db.OtpChallenges.Where(x=>x.Phone==phone).ExecuteDeleteAsync();
        db.OtpSendAttempts.Add(new(){Phone=phone,Created=now});await db.SaveChangesAsync();await tx.CommitAsync();
    }
    public async Task SaveChallenge(string id,string phone,string code)
    {
        db.OtpChallenges.Add(new(){Id=id,Phone=phone,Hash=Hash(id,code),Expires=Now+300});await db.SaveChangesAsync();
    }
    public async Task<(string Phone,string Proof)> Verify(string id,string code)
    {
        await using var tx=await db.Database.BeginTransactionAsync();await Lock();
        var item=await db.OtpChallenges.FindAsync(id);
        if(item is null || item.Expires<Now || item.Attempts>=5)throw new InvalidOperationException("OTP expired or attempt limit reached. Request a new OTP.");
        item.Attempts++;
        if(!CryptographicOperations.FixedTimeEquals(item.Hash,Hash(id,code))) {
            await db.SaveChangesAsync();await tx.CommitAsync();throw new InvalidOperationException("Incorrect OTP. Check your SMS and try again.");
        }
        db.OtpChallenges.Remove(item);
        var proof="sms_"+Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        db.OtpProofs.Add(new(){Id=ProofHash(proof),Phone=item.Phone,Expires=Now+900});
        await db.SaveChangesAsync();await tx.CommitAsync();return(item.Phone,proof);
    }
    public bool Consume(string? proof,string phone)
    {
        if(string.IsNullOrWhiteSpace(proof))return false;
        var hash=ProofHash(proof);var now=Now;
        return db.OtpProofs.Where(x=>x.Id==hash && x.Phone==phone && x.Expires>now).ExecuteDelete()==1;
    }
}

