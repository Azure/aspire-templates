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

/// <summary>One take-off, cruise and landing between two points. Drones climb and descend vertically.</summary>
public sealed record FlightLeg(DroneSpec Spec, GeoPoint From, GeoPoint To,
    double? InitialHeading = null, double InitialAltitudeMetres = 0, bool LandingOnly = false)
{
    public double DistanceMetres => From.DistanceTo(To);
    public TimeSpan VerticalDuration => TimeSpan.FromSeconds(DroneSpec.CruiseAltitudeMetres / Spec.VerticalSpeedMetresPerSecond);
    public TimeSpan ClimbDuration => LandingOnly ? TimeSpan.Zero :
        TimeSpan.FromSeconds(Math.Max(0, DroneSpec.CruiseAltitudeMetres - InitialAltitudeMetres) / Spec.VerticalSpeedMetresPerSecond);
    public TimeSpan DescentDuration => LandingOnly
        ? TimeSpan.FromSeconds(InitialAltitudeMetres / Spec.VerticalSpeedMetresPerSecond) : VerticalDuration;
    public TimeSpan CruiseDuration => LandingOnly ? TimeSpan.Zero : TimeSpan.FromSeconds(DistanceMetres / Spec.CruiseSpeedMetresPerSecond);
    public TimeSpan Duration => ClimbDuration + CruiseDuration + DescentDuration;
    public double BatteryPercent => DistanceMetres / 1000 * Spec.BatteryPerKm +
        Spec.BatteryPerVerticalManoeuvre * (ClimbDuration + DescentDuration).TotalSeconds / VerticalDuration.TotalSeconds;

    public FlightSample At(TimeSpan elapsed)
    {
        var vertical = ClimbDuration.TotalSeconds;
        var cruise = CruiseDuration.TotalSeconds;
        var t = Math.Clamp(elapsed.TotalSeconds, 0, Duration.TotalSeconds);
        var progress = Duration == TimeSpan.Zero ? 1 : t / Duration.TotalSeconds;
        var bearing = LandingOnly || DistanceMetres < .01 ? InitialHeading ?? 0 : From.HeadingTo(To);
        // Keep the arrival heading on the ground, turning by the shortest arc during the next ascent.
        // An airborne diversion blends its turn over four seconds rather than snapping.
        var turn = Math.Clamp(t / Math.Max(1, vertical > 0 ? vertical : 4), 0, 1);
        turn = turn * turn * (3 - 2 * turn);
        var heading = ((InitialHeading ?? bearing) + ((bearing - (InitialHeading ?? bearing) + 540) % 360 - 180) * turn + 360) % 360;
        if (t < vertical)
            return new(From, InitialAltitudeMetres + (DroneSpec.CruiseAltitudeMetres - InitialAltitudeMetres) * t / vertical,
                Manoeuvre.VerticalClimb, heading, progress, -90 + 60 * Math.Clamp((t / vertical - .75) * 4, 0, 1));
        if (!LandingOnly && t < vertical + cruise)
        {
            var fraction = cruise == 0 ? 1 : (t - vertical) / cruise;
            return new(From.Towards(To, fraction), DroneSpec.CruiseAltitudeMetres, Manoeuvre.Cruise, heading, progress, -30);
        }
        var remaining = Duration.TotalSeconds - t;
        return remaining <= 0
            ? new(To, 0, Manoeuvre.OnTheGround, bearing, progress, -90)
            : new(To, Spec.VerticalSpeedMetresPerSecond * remaining, Manoeuvre.VerticalDescent, heading, progress,
                LandingOnly ? -90 : -30 - 60 * Math.Clamp((1 - remaining / DescentDuration.TotalSeconds) * 4, 0, 1));
    }
}

public readonly record struct FlightSample(GeoPoint Position, double AltitudeMetres, Manoeuvre Manoeuvre, double Heading, double Progress, double CameraPitchDegrees = -90);
