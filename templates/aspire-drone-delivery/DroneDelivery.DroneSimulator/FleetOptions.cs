using DroneDelivery.Domain;

namespace DroneDelivery.DroneSimulator;

/// <summary>Fleet size per class and simulation cadence, read from environment variables.</summary>
public sealed record FleetOptions(
    IReadOnlyDictionary<DroneClass, int> FleetSize,
    int? Seed,
    TimeSpan ParkedTelemetryInterval,
    TimeSpan CruisePhotoInterval)
{
    public static FleetOptions FromConfiguration(IConfiguration configuration) => new(
        new Dictionary<DroneClass, int>
        {
            [DroneClass.Piccolo] = configuration.GetValue("FLEET_PICCOLO", 6),
            [DroneClass.Doppio] = configuration.GetValue("FLEET_DOPPIO", 3),
            [DroneClass.Abbondante] = configuration.GetValue("FLEET_ABBONDANTE", 2),
        },
        configuration.GetValue<int?>("FLEET_SEED"),
        TimeSpan.FromSeconds(configuration.GetValue("PARKED_TELEMETRY_SECONDS", 10)),
        TimeSpan.FromSeconds(configuration.GetValue("CRUISE_PHOTO_SECONDS", 20)));
}
