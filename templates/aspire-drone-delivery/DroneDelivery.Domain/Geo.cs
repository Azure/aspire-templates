namespace DroneDelivery.Domain;

public readonly record struct GeoPoint(double Latitude, double Longitude)
{
    const double EarthRadiusMetres = 6_371_000;

    public double DistanceTo(GeoPoint other)
    {
        var lat1 = Radians(Latitude);
        var lat2 = Radians(other.Latitude);
        var dLat = lat2 - lat1;
        var dLon = Radians(other.Longitude - Longitude);
        var a = Math.Pow(Math.Sin(dLat / 2), 2) + Math.Cos(lat1) * Math.Cos(lat2) * Math.Pow(Math.Sin(dLon / 2), 2);
        return 2 * EarthRadiusMetres * Math.Asin(Math.Min(1, Math.Sqrt(a)));
    }

    public double HeadingTo(GeoPoint other)
    {
        var lat1 = Radians(Latitude);
        var lat2 = Radians(other.Latitude);
        var dLon = Radians(other.Longitude - Longitude);
        var y = Math.Sin(dLon) * Math.Cos(lat2);
        var x = Math.Cos(lat1) * Math.Sin(lat2) - Math.Sin(lat1) * Math.Cos(lat2) * Math.Cos(dLon);
        return (Math.Atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    // Straight-line interpolation is accurate enough over a few kilometres.
    public GeoPoint Towards(GeoPoint other, double fraction) => new(
        Latitude + (other.Latitude - Latitude) * fraction,
        Longitude + (other.Longitude - Longitude) * fraction);

    static double Radians(double degrees) => degrees * Math.PI / 180;
}

/// <summary>The fictional South Melbourne service area and ForthCoffee's pickup locations.</summary>
public static class ServiceArea
{
    public const double South = -37.845, North = -37.826, West = 144.950, East = 144.978;

    public static readonly IReadOnlyList<PickupLocation> Stores =
    [
        new("coventry", "ForthCoffee, Coventry Street", new(-37.8318, 144.9580)),
        new("clarendon", "ForthCoffee, Clarendon Street", new(-37.8352, 144.9566)),
        new("albert-park", "ForthCoffee, Albert Park kiosk", new(-37.8402, 144.9661)),
    ];

    public static readonly PickupLocation Waste = new("waste", "ForthCoffee waste drop-off (simulated)", new(-37.8364, 144.9602));

    public static bool Contains(GeoPoint point) =>
        point.Latitude is >= South and <= North && point.Longitude is >= West and <= East;

    public static GeoPoint RandomPoint(Random random) =>
        new(South + random.NextDouble() * (North - South), West + random.NextDouble() * (East - West));

    public static PickupLocation NearestStore(GeoPoint point) =>
        Stores.MinBy(store => store.Location.DistanceTo(point))!;

    public static PickupLocation? StoreAt(GeoPoint point) => Stores.FirstOrDefault(store => store.Location == point);

    public const int PadsPerStore = 4;
    public const double PadSpacingMetres = 9;

    static readonly Dictionary<string, IReadOnlyList<LandingPad>> pads = Stores.ToDictionary(store => store.Id, store =>
    {
        // A 2 x 2 deck centred on the store, far enough apart that parked drones and their final descents never overlap.
        var centre = AirPoint.From(store.Location);
        var half = PadSpacingMetres / 2;
        return (IReadOnlyList<LandingPad>)Enumerable.Range(0, PadsPerStore).Select(i => new LandingPad(
            $"{store.Id}-{i + 1}", i + 1,
            new AirPoint(centre.X + (i % 2 == 0 ? -half : half), centre.Y + (i < 2 ? -half : half)).Geo)).ToArray();
    });

    public static IReadOnlyList<LandingPad> PadsFor(string storeId) => pads.GetValueOrDefault(storeId) ?? [];
}

public sealed record PickupLocation(string Id, string Name, GeoPoint Location)
{
    /// <summary>Physical landing pads; computed, so persisted or deserialised locations stay value-equal.</summary>
    public IReadOnlyList<LandingPad> Pads => ServiceArea.PadsFor(Id);

    /// <summary>The shared pad deck's altitude (rooftop decks sit above building clearance).</summary>
    public double DeckAltitudeMetres => Pads.Count == 0 ? 0 : BuildingAirspace.Shared.PadAltitude(Pads[0].Location);
}

public sealed record LandingPad(string Id, int Number, GeoPoint Location);

/// <summary>
/// Authoritative, thread-safe pad reservations. A drone reserves a pad before it leaves for a store and
/// keeps it until it is physically clear of it, so two drones never share or approach the same pad.
/// </summary>
public sealed class PadAllocator
{
    public const double ClearanceMetres = 8;
    readonly object gate = new();
    readonly Dictionary<string, string> holders = [];

    public LandingPad? TryReserve(PickupLocation store, string droneId)
    {
        lock (gate)
        {
            if (store.Pads.FirstOrDefault(pad => holders.GetValueOrDefault(pad.Id) == droneId) is { } held)
                return held;
            ReleaseLocked(droneId);
            var free = store.Pads.FirstOrDefault(pad => !holders.ContainsKey(pad.Id));
            if (free is not null)
                holders[free.Id] = droneId;
            return free;
        }
    }

    public void Release(string droneId)
    {
        lock (gate) ReleaseLocked(droneId);
    }

    /// <summary>Releases the drone's pad once it is horizontally clear; a drone parked or hovering on it keeps it.</summary>
    public bool ReleaseIfClear(string droneId, LandingPad pad, GeoPoint position)
    {
        if (position.DistanceTo(pad.Location) < ClearanceMetres)
            return false;
        lock (gate)
        {
            if (holders.GetValueOrDefault(pad.Id) == droneId)
                holders.Remove(pad.Id);
        }
        return true;
    }

    public string? HolderOf(string padId)
    {
        lock (gate) return holders.GetValueOrDefault(padId);
    }

    void ReleaseLocked(string droneId)
    {
        foreach (var pad in holders.Where(pair => pair.Value == droneId).Select(pair => pair.Key).ToArray())
            holders.Remove(pad);
    }
}
