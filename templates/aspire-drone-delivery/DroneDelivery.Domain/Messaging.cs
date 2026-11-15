using Azure.Messaging.EventHubs;
using Azure.Messaging.EventHubs.Consumer;
using Azure.Messaging.EventHubs.Producer;
using Microsoft.Extensions.Logging;

namespace DroneDelivery.Domain;

public static class Messaging
{
    public static EventData ToEventData<T>(T message)
    {
        var (body, type) = EventSerializer.Serialize(message);
        var data = new EventData(body) { ContentType = "application/json" };
        data.Properties[EventSerializer.TypeProperty] = type;
        return data;
    }

    public static bool TryRead<T>(this EventData data, out T message)
    {
        if (data.Properties.TryGetValue(EventSerializer.TypeProperty, out var type) && Equals(type, typeof(T).Name))
        {
            message = EventSerializer.Deserialize<T>(data.EventBody.ToMemory().Span);
            return true;
        }
        message = default!;
        return false;
    }

    public static Task SendAsync<T>(this EventHubProducerClient producer, T message, string partitionKey, CancellationToken cancellationToken) =>
        producer.SendAsync([ToEventData(message)], new SendEventOptions { PartitionKey = partitionKey }, cancellationToken);

    /// <summary>Reads new events from every partition, reconnecting if the hub is not ready yet.</summary>
    public static async Task ConsumeAsync(
        this EventHubConsumerClient consumer,
        Func<EventData, CancellationToken, Task> handle,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await foreach (var partitionEvent in consumer.ReadEventsAsync(startReadingAtEarliestEvent: false, cancellationToken: cancellationToken))
                {
                    if (partitionEvent.Data is null)
                        continue;
                    try
                    {
                        await handle(partitionEvent.Data, cancellationToken);
                    }
                    catch (Exception exception) when (exception is not OperationCanceledException)
                    {
                        logger.LogError(exception, "Failed to handle an event from {Hub}", consumer.EventHubName);
                    }
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Reading {Hub} failed; retrying", consumer.EventHubName);
                await Task.Delay(TimeSpan.FromSeconds(3), cancellationToken);
            }
        }
    }
}
