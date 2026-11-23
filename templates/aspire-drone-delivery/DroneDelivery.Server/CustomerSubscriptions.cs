using System.Text.RegularExpressions;

namespace DroneDelivery.Server;

// Demo order IDs are routing identities, not authentication. Leases bound memory and fan-out
// without requiring emulator connection/disconnection webhooks.
public sealed partial class CustomerSubscriptions(TimeProvider time)
{
    public static readonly TimeSpan Lease = TimeSpan.FromHours(1);
    public const int Capacity = 512;
    readonly object gate = new();
    readonly Dictionary<string, DateTimeOffset> expires = new(StringComparer.Ordinal);

    public static bool IsValidOrderId(string? orderId) => orderId is not null && OrderIdPattern().IsMatch(orderId);

    public bool TrySubscribe(string orderId)
    {
        if (!IsValidOrderId(orderId))
            return false;
        lock (gate)
        {
            Prune();
            if (expires.Count >= Capacity && !expires.ContainsKey(orderId))
                return false;
            expires[orderId] = time.GetUtcNow() + Lease;
            return true;
        }
    }

    public IReadOnlyList<string> Active()
    {
        lock (gate)
        {
            Prune();
            return expires.Keys.ToArray();
        }
    }

    void Prune()
    {
        var now = time.GetUtcNow();
        foreach (var orderId in expires.Where(entry => entry.Value <= now).Select(entry => entry.Key).ToArray())
            expires.Remove(orderId);
    }

    [GeneratedRegex(@"\AFC-[A-F0-9]{6}\z", RegexOptions.CultureInvariant)]
    private static partial Regex OrderIdPattern();
}
