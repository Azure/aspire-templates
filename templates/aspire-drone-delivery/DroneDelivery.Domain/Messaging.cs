using System.Diagnostics;
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
            if (Activity.Current is { Kind: ActivityKind.Consumer } current && current.Source == Tracing.Source)
                current.Describe(message);
            return true;
        }
        message = default!;
        return false;
    }

    /// <summary>
    /// Sends one event. Traced sends get a producer span whose context travels in the event's properties, parented
    /// to <paramref name="parent"/> or the current span. Pass <paramref name="traced"/> false for high-frequency
    /// readings (drone telemetry) that would otherwise flood the trace view.
    /// </summary>
    public static async Task SendAsync<T>(this EventHubProducerClient producer, T message, string partitionKey, CancellationToken cancellationToken,
        ActivityContext parent = default, bool traced = true)
    {
        var data = ToEventData(message);
        using var activity = traced ? Tracing.Start($"send {producer.EventHubName}", parent, ActivityKind.Producer) : null;
        activity?.SetTag("messaging.system", "eventhubs").SetTag("messaging.operation.type", "send")
            .SetTag("messaging.destination.name", producer.EventHubName).SetTag("drone_delivery.message.type", typeof(T).Name)
            .Describe(message);
        Tracing.Inject(activity, data.Properties);
        try
        {
            await producer.SendAsync([data], new SendEventOptions { PartitionKey = partitionKey }, cancellationToken);
        }
        catch (Exception exception)
        {
            activity.Failed(exception);
            throw;
        }
    }

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
                    // Only traced sends carry context; untraced telemetry is processed without a span.
                    var parent = Tracing.Extract(partitionEvent.Data.Properties);
                    using var activity = parent == default ? null
                        : Tracing.Start($"process {consumer.EventHubName}", parent, ActivityKind.Consumer);
                    activity?.SetTag("messaging.system", "eventhubs").SetTag("messaging.operation.type", "process")
                        .SetTag("messaging.destination.name", consumer.EventHubName)
                        .SetTag("drone_delivery.message.type", partitionEvent.Data.Properties.TryGetValue(EventSerializer.TypeProperty, out var type) ? type : null);
                    try
                    {
                        await handle(partitionEvent.Data, cancellationToken);
                    }
                    catch (Exception exception) when (exception is not OperationCanceledException)
                    {
                        activity.Failed(exception);
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
