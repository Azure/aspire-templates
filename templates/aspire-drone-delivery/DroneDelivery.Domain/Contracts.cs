using System.Text.Json;
using System.Text.Json.Serialization;

namespace DroneDelivery.Domain;

/// <summary>Event Hub names shared by the AppHost and the services.</summary>
public static class Hubs
{
    public const string Orders = "orders";
    public const string DroneMissions = "drone-missions";
    public const string DroneTelemetry = "drone-telemetry";
    public const string DronePhotos = "drone-photos";
    public const string PhotoContainer = "drone-photo-store";
}

public sealed record OrderLine(string Item, int Bays);

/// <summary>Published to <see cref="Hubs.Orders"/> by the customer simulator and the web API.</summary>
public sealed record OrderPlaced(
    string OrderId,
    string CustomerId,
    string CustomerName,
    GeoPoint DropOff,
    int PayloadBays,
    IReadOnlyList<OrderLine> Lines,
    DateTimeOffset PlacedAt,
    string Source);

/// <summary>Published to <see cref="Hubs.DroneMissions"/> by logistics, partitioned by drone.</summary>
public sealed record MissionAssigned(
    string MissionId,
    string OrderId,
    string DroneId,
    GeoPoint Pickup,
    GeoPoint DropOff,
    int PayloadBays,
    DateTimeOffset DepartAt,
    DateTimeOffset ReadyAt);

public enum DemoStage { Preparing, ReadyForPickup, Delivering }

public sealed record DemoStageSkipped(string OrderId, DemoStage Stage);

public enum DroneCommand { EmergencyLanding, ReturnToBase, DiscardPackage, Reactivate }
public enum CommandStatus { Executing, Completed, Rejected }
public sealed record DroneCommandRequested(string CommandId, string DroneId, DroneCommand Command);
public sealed record DroneControl(string CommandId, DroneCommand Command, CommandStatus Status, string Message);

// Camera poses shared with customers contain no other customers' orders or mission details.
public sealed record CameraPose(string DroneId, DateTimeOffset Timestamp, GeoPoint Position,
    double AltitudeMetres, double Heading, double CameraPitchDegrees, double PitchDegrees = 0, double RollDegrees = 0, double CameraYawDegrees = 0);

/// <summary>Published to <see cref="Hubs.DroneTelemetry"/> by the drone simulator, partitioned by drone.</summary>
public sealed record DroneTelemetry(
    string DroneId,
    DroneClass Class,
    long Sequence,
    DateTimeOffset Timestamp,
    GeoPoint Position,
    GeoPoint HomePad,
    double AltitudeMetres,
    double Heading,
    double BatteryPercent,
    DroneState State,
    Manoeuvre Manoeuvre,
    string? MissionId,
    string? OrderId,
    int QueuedMissions,
    double? FlightProgress = null,
    double CameraPitchDegrees = -90,
    DroneControl? Control = null,
    bool CarryingPackage = false,
    double PitchDegrees = 0,
    double RollDegrees = 0,
    double SpeedMetresPerSecond = 0,
    IReadOnlyList<FlightWaypoint>? PlannedRoute = null,
    string? RoutingError = null,
    string? PadId = null,
    ManualControlState? Manual = null,
    double CameraYawDegrees = 0,
    DateTimeOffset? StageEndsAt = null)
{
    public CameraPose CameraPose() => new(DroneId, Timestamp, Position, AltitudeMetres, Heading, CameraPitchDegrees, PitchDegrees, RollDegrees, CameraYawDegrees);
}

public enum MissionMilestone
{
    Accepted,
    ArrivedAtPickup,
    PickedUp,
    Delivered,
    ReturnedToPad,
    Rejected,
    Interrupted,
}

/// <summary>Published to <see cref="Hubs.DroneTelemetry"/>; position alone never implies a delivery.</summary>
public sealed record MissionProgress(
    string MissionId,
    string OrderId,
    string DroneId,
    MissionMilestone Milestone,
    DateTimeOffset Timestamp,
    GeoPoint Position,
    string? Reason = null);

public enum PhotoTrigger
{
    TakeoffStart,
    TakeoffEnd,
    Cruise,
    LandingStart,
    LandingEnd,
}

/// <summary>Published to <see cref="Hubs.DronePhotos"/>; the image itself is stored in blob storage.</summary>
public sealed record PhotoCaptured(
    string DroneId,
    string? MissionId,
    string? OrderId,
    PhotoTrigger Trigger,
    bool ProofOfDelivery,
    string BlobName,
    GeoPoint Position,
    double AltitudeMetres,
    DateTimeOffset Timestamp);

/// <summary>JSON bodies with a type name carried alongside so consumers can dispatch.</summary>
public static class EventSerializer
{
    public const string TypeProperty = "type";

    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    public static (byte[] Body, string Type) Serialize<T>(T message) =>
        (JsonSerializer.SerializeToUtf8Bytes(message, Options), typeof(T).Name);

    public static T Deserialize<T>(ReadOnlySpan<byte> body) => JsonSerializer.Deserialize<T>(body, Options)!;
}
