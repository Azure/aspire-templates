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
}

public enum Manoeuvre
{
    OnTheGround,
    VerticalClimb,
    Cruise,
    VerticalDescent,
}

/// <summary>One take-off, cruise and landing between two points. Drones climb and descend vertically.</summary>
public sealed record FlightLeg(DroneSpec Spec, GeoPoint From, GeoPoint To)
{
    public double DistanceMetres => From.DistanceTo(To);
    public TimeSpan VerticalDuration => TimeSpan.FromSeconds(DroneSpec.CruiseAltitudeMetres / Spec.VerticalSpeedMetresPerSecond);
    public TimeSpan CruiseDuration => TimeSpan.FromSeconds(DistanceMetres / Spec.CruiseSpeedMetresPerSecond);
    public TimeSpan Duration => VerticalDuration * 2 + CruiseDuration;
    public double BatteryPercent => DistanceMetres / 1000 * Spec.BatteryPerKm + Spec.BatteryPerVerticalManoeuvre * 2;

    public FlightSample At(TimeSpan elapsed)
    {
        var vertical = VerticalDuration.TotalSeconds;
        var cruise = CruiseDuration.TotalSeconds;
        var t = Math.Clamp(elapsed.TotalSeconds, 0, Duration.TotalSeconds);
        var progress = Duration == TimeSpan.Zero ? 1 : t / Duration.TotalSeconds;
        if (t < vertical)
            return new(From, DroneSpec.CruiseAltitudeMetres * t / vertical, Manoeuvre.VerticalClimb, From.HeadingTo(To), progress);
        if (t <= vertical + cruise)
        {
            var fraction = cruise == 0 ? 1 : (t - vertical) / cruise;
            return new(From.Towards(To, fraction), DroneSpec.CruiseAltitudeMetres, Manoeuvre.Cruise, From.HeadingTo(To), progress);
        }
        var remaining = Duration.TotalSeconds - t;
        return remaining <= 0
            ? new(To, 0, Manoeuvre.OnTheGround, From.HeadingTo(To), progress)
            : new(To, DroneSpec.CruiseAltitudeMetres * remaining / vertical, Manoeuvre.VerticalDescent, From.HeadingTo(To), progress);
    }
}

public readonly record struct FlightSample(GeoPoint Position, double AltitudeMetres, Manoeuvre Manoeuvre, double Heading, double Progress);
