namespace DroneDelivery.Domain;

/// <summary>Fleet classes, named after Italian portion sizes from smallest to most generous.</summary>
public enum DroneClass
{
    Piccolo,
    Doppio,
    Abbondante,
}

/// <param name="Bays">Payload bays; a drone can carry any payload that needs this many bays or fewer.</param>
/// <param name="BatteryPerKm">Percentage of a full battery used per kilometre of cruise.</param>
/// <param name="BatteryPerVerticalManoeuvre">Percentage used by one vertical climb or descent.</param>
/// <param name="ChargePerMinute">Percentage regained per minute on a charging pad.</param>
public sealed record DroneSpec(
    DroneClass Class,
    int Bays,
    double CruiseSpeedMetresPerSecond,
    double VerticalSpeedMetresPerSecond,
    double BatteryPerKm,
    double BatteryPerVerticalManoeuvre,
    double ChargePerMinute)
{
    public const double CruiseAltitudeMetres = 60;
    public const double ReserveBatteryPercent = 15;

    public static readonly IReadOnlyList<DroneSpec> All =
    [
        new(DroneClass.Piccolo, 1, 16, 4, 3.0, .4, 12),
        new(DroneClass.Doppio, 2, 14, 3.5, 4.5, .6, 9),
        new(DroneClass.Abbondante, 4, 12, 3, 7.0, 1.0, 6),
    ];

    public static DroneSpec For(DroneClass droneClass) => All.Single(spec => spec.Class == droneClass);

    public bool CanCarry(int payloadBays) => payloadBays <= Bays;

    public FlightLeg Leg(GeoPoint from, GeoPoint to) => new(this, from, to);
}

public enum DroneState
{
    Charging,
    Parked,
    FlyingToPickup,
    Loading,
    FlyingToCustomer,
    Unloading,
    ReturningToPad,
    EmergencyLanding,
    Grounded,
    FlyingToWaste,
    DiscardingPackage,
}

public enum Manoeuvre
{
    OnTheGround,
    VerticalClimb,
    Cruise,
    VerticalDescent,
}

/// <summary>
/// A building-clear route: vertical take-off, eased travel between waypoints, then a curved final approach
/// that bends from cruise down onto the pad (or a vertical descent where a curve would not clear buildings).
/// </summary>
public sealed record FlightLeg(DroneSpec Spec, GeoPoint From, GeoPoint To,
    double? InitialHeading = null, double? InitialAltitudeMetres = null, bool LandingOnly = false, BuildingAirspace? Airspace = null)
{
    public FlightPath Path { get; } = (Airspace ?? BuildingAirspace.Shared).Plan(From, To, InitialAltitudeMetres, LandingOnly);
    public double DistanceMetres => LandingOnly ? 0 : Path.DistanceMetres;
    public TimeSpan VerticalDuration => TimeSpan.FromSeconds(DroneSpec.CruiseAltitudeMetres / Spec.VerticalSpeedMetresPerSecond);
    public TimeSpan ClimbDuration => LandingOnly ? TimeSpan.Zero :
        TimeSpan.FromSeconds((Path.CruiseAltitude - Path.LaunchAltitude) / Spec.VerticalSpeedMetresPerSecond);
    /// <summary>Time spent descending: along the approach curve, or straight down when there is none.</summary>
    public TimeSpan DescentDuration => Approach is { } approach ? TimeSpan.FromSeconds(approach.Duration) : VerticalDescentDuration;
    public TimeSpan CruiseDuration => TravelDuration - (Approach is { } approach ? TimeSpan.FromSeconds(approach.Duration) : TimeSpan.Zero);
    public TimeSpan Duration => ClimbDuration + TravelDuration + VerticalDescentDuration;
    public double BatteryPercent => DistanceMetres / 1000 * Spec.BatteryPerKm + Spec.BatteryPerVerticalManoeuvre *
        (LandingOnly ? Path.LaunchAltitude - Path.LandingAltitude : 2 * Path.CruiseAltitude - Path.LaunchAltitude - Path.LandingAltitude) /
        DroneSpec.CruiseAltitudeMetres;
    /// <summary>Horizontal distance from the pad at which the final approach starts curving down; 0 for a vertical descent.</summary>
    public double ApproachRadiusMetres => Approach?.Radius ?? 0;
    const double TurnSeconds = 3;
    const int ArcSteps = 48;

    TimeSpan VerticalDescentDuration => Approach is not null ? TimeSpan.Zero : TimeSpan.FromSeconds(
        ((LandingOnly ? Path.LaunchAltitude : Path.CruiseAltitude) - Path.LandingAltitude) / Spec.VerticalSpeedMetresPerSecond);
    TimeSpan TravelDuration => LandingOnly ? TimeSpan.Zero : TimeSpan.FromSeconds(
        Segments.Sum(segment => segment.Motion.Duration) + Math.Max(0, Segments.Length - 1) * TurnSeconds);

    /// <summary>
    /// Quarter ellipse in the vertical plane of the final segment: it leaves cruise level tangentially at
    /// <see cref="Start"/> and meets the pad vertically, so the touchdown is still a VTOL landing.
    /// </summary>
    sealed record ApproachCurve(GeoPoint Start, double Radius, double Drop, double Straight, double[] ArcLengths, double Duration)
    {
        public double Length => Straight + ArcLengths[^1];
        public double AngleAt(double arcDistance)
        {
            var i = Array.BinarySearch(ArcLengths, arcDistance);
            if (i >= 0) return Math.PI / 2 * i / ArcSteps;
            i = Math.Clamp(~i, 1, ArcSteps);
            var f = (arcDistance - ArcLengths[i - 1]) / Math.Max(1e-9, ArcLengths[i] - ArcLengths[i - 1]);
            return Math.PI / 2 * (i - 1 + Math.Clamp(f, 0, 1)) / ArcSteps;
        }
    }

    bool approachResolved;
    ApproachCurve? approach;
    ApproachCurve? Approach
    {
        get
        {
            if (approachResolved) return approach;
            approachResolved = true;
            var last = Path.Points.Count >= 2 ? Path.Points[^2].Position : To;
            var length = last.DistanceTo(To);
            var drop = Path.CruiseAltitude - Path.LandingAltitude;
            if (LandingOnly || length < 10 || drop < 1) return null;
            var airspace = Airspace ?? BuildingAirspace.Shared;
            foreach (var scale in new[] { .6, .4, .25 })
            {
                var radius = Math.Min(drop * scale, length * .8);
                if (radius < 4) break;
                var start = To.Towards(last, radius / length);
                var points = Enumerable.Range(0, ArcSteps + 1).Select(i =>
                {
                    var angle = Math.PI / 2 * i / ArcSteps;
                    return new FlightWaypoint(start.Towards(To, Math.Sin(angle)), Path.LandingAltitude + drop * Math.Cos(angle));
                }).ToArray();
                // Check every arc chord at its lower end, so a sloped approach never clips a buffered envelope.
                if (!points.Zip(points.Skip(1)).All(pair => airspace.SegmentClear(pair.First.Position, pair.Second.Position,
                        Math.Min(pair.First.AltitudeMetres, pair.Second.AltitudeMetres))))
                    continue;
                var arc = new double[ArcSteps + 1];
                for (var i = 1; i <= ArcSteps; i++)
                    arc[i] = arc[i - 1] + Math.Sqrt(Math.Pow(points[i].Position.DistanceTo(points[i - 1].Position), 2) +
                        Math.Pow(points[i].AltitudeMetres - points[i - 1].AltitudeMetres, 2));
                var straight = length - radius;
                var motion = new TravelMotion(straight + arc[^1], Spec.CruiseSpeedMetresPerSecond);
                double lo = 0, hi = motion.Duration;
                for (var i = 0; i < 40; i++)
                {
                    var mid = (lo + hi) / 2;
                    if (motion.At(mid).Fraction * motion.Distance < straight) lo = mid; else hi = mid;
                }
                return approach = new(start, radius, drop, straight, arc, motion.Duration - hi);
            }
            return null;
        }
    }

    /// <summary>The route as flown, including the curved approach, for display alongside the drone.</summary>
    public IReadOnlyList<FlightWaypoint> PlannedRoute
    {
        get
        {
            if (Approach is not { } curve)
                return [new(From, Path.LaunchAltitude), .. Path.Points, new(To, Path.LandingAltitude)];
            var arc = Enumerable.Range(1, 11).Select(i =>
            {
                var angle = Math.PI / 2 * i / 12;
                return new FlightWaypoint(curve.Start.Towards(To, Math.Sin(angle)), Path.LandingAltitude + curve.Drop * Math.Cos(angle));
            });
            return [new(From, Path.LaunchAltitude), .. Path.Points.Take(Path.Points.Count - 1), new(curve.Start, Path.CruiseAltitude), .. arc, new(To, Path.LandingAltitude)];
        }
    }

    (GeoPoint From, GeoPoint To, TravelMotion Motion)[]? segments;
    (GeoPoint From, GeoPoint To, TravelMotion Motion)[] Segments => segments ??= Path.Points.Zip(Path.Points.Skip(1),
        (a, b) => (a.Position, b.Position)).Select((pair, i) => (pair.Item1, pair.Item2, new TravelMotion(
            i == Path.Points.Count - 2 && Approach is { } curve ? curve.Length : pair.Item1.DistanceTo(pair.Item2),
            Spec.CruiseSpeedMetresPerSecond))).ToArray();

    public FlightSample At(TimeSpan elapsed)
    {
        var vertical = ClimbDuration.TotalSeconds;
        var travel = TravelDuration.TotalSeconds;
        var t = Math.Clamp(elapsed.TotalSeconds, 0, Duration.TotalSeconds);
        var progress = Duration == TimeSpan.Zero ? 1 : t / Duration.TotalSeconds;
        var firstBearing = LandingOnly || DistanceMetres < .01 ? InitialHeading ?? 0 : Segments[0].From.HeadingTo(Segments[0].To);
        var lastBearing = LandingOnly || DistanceMetres < .01 ? InitialHeading ?? 0 : Segments[^1].From.HeadingTo(Segments[^1].To);
        var turn = Math.Clamp(t / Math.Max(1, vertical > 0 ? vertical : 4), 0, 1);
        var heading = Turn(InitialHeading ?? firstBearing, firstBearing, Smooth(turn));
        if (t < vertical)
            return Sample(From, Path.LaunchAltitude + (Path.CruiseAltitude - Path.LaunchAltitude) * t / vertical,
                Manoeuvre.VerticalClimb, heading, -90 + 60 * Math.Clamp((t / vertical - .75) * 4, 0, 1), Math.Sin(Math.PI * t / vertical));
        if (!LandingOnly && t < vertical + travel)
        {
            var legTime = t - vertical;
            var incoming = firstBearing;
            for (var i = 0; i < Segments.Length; i++)
            {
                var segment = Segments[i];
                var bearing = segment.From.HeadingTo(segment.To);
                if (i > 0)
                {
                    if (legTime < TurnSeconds)
                        return Sample(segment.From, Path.CruiseAltitude, Manoeuvre.Cruise,
                            Turn(incoming, bearing, Smooth(legTime / TurnSeconds)), -30, .35 * Math.Sin(Math.PI * legTime / TurnSeconds));
                    legTime -= TurnSeconds;
                }
                if (legTime < segment.Motion.Duration)
                {
                    var (fraction, speed) = segment.Motion.At(legTime);
                    var yaw = i == 0 ? heading : bearing;
                    if (i == Segments.Length - 1 && Approach is { } curve)
                    {
                        var distance = fraction * curve.Length;
                        if (distance < curve.Straight)
                            return Sample(segment.From.Towards(curve.Start, distance / curve.Straight), Path.CruiseAltitude,
                                Manoeuvre.Cruise, yaw, -30, Math.Min(1, speed / 3), speed);
                        var angle = curve.AngleAt(distance - curve.Straight);
                        return Sample(curve.Start.Towards(To, Math.Sin(angle)), Path.LandingAltitude + curve.Drop * Math.Cos(angle),
                            Manoeuvre.VerticalDescent, yaw, -30 - 60 * Smooth(Math.Clamp(angle / (Math.PI / 3), 0, 1)),
                            Math.Min(1, speed / 3), speed);
                    }
                    return Sample(segment.From.Towards(segment.To, fraction), Path.CruiseAltitude, Manoeuvre.Cruise,
                        yaw, -30, Math.Min(1, speed / 3), speed);
                }
                legTime -= segment.Motion.Duration;
                incoming = bearing;
            }
        }
        var remaining = Duration.TotalSeconds - t;
        return remaining <= 0
            ? new(To, Path.LandingAltitude, Manoeuvre.OnTheGround, lastBearing, progress, -90)
            : Sample(To, Path.LandingAltitude + Spec.VerticalSpeedMetresPerSecond * remaining, Manoeuvre.VerticalDescent, lastBearing,
                LandingOnly ? -90 : -30 - 60 * Math.Clamp((1 - remaining / DescentDuration.TotalSeconds) * 4, 0, 1),
                Math.Sin(Math.PI * remaining / DescentDuration.TotalSeconds));

        FlightSample Sample(GeoPoint position, double altitude, Manoeuvre manoeuvre, double yaw, double cameraPitch, double strength, double speed = 0)
        {
            // Low-frequency, bounded attitude motion; the autopilot holds the planned position/altitude.
            var phase = From.Latitude * 100 + From.Longitude * 10;
            var pitch = 1.6 * Math.Sin(t * .71 + phase) * strength;
            var roll = 2 * Math.Sin(t * .93 + phase * .7) * strength;
            var turbulenceYaw = 1.2 * Math.Sin(t * .53 + phase * 1.3) * strength;
            return new(position, altitude, manoeuvre, (yaw + turbulenceYaw + 360) % 360, progress, cameraPitch, pitch, roll, speed);
        }
    }

    static double Smooth(double t) => t * t * (3 - 2 * t);
    static double Turn(double from, double to, double t) => (from + ((to - from + 540) % 360 - 180) * t + 360) % 360;
}

/// <summary>Symmetric trapezoidal (or triangular on short hops) horizontal speed profile.</summary>
public readonly record struct TravelMotion(double Distance, double MaxSpeed)
{
    public const double Acceleration = 2;
    double RampTime => Math.Min(MaxSpeed / Acceleration, Math.Sqrt(Distance / Acceleration));
    double PeakSpeed => Acceleration * RampTime;
    public double Duration => Distance <= .001 ? 0 : Distance / PeakSpeed + RampTime;
    public (double Fraction, double Speed) At(double seconds)
    {
        if (Distance <= .001) return (1, 0);
        var t = Math.Clamp(seconds, 0, Duration);
        if (t < RampTime) return (.5 * Acceleration * t * t / Distance, Acceleration * t);
        var remaining = Duration - t;
        if (remaining < RampTime) return (1 - .5 * Acceleration * remaining * remaining / Distance, Acceleration * remaining);
        return ((.5 * PeakSpeed * RampTime + (t - RampTime) * PeakSpeed) / Distance, PeakSpeed);
    }
}

public readonly record struct FlightSample(GeoPoint Position, double AltitudeMetres, Manoeuvre Manoeuvre, double Heading,
    double Progress, double CameraPitchDegrees = -90, double PitchDegrees = 0, double RollDegrees = 0, double SpeedMetresPerSecond = 0);
