using System.Diagnostics;
using System.Diagnostics.Metrics;

namespace DroneDelivery.Domain;

/// <summary>
/// The DroneDelivery Meter. Position ticks and per-second SignalR pushes are too frequent for spans, so they are
/// counted here instead. Tags are limited to small fixed sets (drone class, audience, outcome); never order or drone IDs.
/// </summary>
public static class DeliveryMetrics
{
    public const string MeterName = "DroneDelivery";

    static readonly Meter Meter = new(MeterName);

    static readonly Counter<long> TelemetryReceived = Meter.CreateCounter<long>(
        "drone_delivery.telemetry.received", "{reading}", "Drone position readings applied by the backend.");

    static readonly Histogram<double> TelemetryAge = Meter.CreateHistogram<double>(
        "drone_delivery.telemetry.age", "s", "Time from a drone recording a position to the backend applying it.");

    static readonly Counter<long> RealtimeMessages = Meter.CreateCounter<long>(
        "drone_delivery.realtime.messages", "{message}", "SignalR messages handed to the SignalR service.");

    static readonly Histogram<double> RealtimeSendDuration = Meter.CreateHistogram<double>(
        "drone_delivery.realtime.send.duration", "s", "Time for the SignalR service to accept one message.");

    static readonly Gauge<int> CustomerSubscriptions = Meter.CreateGauge<int>(
        "drone_delivery.realtime.customer_subscriptions", "{order}", "Orders with a live customer subscription.");

    public static void PositionApplied(DroneTelemetry reading, DateTimeOffset now)
    {
        var droneClass = new KeyValuePair<string, object?>("drone_delivery.drone.class", reading.Class.ToString());
        TelemetryReceived.Add(1, droneClass);
        TelemetryAge.Record(Math.Max(0, (now - reading.Timestamp).TotalSeconds), droneClass);
    }

    public static void Subscriptions(int count) => CustomerSubscriptions.Record(count);

    /// <summary>Times one send to the SignalR service. It measures hand-off to the service, not browser receipt.</summary>
    public static async Task SendAsync(string audience, Func<Task> send)
    {
        var started = Stopwatch.GetTimestamp();
        var outcome = "failed";
        try
        {
            await send();
            outcome = "sent";
        }
        finally
        {
            var audienceTag = new KeyValuePair<string, object?>("drone_delivery.realtime.audience", audience);
            RealtimeMessages.Add(1, audienceTag, new("drone_delivery.realtime.outcome", outcome));
            RealtimeSendDuration.Record(Stopwatch.GetElapsedTime(started).TotalSeconds, audienceTag,
                new("drone_delivery.realtime.outcome", outcome));
        }
    }
}
