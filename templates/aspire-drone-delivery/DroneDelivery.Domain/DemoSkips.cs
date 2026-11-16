using System.Collections.Concurrent;

namespace DroneDelivery.Domain;

/// <summary>Order-scoped demo commands may arrive before the corresponding queued mission starts.</summary>
public sealed class DemoSkips
{
    readonly ConcurrentDictionary<(string OrderId, DemoStage Stage), byte> skipped = new();

    public void Request(DemoStageSkipped command) => skipped.TryAdd((command.OrderId, command.Stage), 0);
    public bool Contains(string orderId, DemoStage stage) => skipped.ContainsKey((orderId, stage));
    public void Complete(string orderId)
    {
        foreach (var stage in Enum.GetValues<DemoStage>())
            skipped.TryRemove((orderId, stage), out _);
    }
}
