using System.Collections.Concurrent;
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
/// <summary>
/// A planned route. <see cref="Points"/> is the en-route altitude profile (horizontal turns plus altitude breakpoints,
/// linearly interpolated by horizontal distance); <see cref="Turns"/> are the horizontal corners where the drone stops to yaw.
/// </summary>
public sealed record FlightPath(IReadOnlyList<FlightWaypoint> Points, double LaunchAltitude, double LandingAltitude, IReadOnlyList<GeoPoint> Turns)
{
    double[]? distances;
    double[] Distances => distances ??= Points.Select((_, i) => i).Aggregate(new List<double>(), (list, i) =>
    {
        list.Add(i == 0 ? 0 : list[^1] + Points[i - 1].Position.DistanceTo(Points[i].Position));
        return list;
    }).ToArray();

    /// <summary>Horizontal distance along the route to each of <see cref="Points"/>.</summary>
    public IReadOnlyList<double> PointDistances => Distances;
    public double DistanceMetres => Turns.Zip(Turns.Skip(1), (a, b) => a.DistanceTo(b)).Sum();
    public double DepartureAltitude => Points[0].AltitudeMetres;
    public double ArrivalAltitude => Points[^1].AltitudeMetres;
    public double PeakAltitude => Points.Max(point => point.AltitudeMetres);
    /// <summary>Total metres climbed and descended between departure and arrival altitude.</summary>
    public double VerticalVariationMetres => Points.Zip(Points.Skip(1), (a, b) => Math.Abs(b.AltitudeMetres - a.AltitudeMetres)).Sum();

    /// <summary>Profile altitude at a horizontal distance along the route.</summary>
    public double AltitudeAt(double distance)
    {
        var d = Distances;
        if (distance <= 0 || d.Length < 2) return Points[0].AltitudeMetres;
        if (distance >= d[^1]) return Points[^1].AltitudeMetres;
        var i = Array.BinarySearch(d, distance);
        if (i >= 0) return Points[i].AltitudeMetres;
        i = ~i;
        var f = (distance - d[i - 1]) / Math.Max(1e-9, d[i] - d[i - 1]);
        return Points[i - 1].AltitudeMetres + (Points[i].AltitudeMetres - Points[i - 1].AltitudeMetres) * f;
    }
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
        public double Required => Height + ClearanceMetres;
        public double DistanceTo(AirPoint p) => Math.Sqrt(Math.Pow(Math.Max(0, Math.Max(Left - p.X, p.X - Right)), 2) +
            Math.Pow(Math.Max(0, Math.Max(Top - p.Y, p.Y - Bottom)), 2));
        public IEnumerable<AirPoint> Corners =>
            [new(Left - .1, Top - .1), new(Right + .1, Top - .1), new(Right + .1, Bottom + .1), new(Left - .1, Bottom + .1)];

        public bool Intersects(AirPoint a, AirPoint b) => Intersects(a, b, out _, out _);

        public bool Intersects(AirPoint a, AirPoint b, out double enter, out double exit)
        {
            double entered = 0, exited = 1;
            bool Clip(double start, double delta, double min, double max)
            {
                if (Math.Abs(delta) < 1e-10) return start >= min && start <= max;
                var t0 = (min - start) / delta;
                var t1 = (max - start) / delta;
                entered = Math.Max(entered, Math.Min(t0, t1));
                exited = Math.Min(exited, Math.Max(t0, t1));
                return entered <= exited;
            }
            var hit = Clip(a.X, b.X - a.X, Left, Right) && Clip(a.Y, b.Y - a.Y, Top, Bottom);
            (enter, exit) = (entered, exited);
            return hit;
        }
    }

    readonly Envelope[] envelopes = buildings.Select(building => new Envelope(
        building.Ring.Min(p => p.X) - ClearanceMetres, building.Ring.Min(p => p.Y) - ClearanceMetres,
        building.Ring.Max(p => p.X) + ClearanceMetres, building.Ring.Max(p => p.Y) + ClearanceMetres,
        Math.Max(.6 * 4.2, building.HeightMetres))).ToArray();

    /// <summary>
    /// Landing altitude for a point. A store's pads form one deck at the highest of their roof clearances,
    /// so pads that straddle a roof edge are still level with each other.
    /// </summary>
    public double PadAltitude(GeoPoint point) =>
        ServiceArea.Stores.FirstOrDefault(store => store.Pads.Any(pad => pad.Location == point)) is { } store
            ? store.Pads.Max(pad => SurfaceAltitude(pad.Location))
            : SurfaceAltitude(point);

    /// <summary>Lowest safe altitude directly above a point: the tallest buffered envelope containing it, plus clearance.</summary>
    public double ClearanceAltitude(GeoPoint point) => SurfaceAltitude(point);

    double SurfaceAltitude(GeoPoint point)
    {
        var p = AirPoint.From(point);
        return Near(p, p).Where(i => envelopes[i].Contains(p)).Select(i => envelopes[i].Required).DefaultIfEmpty(0).Max();
    }

    public bool SegmentClear(GeoPoint from, GeoPoint to, double altitude) =>
        RequiredAlong(AirPoint.From(from), AirPoint.From(to)) <= altitude;

    double RequiredAlong(AirPoint a, AirPoint b) =>
        Near(a, b).Where(i => envelopes[i].Intersects(a, b)).Select(i => envelopes[i].Required).DefaultIfEmpty(0).Max();

    const double CellMetres = 50;
    Dictionary<(int, int), int[]>? grid;
    IEnumerable<int> Near(AirPoint a, AirPoint b)
    {
        grid ??= envelopes.SelectMany((e, i) =>
                from x in Enumerable.Range((int)Math.Floor(e.Left / CellMetres), (int)Math.Floor(e.Right / CellMetres) - (int)Math.Floor(e.Left / CellMetres) + 1)
                from y in Enumerable.Range((int)Math.Floor(e.Top / CellMetres), (int)Math.Floor(e.Bottom / CellMetres) - (int)Math.Floor(e.Top / CellMetres) + 1)
                select (Cell: (x, y), Index: i))
            .GroupBy(entry => entry.Cell).ToDictionary(group => group.Key, group => group.Select(entry => entry.Index).ToArray());
        var seen = new HashSet<int>();
        for (var x = (int)Math.Floor(Math.Min(a.X, b.X) / CellMetres); x <= (int)Math.Floor(Math.Max(a.X, b.X) / CellMetres); x++)
            for (var y = (int)Math.Floor(Math.Min(a.Y, b.Y) / CellMetres); y <= (int)Math.Floor(Math.Max(a.Y, b.Y) / CellMetres); y++)
                if (grid.TryGetValue((x, y), out var cell))
                    foreach (var i in cell)
                        if (seen.Add(i)) yield return i;
    }

    /// <summary>Lowest en-route altitude above ground, so open streets are not flown at rooftop-pad height.</summary>
    public const double MinimumEnRouteAltitudeMetres = 20;
    /// <summary>Height gained above a launch pad and kept above a landing pad before the curved approach.</summary>
    public const double TerminalMarginMetres = 10;
    /// <summary>Ceiling for this demo's airspace; taller envelopes must be flown around.</summary>
    public const double MaximumAltitudeMetres = 120;
    const double DetourThresholdMetres = 15;
    const double DetourSearchMetres = 600;
    const double SampleSpacingMetres = 5;
    const double ProfileToleranceMetres = 2;

    readonly ConcurrentDictionary<(GeoPoint, GeoPoint, double?, bool, double, double), FlightPath> plans = new();

    /// <summary>
    /// Plans a low-clearance route: a horizontal path that trades detour distance against climbing over tall envelopes
    /// (<paramref name="climbCost"/> horizontal metres per vertical metre), then the lowest altitude profile along it that
    /// keeps clearance over every envelope it crosses and never climbs or descends steeper than <paramref name="maxGradient"/>.
    /// </summary>
    public FlightPath Plan(GeoPoint from, GeoPoint to, double? initialAltitude = null, bool landingOnly = false,
        double climbCost = 2.3, double maxGradient = .25)
    {
        var key = (from, to, initialAltitude, landingOnly, climbCost, maxGradient);
        if (plans.TryGetValue(key, out var cached)) return cached;
        var plan = PlanUncached(from, to, initialAltitude, landingOnly, climbCost, maxGradient);
        if (plans.Count > 4096) plans.Clear();
        return plans[key] = plan;
    }

    FlightPath PlanUncached(GeoPoint from, GeoPoint to, double? initialAltitude, bool landingOnly, double climbCost, double maxGradient)
    {
        if (this != Empty && (!ServiceArea.Contains(from) || !ServiceArea.Contains(to)))
            throw new FlightRoutingException("No surveyed building coverage outside the simulated service area.");
        var launch = initialAltitude ?? PadAltitude(from);
        var landing = PadAltitude(to);
        if (launch + .01 < PadAltitude(from))
            throw new FlightRoutingException("The current pose is below building clearance; a safe launch or descent cannot be planned.");
        if (landingOnly)
            return new([new(from, launch), new(to, landing)], launch, landing, [from, to]);
        var turns = Horizontal(from, to, climbCost);
        return new(Profile(turns, Math.Max(launch, PadAltitude(from) + TerminalMarginMetres), landing + TerminalMarginMetres, maxGradient),
            launch, landing, turns);
    }

    /// <summary>
    /// A* over the corners of tall envelopes. Edge cost = length + climbCost x (metres climbed and descended to clear the tall
    /// envelopes it crosses, from the en-route floor). Low roofs are ignored here and handled by the profile, so this is a
    /// heuristic, not a globally optimal 3D search.
    /// </summary>
    IReadOnlyList<GeoPoint> Horizontal(GeoPoint from, GeoPoint to, double climbCost)
    {
        var start = AirPoint.From(from); var end = AirPoint.From(to);
        var reach = start.DistanceTo(end) + DetourSearchMetres;
        // Envelopes under either endpoint are covered by the vertical launch/landing column, not detoured around.
        var tall = envelopes.Where(e => e.Required > MinimumEnRouteAltitudeMetres + DetourThresholdMetres &&
            !e.Contains(start) && !e.Contains(end) && e.DistanceTo(start) + e.DistanceTo(end) <= reach).ToArray();
        var nodes = new[] { start, end }.Concat(tall.SelectMany(e => e.Corners).Where(p =>
            p.DistanceTo(start) + p.DistanceTo(end) <= reach && ServiceArea.Contains(p.Geo) &&
            !tall.Any(e => e.Required > MaximumAltitudeMetres && e.Contains(p)))).ToArray();

        double? Cost(AirPoint a, AirPoint b)
        {
            var spans = new List<(double Enter, double Exit, double Height)>();
            foreach (var e in tall)
            {
                if (!e.Intersects(a, b, out var enter, out var exit)) continue;
                if (e.Required > MaximumAltitudeMetres) return null;
                spans.Add((enter, exit, e.Required));
            }
            var length = a.DistanceTo(b);
            if (spans.Count == 0) return length;
            // Total variation of the stepped clearance requirement, leaving and rejoining the floor.
            var cuts = spans.SelectMany(span => new[] { span.Enter, span.Exit }).Append(0).Append(1).Distinct().Order().ToArray();
            double variation = 0, level = MinimumEnRouteAltitudeMetres;
            foreach (var (t0, t1) in cuts.Zip(cuts.Skip(1)))
            {
                var mid = (t0 + t1) / 2;
                var required = spans.Where(span => span.Enter <= mid && span.Exit >= mid).Select(span => span.Height)
                    .Append(MinimumEnRouteAltitudeMetres).Max();
                variation += Math.Abs(required - level);
                level = required;
            }
            return length + climbCost * (variation + level - MinimumEnRouteAltitudeMetres);
        }

        var distance = Enumerable.Repeat(double.PositiveInfinity, nodes.Length).ToArray();
        var previous = Enumerable.Repeat(-1, nodes.Length).ToArray();
        var visited = new bool[nodes.Length];
        var queue = new PriorityQueue<int, double>();
        distance[0] = 0;
        queue.Enqueue(0, 0);
        while (queue.TryDequeue(out var index, out _))
        {
            if (visited[index]) continue;
            if (index == 1) break;
            visited[index] = true;
            for (var next = 1; next < nodes.Length; next++)
            {
                if (visited[next]) continue;
                var bound = distance[index] + nodes[index].DistanceTo(nodes[next]);
                if (bound >= distance[next] || Cost(nodes[index], nodes[next]) is not { } edge) continue;
                var cost = distance[index] + edge;
                if (cost >= distance[next]) continue;
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
        return route;
    }

    /// <summary>
    /// Lowest gradient-limited altitude profile along the turns. Each ~5 m sample interval must clear every envelope it
    /// touches, the profile is linear between samples, and simplification only ever raises it, so clearance holds along
    /// whole segments, not only at waypoints.
    /// </summary>
    IReadOnlyList<FlightWaypoint> Profile(IReadOnlyList<GeoPoint> turns, double departure, double arrival, double gradient)
    {
        var samples = new List<(double S, AirPoint P, bool Turn)>();
        double along = 0;
        for (var i = 0; i + 1 < turns.Count; i++)
        {
            var (a, b) = (AirPoint.From(turns[i]), AirPoint.From(turns[i + 1]));
            var length = turns[i].DistanceTo(turns[i + 1]);
            var steps = Math.Max(1, (int)Math.Ceiling(length / SampleSpacingMetres));
            for (var k = 0; k < steps; k++)
                samples.Add((along + length * k / steps, new(a.X + (b.X - a.X) * k / steps, a.Y + (b.Y - a.Y) * k / steps), k == 0));
            along += length;
        }
        samples.Add((along, AirPoint.From(turns[^1]), true));
        var n = samples.Count;
        var interval = Enumerable.Range(0, n - 1).Select(i => Math.Max(MinimumEnRouteAltitudeMetres, RequiredAlong(samples[i].P, samples[i + 1].P))).ToArray();
        var altitude = Enumerable.Range(0, n).Select(i => Math.Max(i > 0 ? interval[i - 1] : 0, i < n - 1 ? interval[i] : 0)).ToArray();
        altitude[0] = Math.Max(altitude[0], departure);
        altitude[^1] = Math.Max(altitude[^1], arrival);
        // Minimal gradient-limited majorant: forward pass limits descents, backward pass limits climbs.
        for (var i = 1; i < n; i++) altitude[i] = Math.Max(altitude[i], altitude[i - 1] - gradient * (samples[i].S - samples[i - 1].S));
        for (var i = n - 2; i >= 0; i--) altitude[i] = Math.Max(altitude[i], altitude[i + 1] - gradient * (samples[i + 1].S - samples[i].S));

        // Greedy simplification: each kept line stays on or above the profile and within the tolerance of it.
        var keep = new List<int> { 0 };
        for (var k = 0; k < n - 1;)
        {
            var m = k + 1;
            for (var c = k + 2; c < n; c++)
            {
                var fits = true;
                for (var i = k + 1; i < c && fits; i++)
                {
                    var line = altitude[k] + (altitude[c] - altitude[k]) * (samples[i].S - samples[k].S) / (samples[c].S - samples[k].S);
                    fits = line >= altitude[i] - 1e-9 && line <= altitude[i] + ProfileToleranceMetres;
                }
                if (!fits) break;
                m = c;
            }
            keep.Add(m);
            k = m;
        }
        double Interpolated(int i)
        {
            var j = keep.BinarySearch(i);
            if (j >= 0) return altitude[i];
            j = ~j;
            var (a, b) = (keep[j - 1], keep[j]);
            return altitude[a] + (altitude[b] - altitude[a]) * (samples[i].S - samples[a].S) / (samples[b].S - samples[a].S);
        }
        var turn = 0;
        var points = new List<FlightWaypoint>();
        for (var i = 0; i < n; i++)
        {
            if (!samples[i].Turn && keep.BinarySearch(i) < 0) continue;
            points.Add(new(samples[i].Turn ? turns[turn] : samples[i].P.Geo, Interpolated(i)));
            if (samples[i].Turn) turn++;
        }
        return points;
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
