using Azure.Messaging.EventHubs.Consumer;
using Azure.Messaging.EventHubs.Producer;
using DroneDelivery.Domain;

namespace DroneDelivery.Server;

/// <summary>
/// Reads orders, drone telemetry and camera events from Event Hubs, keeps the dispatcher current, and
/// sends each planned mission to the drone simulator on the drone-missions hub.
/// </summary>
public sealed class LogisticsWorker(
    Dispatcher dispatcher,
    [FromKeyedServices(Hubs.Orders)] EventHubConsumerClient orders,
    [FromKeyedServices(Hubs.DroneTelemetry)] EventHubConsumerClient telemetry,
    [FromKeyedServices(Hubs.DronePhotos)] EventHubConsumerClient photos,
    [FromKeyedServices(Hubs.DroneMissions)] EventHubProducerClient missions,
    TimeProvider time,
    ILogger<LogisticsWorker> logger) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => Task.WhenAll(
        orders.ConsumeAsync((data, _) =>
        {
            if (data.TryRead<OrderPlaced>(out var order))
                dispatcher.Accept(order);
            return Task.CompletedTask;
        }, logger, stoppingToken),
        telemetry.ConsumeAsync((data, _) =>
        {
            if (data.TryRead<DroneTelemetry>(out var reading))
                dispatcher.Observe(reading);
            else if (data.TryRead<MissionProgress>(out var progress))
                dispatcher.Observe(progress, time.GetUtcNow());
            return Task.CompletedTask;
        }, logger, stoppingToken),
        photos.ConsumeAsync((data, _) =>
        {
            if (data.TryRead<PhotoCaptured>(out var photo))
                dispatcher.Observe(photo);
            return Task.CompletedTask;
        }, logger, stoppingToken),
        PlanAsync(stoppingToken));

    async Task PlanAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1), time);
        while (await timer.WaitForNextTickAsync(cancellationToken))
        {
            foreach (var mission in dispatcher.PlanPending(time.GetUtcNow()))
            {
                try
                {
                    await missions.SendAsync(mission, mission.DroneId, cancellationToken);
                    logger.LogInformation("Assigned {OrderId} to {DroneId}, departing {DepartAt:t}", mission.OrderId, mission.DroneId, mission.DepartAt);
                }
                catch (Exception exception) when (exception is not OperationCanceledException)
                {
                    logger.LogError(exception, "Could not send mission {MissionId}", mission.MissionId);
                }
            }
        }
    }
}
