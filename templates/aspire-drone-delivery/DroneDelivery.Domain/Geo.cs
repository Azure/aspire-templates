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
}

public sealed record PickupLocation(string Id, string Name, GeoPoint Location);
