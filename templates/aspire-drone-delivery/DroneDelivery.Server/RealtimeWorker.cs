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
            await hubs.Operators.Clients.All.SendAsync("snapshot",
                new OperatorSnapshot(dispatcher.Fleet(), dispatcher.Orders(100), ServiceArea.Stores), cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogError(exception, "Could not broadcast operator snapshot");
        }

        foreach (var orderId in subscriptions.Active())
        {
            if (dispatcher.Order(orderId) is not { } order)
                continue;
            try
            {
                await hubs.Customers.Clients.User(orderId).SendAsync("orderUpdated", order, cancellationToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogError(exception, "Could not broadcast customer update for {OrderId}", orderId);
            }
        }
    }
}
