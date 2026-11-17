using System.Text.Json;

namespace DroneDelivery.Domain;

public sealed class FlightRoutingException(string message) : Exception(message);

public readonly record struct AirPoint(double X, double Y)
{
    public double DistanceTo(AirPoint other) => Math.Sqrt(Math.Pow(X - other.X, 2) + Math.Pow(Y - other.Y, 2));
    public GeoPoint Geo => new(-37.81797 - Y / 4.2 / 650 * .0295, 144.93232 + X / 4.2 / 1000 * .048);
    public static AirPoint From(GeoPoint point) =>
        new((point.Longitude - 144.93232) / .048 * 1000 * 4.2, (-37.81797 - point.Latitude) / .0295 * 650 * 4.2);
}

public sealed record BuildingVolume(IReadOnlyList<AirPoint> Ring, double HeightMetres);
public sealed record FlightWaypoint(GeoPoint Position, double AltitudeMetres);
public sealed record FlightPath(IReadOnlyList<FlightWaypoint> Points, double LaunchAltitude, double LandingAltitude, double CruiseAltitude)
{
    public double DistanceMetres => Points.Zip(Points.Skip(1), (a, b) => a.Position.DistanceTo(b.Position)).Sum();
}

/// <summary>Conservative, buffered building envelopes from the same OSM extract rendered by the clients.</summary>
public sealed class BuildingAirspace(IReadOnlyList<BuildingVolume> buildings)
{
    public const double ClearanceMetres = 6;
    public static BuildingAirspace Empty { get; } = new([]);
    static readonly Lazy<BuildingAirspace> shared = new(Load);
    public static BuildingAirspace Shared => shared.Value;
    public IReadOnlyList<BuildingVolume> Buildings => buildings;

    readonly record struct Envelope(double Left, double Top, double Right, double Bottom, double Height)
    {
        public bool Contains(AirPoint p) => p.X >= Left && p.X <= Right && p.Y >= Top && p.Y <= Bottom;
        public IEnumerable<AirPoint> Corners =>
            [new(Left - .1, Top - .1), new(Right + .1, Top - .1), new(Right + .1, Bottom + .1), new(Left - .1, Bottom + .1)];

        public bool Intersects(AirPoint a, AirPoint b)
        {
            double enter = 0, exit = 1;
            bool Clip(double start, double delta, double min, double max)
            {
                if (Math.Abs(delta) < 1e-10) return start >= min && start <= max;
                var t0 = (min - start) / delta;
                var t1 = (max - start) / delta;
                enter = Math.Max(enter, Math.Min(t0, t1));
                exit = Math.Min(exit, Math.Max(t0, t1));
                return enter <= exit;
            }
            return Clip(a.X, b.X - a.X, Left, Right) && Clip(a.Y, b.Y - a.Y, Top, Bottom);
        }
    }

    readonly Envelope[] envelopes = buildings.Select(building => new Envelope(
        building.Ring.Min(p => p.X) - ClearanceMetres, building.Ring.Min(p => p.Y) - ClearanceMetres,
        building.Ring.Max(p => p.X) + ClearanceMetres, building.Ring.Max(p => p.Y) + ClearanceMetres,
        Math.Max(.6 * 4.2, building.HeightMetres))).ToArray();

    public double PadAltitude(GeoPoint point) =>
        envelopes.Where(e => e.Contains(AirPoint.From(point))).Select(e => e.Height + ClearanceMetres).DefaultIfEmpty(0).Max();

    public bool SegmentClear(GeoPoint from, GeoPoint to, double altitude) =>
        !envelopes.Any(e => e.Height + ClearanceMetres > altitude && e.Intersects(AirPoint.From(from), AirPoint.From(to)));

    public FlightPath Plan(GeoPoint from, GeoPoint to, double? initialAltitude = null, bool landingOnly = false)
    {
        if (this != Empty && (!ServiceArea.Contains(from) || !ServiceArea.Contains(to)))
            throw new FlightRoutingException("No surveyed building coverage outside the simulated service area.");
        var launch = initialAltitude ?? PadAltitude(from);
        var landing = PadAltitude(to);
        if (launch + .01 < PadAltitude(from))
            throw new FlightRoutingException("The current pose is below building clearance; a safe launch or descent cannot be planned.");
        if (landingOnly)
            return new([new(from, launch), new(to, landing)], launch, landing, launch);
        var altitude = Math.Max(DroneSpec.CruiseAltitudeMetres, Math.Max(launch, landing) + 12);
        var obstacles = envelopes.Where(e => e.Height + ClearanceMetres > altitude).ToArray();
        var start = AirPoint.From(from); var end = AirPoint.From(to);
        bool Clear(AirPoint a, AirPoint b) => !obstacles.Any(e => e.Intersects(a, b));
        if (Clear(start, end))
            return Path([from, to]);

        // Visibility graph: corners sit outside buffered envelopes, and every edge is checked, not just its endpoints.
        var nodes = new[] { start, end }.Concat(obstacles.SelectMany(e => e.Corners)
            .Where(p => ServiceArea.Contains(p.Geo) && !obstacles.Any(e => e.Contains(p)))).ToArray();
        var distance = Enumerable.Repeat(double.PositiveInfinity, nodes.Length).ToArray();
        var previous = Enumerable.Repeat(-1, nodes.Length).ToArray();
        var queue = new PriorityQueue<int, double>();
        distance[0] = 0;
        queue.Enqueue(0, 0);
        var visited = new bool[nodes.Length];
        while (queue.TryDequeue(out var index, out _))
        {
            if (visited[index]) continue;
            if (index == 1) break;
            visited[index] = true;
            for (var next = 1; next < nodes.Length; next++)
            {
                var cost = distance[index] + nodes[index].DistanceTo(nodes[next]);
                if (visited[next] || cost >= distance[next] || !Clear(nodes[index], nodes[next])) continue;
                distance[next] = cost;
                previous[next] = index;
                queue.Enqueue(next, cost + nodes[next].DistanceTo(end));
            }
        }
        if (previous[1] < 0)
            throw new FlightRoutingException("No building-clear route connects these pads within the simulated service area.");
        var route = new List<GeoPoint>();
        for (var index = 1; index >= 0; index = previous[index]) route.Add(nodes[index].Geo);
        route.Reverse();
        route[0] = from; route[^1] = to;
        return Path(route);

        FlightPath Path(IReadOnlyList<GeoPoint> route) => new(
            route.Select(point => new FlightWaypoint(point, altitude)).ToArray(), launch, landing, altitude);
    }

    static BuildingAirspace Load()
    {
        using var stream = typeof(BuildingAirspace).Assembly.GetManifestResourceStream("osm-buildings.json")
            ?? throw new InvalidOperationException("The OSM building extract is missing.");
        using var document = JsonDocument.Parse(stream);
        var decoded = document.RootElement.GetProperty("buildings").EnumerateArray().Select(row =>
        {
            var data = row.EnumerateArray().Select(value => value.GetDouble()).ToArray();
            var ring = new List<AirPoint>();
            double x = 0, y = 0;
            for (var i = 1; i + 1 < data.Length; i += 2)
            {
                x = i == 1 ? data[i] : x + data[i];
                y = i == 1 ? data[i + 1] : y + data[i + 1];
                ring.Add(new(x / 10 * 4.2, y / 10 * 4.2));
            }
            // Untagged rendered heights never exceed 12 m. Use that ceiling for conservative clearance.
            return new BuildingVolume(ring, data[0] > 0 ? data[0] / 10 : 12);
        }).ToArray();
        return new(decoded);
    }
}
