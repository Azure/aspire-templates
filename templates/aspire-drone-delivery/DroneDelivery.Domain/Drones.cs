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

/// <summary>A building-clear route, with vertical take-off/landing and eased travel between waypoints.</summary>
public sealed record FlightLeg(DroneSpec Spec, GeoPoint From, GeoPoint To,
    double? InitialHeading = null, double? InitialAltitudeMetres = null, bool LandingOnly = false, BuildingAirspace? Airspace = null)
{
    public FlightPath Path { get; } = (Airspace ?? BuildingAirspace.Shared).Plan(From, To, InitialAltitudeMetres, LandingOnly);
    public double DistanceMetres => LandingOnly ? 0 : Path.DistanceMetres;
    public TimeSpan VerticalDuration => TimeSpan.FromSeconds(DroneSpec.CruiseAltitudeMetres / Spec.VerticalSpeedMetresPerSecond);
    public TimeSpan ClimbDuration => LandingOnly ? TimeSpan.Zero :
        TimeSpan.FromSeconds((Path.CruiseAltitude - Path.LaunchAltitude) / Spec.VerticalSpeedMetresPerSecond);
    public TimeSpan DescentDuration => TimeSpan.FromSeconds(
        ((LandingOnly ? Path.LaunchAltitude : Path.CruiseAltitude) - Path.LandingAltitude) / Spec.VerticalSpeedMetresPerSecond);
    public TimeSpan CruiseDuration => LandingOnly ? TimeSpan.Zero : TimeSpan.FromSeconds(
        Segments.Sum(segment => segment.Motion.Duration) + Math.Max(0, Segments.Length - 1) * TurnSeconds);
    public TimeSpan Duration => ClimbDuration + CruiseDuration + DescentDuration;
    public double BatteryPercent => DistanceMetres / 1000 * Spec.BatteryPerKm +
        Spec.BatteryPerVerticalManoeuvre * (ClimbDuration + DescentDuration).TotalSeconds / VerticalDuration.TotalSeconds;
    const double TurnSeconds = 3;
    (GeoPoint From, GeoPoint To, TravelMotion Motion)[]? segments;
    (GeoPoint From, GeoPoint To, TravelMotion Motion)[] Segments => segments ??= Path.Points.Zip(Path.Points.Skip(1),
        (a, b) => (a.Position, b.Position, new TravelMotion(a.Position.DistanceTo(b.Position), Spec.CruiseSpeedMetresPerSecond))).ToArray();

    public FlightSample At(TimeSpan elapsed)
    {
        var vertical = ClimbDuration.TotalSeconds;
        var cruise = CruiseDuration.TotalSeconds;
        var t = Math.Clamp(elapsed.TotalSeconds, 0, Duration.TotalSeconds);
        var progress = Duration == TimeSpan.Zero ? 1 : t / Duration.TotalSeconds;
        var firstBearing = LandingOnly || DistanceMetres < .01 ? InitialHeading ?? 0 : Segments[0].From.HeadingTo(Segments[0].To);
        var lastBearing = LandingOnly || DistanceMetres < .01 ? InitialHeading ?? 0 : Segments[^1].From.HeadingTo(Segments[^1].To);
        var turn = Math.Clamp(t / Math.Max(1, vertical > 0 ? vertical : 4), 0, 1);
        var heading = Turn(InitialHeading ?? firstBearing, firstBearing, Smooth(turn));
        if (t < vertical)
            return Sample(From, Path.LaunchAltitude + (Path.CruiseAltitude - Path.LaunchAltitude) * t / vertical,
                Manoeuvre.VerticalClimb, heading, -90 + 60 * Math.Clamp((t / vertical - .75) * 4, 0, 1), Math.Sin(Math.PI * t / vertical));
        if (!LandingOnly && t < vertical + cruise)
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
                    return Sample(segment.From.Towards(segment.To, fraction), Path.CruiseAltitude, Manoeuvre.Cruise,
                        i == 0 ? heading : bearing, -30, Math.Min(1, speed / 3), speed);
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
