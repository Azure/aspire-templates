using System.Net;
using DroneDelivery.Domain;
using Microsoft.Azure.Cosmos;

namespace DroneDelivery.Server;

/// <summary>
/// Persists orders in Cosmos DB (one document per order, partitioned by id). Startup reloads them into the
/// dispatcher before logistics consumes any events; afterwards changed orders are written behind once a second.
/// </summary>
public sealed class OrderStore(Container container, Dispatcher dispatcher, ILogger<OrderStore> logger) : BackgroundService
{
    public sealed record OrderDocument(string Id, OrderRecord Record);

    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        var records = new List<OrderRecord>();
        using var query = container.GetItemQueryIterator<OrderDocument>("SELECT * FROM c");
        while (query.HasMoreResults)
            records.AddRange((await query.ReadNextAsync(cancellationToken)).Select(document => document.Record));
        dispatcher.Restore(records);
        logger.LogInformation("Restored {Count} orders from Cosmos DB", records.Count);
        await base.StartAsync(cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
                await FlushAsync();
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        await FlushAsync();
    }

    // Writes aren't cancelled on shutdown, so taken changes always land or go back to the dispatcher.
    async Task FlushAsync()
    {
        var failed = new List<string>();
        await Parallel.ForEachAsync(dispatcher.TakeChanges(), new ParallelOptions { MaxDegreeOfParallelism = 8 }, async (record, token) =>
        {
            var orderId = record.Order.Order.OrderId;
            try
            {
                await container.UpsertItemAsync(new OrderDocument(orderId, record), new PartitionKey(orderId),
                    new ItemRequestOptions { EnableContentResponseOnWrite = false }, token);
            }
            catch (Exception exception) when (exception is CosmosException or HttpRequestException or TaskCanceledException)
            {
                if (exception is not CosmosException { StatusCode: HttpStatusCode.TooManyRequests })
                    logger.LogWarning(exception, "Couldn't persist order {OrderId}; retrying", orderId);
                lock (failed)
                    failed.Add(orderId);
            }
        });
        dispatcher.MarkChanged(failed);
    }
}
