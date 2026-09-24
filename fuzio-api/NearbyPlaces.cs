using System.Globalization;
using System.Text.Json;

public static class NearbyPlaces
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly Dictionary<string, (DateTime Time, Station[] Stations)> Cache = new();
    public record Station(string Id, string Name, string Brand, string Address, double Latitude,
        double Longitude, double DistanceKm, string Hours);
    public static void MapNearbyPlaces(this WebApplication app)
    {
        app.MapGet("/api/places/nearby", async (double lat, double lon, string? kind, int? radius,
            IHttpClientFactory factory, CancellationToken cancellation) =>
        {
            kind ??= "fuel";
            int range = radius ?? 5000;
            if (!double.IsFinite(lat) || !double.IsFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 ||
                range < 1000 || range > 10000 || (kind != "fuel" && kind != "charging_station"))
                return Results.BadRequest(new { message = "Invalid location or search radius." });
            var key = FormattableString.Invariant($"{lat:F5},{lon:F5}:{kind}:{range}");
            if (!await Gate.WaitAsync(TimeSpan.FromSeconds(3), cancellation))
                return Results.Json(new { message = "Nearby search is busy. Please try again shortly." }, statusCode:503);
            try
            {
                if (Cache.TryGetValue(key, out var cached) && cached.Time > DateTime.UtcNow.AddMinutes(-5))
                    return Results.Ok(new { stations = cached.Stations, source = "OpenStreetMap", updatedAt = cached.Time });
                var query = FormattableString.Invariant($"[out:json][timeout:20];nwr[amenity={kind}](around:{range},{lat:F5},{lon:F5});out center tags;");
                using var client = factory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(25);
                client.DefaultRequestHeaders.UserAgent.ParseAdd("Fuzio/1.0 nearby-stations");
                using var response = await client.PostAsync("https://overpass-api.de/api/interpreter",
                    new FormUrlEncodedContent(new Dictionary<string,string> { ["data"] = query }), cancellation);
                response.EnsureSuccessStatusCode();
                using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellation));
                if (document.RootElement.TryGetProperty("remark", out _) || !document.RootElement.TryGetProperty("elements", out var elements))
                    throw new HttpRequestException("Incomplete map response");
                var stations = new List<Station>();
                foreach (var item in elements.EnumerateArray())
                {
                    var coords = item.TryGetProperty("center", out var center) ? center : item;
                    if (!coords.TryGetProperty("lat", out var x) || !coords.TryGetProperty("lon", out var y) || !item.TryGetProperty("tags", out var tags)) continue;
                    string Tag(string name) => tags.TryGetProperty(name, out var value) ? value.GetString() ?? "" : "";
                    double stationLat = x.GetDouble(), stationLon = y.GetDouble();
                    double distance = Distance(lat, lon, stationLat, stationLon);
                    if (distance > range / 1000.0) continue;
                    var name = Tag("name");
                    if (name.Length == 0) name = Tag("brand");
                    if (name.Length == 0) name = Tag("operator");
                    if (name.Length == 0) name = "Name not available";
                    var address = string.Join(", ", new[] {Tag("addr:housenumber"),Tag("addr:street"),Tag("addr:suburb"),Tag("addr:city"),Tag("addr:postcode")}.Where(s => s.Length > 0));
                    stations.Add(new Station(item.GetProperty("type").GetString() + "/" + item.GetProperty("id").ToString(),
                        name, Tag("brand"), address, stationLat, stationLon, Math.Round(distance, 2), Tag("opening_hours")));
                }
                var result = stations.OrderBy(s => s.DistanceKm).Take(80).ToArray();
                if (Cache.Count >= 128) Cache.Clear();
                var now = DateTime.UtcNow;
                Cache[key] = (now, result);
                return Results.Ok(new { stations = result, source = "OpenStreetMap", updatedAt = now });
            }
            catch (Exception error) when (error is HttpRequestException or TaskCanceledException or JsonException)
            {
                return Results.Json(new { message = "Live station data is unavailable. Please try again. No demo places are shown." }, statusCode:503);
            }
            finally { Gate.Release(); }
        });
    }
    private static double Distance(double a, double b, double c, double d)
    {
        double rad = Math.PI / 180, h = Math.Pow(Math.Sin((c-a)*rad/2),2) + Math.Cos(a*rad)*Math.Cos(c*rad)*Math.Pow(Math.Sin((d-b)*rad/2),2);
        return 6371 * 2 * Math.Asin(Math.Sqrt(Math.Clamp(h,0,1)));
    }
}

