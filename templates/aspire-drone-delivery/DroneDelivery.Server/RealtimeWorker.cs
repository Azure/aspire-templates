using System.Diagnostics;
using DroneDelivery.Domain;
using Microsoft.AspNetCore.SignalR;

namespace DroneDelivery.Server;

public sealed record OperatorSnapshot(
    IReadOnlyList<DroneTelemetry> Fleet,
    IReadOnlyList<OrderSnapshot> Orders,
    IReadOnlyList<PickupLocation> Stores);

public sealed class RealtimeWorker(
    Dispatcher dispatcher, CustomerSubscriptions subscriptions, RealtimeContexts hubs,
    TimeProvider time, ILogger<RealtimeWorker> logger) : BackgroundService
{
    // Updates go out every second; only a change in an order's stage gets a span, so traces show what customers saw change.
    readonly Dictionary<string, string> published = [];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1), time);
        while (await timer.WaitForNextTickAsync(stoppingToken))
            await BroadcastAsync(stoppingToken);
    }

    public async Task BroadcastAsync(CancellationToken cancellationToken)
    {
        try
        {
            var snapshot = new OperatorSnapshot(dispatcher.Fleet(), dispatcher.Orders(100), ServiceArea.Stores);
            await DeliveryMetrics.SendAsync("operator",
                () => hubs.Operators.Clients.All.SendAsync("snapshot", snapshot, cancellationToken));
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            using (var failed = Tracing.Start("realtime publish operator snapshot", kind: ActivityKind.Producer))
                failed.Failed(exception);
            logger.LogError(exception, "Could not broadcast operator snapshot");
        }

        var active = subscriptions.Active().ToHashSet();
        DeliveryMetrics.Subscriptions(active.Count);
        foreach (var gone in published.Keys.Where(orderId => !active.Contains(orderId)).ToList())
            published.Remove(gone);
        foreach (var orderId in active)
        {
            if (dispatcher.Order(orderId) is not { } order)
                continue;
            var stage = $"{order.Status}{(time.GetUtcNow() >= order.ReadyAt ? "/ready" : "")}";
            Activity? StartPublish() =>
                Tracing.Start("realtime publish order update", dispatcher.TraceOf(orderId), ActivityKind.Producer)
                    ?.SetTag("drone_delivery.order.id", orderId).SetTag("drone_delivery.order.status", order.Status.ToString())
                    .SetTag("drone_delivery.order.ready", time.GetUtcNow() >= order.ReadyAt).SetTag("messaging.system", "signalr");
            using var activity = published.GetValueOrDefault(orderId) == stage ? null : StartPublish();
            try
            {
                // A stage change carries its publish span's context so the browser can record receipt in the same trace.
                var traceParent = activity is null ? null : TraceParent(activity);
                await DeliveryMetrics.SendAsync("customer",
                    () => hubs.Customers.Clients.User(orderId).SendAsync("orderUpdated", order, traceParent, cancellationToken));
                published[orderId] = stage;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                if (activity is not null)
                    activity.Failed(exception);
                else
                {
                    using var failed = StartPublish();
                    failed.Failed(exception);
                }
                logger.LogError(exception, "Could not broadcast customer update for {OrderId}", orderId);
            }
        }
    }

    static string TraceParent(Activity activity)
    {
        var properties = new Dictionary<string, object>();
        Tracing.Inject(activity, properties);
        return (string)properties[Tracing.TraceParentProperty];
    }
}
