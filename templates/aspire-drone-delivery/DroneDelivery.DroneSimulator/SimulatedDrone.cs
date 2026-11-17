using System.Collections.Concurrent;
using System.Diagnostics;
using DroneDelivery.Domain;

namespace DroneDelivery.DroneSimulator;

public sealed class SimulatedDrone(string id, DroneSpec spec, GeoPoint homePad, double battery)
{
    long sequence;

    public string Id { get; } = id;
    public DroneSpec Spec { get; } = spec;
    public GeoPoint HomePad { get; } = homePad;
    public GeoPoint Position { get; set; } = homePad;
    public double AltitudeMetres { get; set; } = BuildingAirspace.Shared.PadAltitude(homePad);
    public double Heading { get; set; }
    public double CameraPitchDegrees { get; set; } = -90;
    public double PitchDegrees { get; set; }
    public double RollDegrees { get; set; }
    public double SpeedMetresPerSecond { get; set; }
    public IReadOnlyList<FlightWaypoint>? PlannedRoute { get; set; }
    public string? RoutingError { get; set; }
    /// <summary>The store pad this drone has reserved or occupies, if any.</summary>
    public LandingPad? Pad { get; set; }
    public bool CarryingPackage { get; set; }
    public DroneControl? Control { get; set; }
    public ActivityContext MissionTrace { get; set; }
    public double? FlightProgress { get; set; }
    public double BatteryPercent { get; set; } = battery;
    public DroneState State { get; set; } = battery < 100 ? DroneState.Charging : DroneState.Parked;
    public Manoeuvre Manoeuvre { get; set; } = Manoeuvre.OnTheGround;
    public MissionAssigned? Mission { get; set; }
    public ConcurrentQueue<MissionAssigned> Queue { get; } = new();
    public ConcurrentQueue<(DroneCommandRequested Request, ActivityContext Trace)> Commands { get; } = new();
    public HashSet<string> ProcessedCommands { get; } = [];

    public DroneTelemetry Telemetry(DateTimeOffset now) => new(
        Id, Spec.Class, Interlocked.Increment(ref sequence), now, Position, HomePad,
        Math.Round(AltitudeMetres, 1), Math.Round(Heading), Math.Round(BatteryPercent, 1),
        State, Manoeuvre, Mission?.MissionId, Mission?.OrderId, Queue.Count, FlightProgress, CameraPitchDegrees, Control, CarryingPackage,
        PitchDegrees, RollDegrees, SpeedMetresPerSecond, PlannedRoute, RoutingError, Pad?.Id);

    /// <summary>Parked drones sit on their charging pad and top up.</summary>
    public void ChargeFor(TimeSpan elapsed)
    {
        BatteryPercent = Math.Min(100, BatteryPercent + Spec.ChargePerMinute * elapsed.TotalMinutes);
        State = BatteryPercent < 100 ? DroneState.Charging : DroneState.Parked;
        FlightProgress = null;
        PlannedRoute = null;
    }

    public static IReadOnlyList<SimulatedDrone> CreateFleet(FleetOptions options)
    {
        var random = options.Seed is { } seed ? new Random(seed) : new Random();
        var fleet = new List<SimulatedDrone>();
        foreach (var (droneClass, count) in options.FleetSize)
        {
            var prefix = droneClass.ToString()[..3].ToUpperInvariant();
            for (var i = 1; i <= count; i++)
                fleet.Add(new($"{prefix}-{i:00}", DroneSpec.For(droneClass), ServiceArea.RandomPoint(random), Math.Round(35 + random.NextDouble() * 65)));
        }
        return fleet;
    }
}
