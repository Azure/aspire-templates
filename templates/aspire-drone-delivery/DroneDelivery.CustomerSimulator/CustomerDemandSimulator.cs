using Azure.Messaging.EventHubs.Producer;
using DroneDelivery.Domain;

namespace DroneDelivery.CustomerSimulator;

/// <summary>Customers spread across the service area place orders, rising to a configurable peak and back.</summary>
public sealed class CustomerDemandSimulator(
    DemandOptions options,
    EventHubProducerClient orders,
    TimeProvider time,
    ILogger<CustomerDemandSimulator> logger) : BackgroundService
{
    static readonly TimeSpan Tick = TimeSpan.FromSeconds(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var random = options.Seed is { } seed ? new Random(seed) : new Random();
        var customers = Menu.Customers(options.PeakCustomers, random);
        var start = time.GetUtcNow();
        var orderChance = options.OrdersPerCustomerPerHour / 3600 * Tick.TotalSeconds;
        logger.LogInformation("Simulating up to {Peak} customers over a {Cycle} demand cycle", options.PeakCustomers, options.CycleLength);

        while (!stoppingToken.IsCancellationRequested)
        {
            var now = time.GetUtcNow();
            var active = options.ActiveCustomers(now - start);
            foreach (var customer in customers.Take(active))
            {
                if (random.NextDouble() >= orderChance)
                    continue;
                var lines = Menu.Basket(random);
                var order = new OrderPlaced(
                    $"FC-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}",
                    customer.Id, customer.Name, customer.Location, Menu.PayloadFor(lines), lines, now, "customer-simulator");
                // Each simulated order starts its own trace, just like a web order.
                using var activity = Tracing.Start("customer simulator place order").Describe(order);
                try
                {
                    await orders.SendAsync(order, customer.Id, stoppingToken);
                    logger.LogInformation("{Customer} ordered {OrderId} ({Bays} bays); {Active} customers active", customer.Name, order.OrderId, order.PayloadBays, active);
                }
                catch (Exception exception) when (exception is not OperationCanceledException)
                {
                    activity.Failed(exception);
                    logger.LogWarning(exception, "Could not publish order {OrderId}", order.OrderId);
                }
            }
            await Task.Delay(Tick, time, stoppingToken);
        }
    }
}
