using System.Diagnostics;

namespace DroneDelivery.Domain;

/// <summary>
/// The DroneDelivery ActivitySource, W3C trace context carried in Event Hubs properties, and the only span
/// attributes our own spans record. Names, drop-off coordinates, order contents and tokens never become attributes.
/// </summary>
public static class Tracing
{
    public const string SourceName = "DroneDelivery";
    public const string TraceParentProperty = "traceparent";
    public const string TraceStateProperty = "tracestate";

    public static readonly ActivitySource Source = new(SourceName);

    public static void Inject(Activity? activity, IDictionary<string, object> properties)
    {
        if (activity is null)
            return;
        properties[TraceParentProperty] = $"00-{activity.TraceId}-{activity.SpanId}-{(activity.Recorded ? "01" : "00")}";
        if (activity.TraceStateString is { Length: > 0 } state)
            properties[TraceStateProperty] = state;
    }

    public static ActivityContext Extract(IDictionary<string, object> properties) =>
        properties.TryGetValue(TraceParentProperty, out var parent) && parent is string traceParent &&
        ActivityContext.TryParse(traceParent, properties.TryGetValue(TraceStateProperty, out var state) ? state as string : null, isRemote: true, out var context)
            ? context
            : default;

    /// <summary>Starts a span under <paramref name="parent"/>, or under the current span when there is no parent.</summary>
    public static Activity? Start(string name, ActivityContext parent = default, ActivityKind kind = ActivityKind.Internal, IEnumerable<ActivityLink>? links = null) =>
        Source.StartActivity(name, kind, parent, links: links);

    public static Activity? Failed(this Activity? activity, Exception exception)
    {
        activity?.AddException(exception);
        activity?.SetStatus(ActivityStatusCode.Error, exception.Message);
        return activity;
    }

    /// <summary>Records identifiers and stages from a message; never customer details or payload contents.</summary>
    public static Activity? Describe(this Activity? activity, object? message)
    {
        if (activity is null)
            return null;
        switch (message)
        {
            case DroneCommandRequested command:
                activity.SetTag("drone_delivery.drone.id", command.DroneId).SetTag("drone_delivery.command", command.Command.ToString())
                    .SetTag("drone_delivery.command.id", command.CommandId);
                break;
            case OrderPlaced order:
                activity.SetTag("drone_delivery.order.id", order.OrderId).SetTag("drone_delivery.order.payload_bays", order.PayloadBays)
                    .SetTag("drone_delivery.order.source", order.Source);
                break;
            case MissionAssigned mission:
                activity.SetTag("drone_delivery.order.id", mission.OrderId).SetTag("drone_delivery.drone.id", mission.DroneId)
                    .SetTag("drone_delivery.mission.id", mission.MissionId);
                break;
            case MissionProgress progress:
                activity.SetTag("drone_delivery.order.id", progress.OrderId).SetTag("drone_delivery.drone.id", progress.DroneId)
                    .SetTag("drone_delivery.mission.id", progress.MissionId).SetTag("drone_delivery.mission.milestone", progress.Milestone.ToString());
                break;
            case PhotoCaptured photo:
                activity.SetTag("drone_delivery.order.id", photo.OrderId).SetTag("drone_delivery.drone.id", photo.DroneId)
                    .SetTag("drone_delivery.photo.trigger", photo.Trigger.ToString()).SetTag("drone_delivery.photo.proof_of_delivery", photo.ProofOfDelivery);
                break;
            case DemoStageSkipped skip:
                activity.SetTag("drone_delivery.order.id", skip.OrderId).SetTag("drone_delivery.demo.stage", skip.Stage.ToString());
                break;
            case DroneTelemetry telemetry:
                activity.SetTag("drone_delivery.drone.id", telemetry.DroneId).SetTag("drone_delivery.order.id", telemetry.OrderId);
                break;
        }
        return activity;
    }
}
