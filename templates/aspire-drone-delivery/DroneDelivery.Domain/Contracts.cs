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
    double? FlightProgress = null);

public enum MissionMilestone
{
    Accepted,
    ArrivedAtPickup,
    PickedUp,
    Delivered,
    ReturnedToPad,
    Rejected,
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
