using DroneDelivery.Domain;

namespace DroneDelivery.CustomerSimulator;

/// <param name="PeakCustomers">Customers ordering at the busiest point of the demand cycle.</param>
/// <param name="OrdersPerCustomerPerHour">How often an active customer orders.</param>
/// <param name="CycleLength">A compressed "day": demand rises from a quiet floor to the peak and back.</param>
public sealed record DemandOptions(int PeakCustomers, double OrdersPerCustomerPerHour, TimeSpan CycleLength, double QuietShare, int? Seed)
{
    public static DemandOptions FromConfiguration(IConfiguration configuration) => new(
        configuration.GetValue("CUSTOMERS_PEAK", 60),
        configuration.GetValue("ORDERS_PER_CUSTOMER_PER_HOUR", 3.0),
        TimeSpan.FromMinutes(configuration.GetValue("DEMAND_CYCLE_MINUTES", 15.0)),
        configuration.GetValue("DEMAND_QUIET_SHARE", .2),
        configuration.GetValue<int?>("CUSTOMER_SEED"));

    /// <summary>Customers active at a point in the cycle, starting quiet and peaking halfway through.</summary>
    public int ActiveCustomers(TimeSpan sinceStart)
    {
        var phase = sinceStart.TotalSeconds % CycleLength.TotalSeconds / CycleLength.TotalSeconds;
        var shape = .5 - .5 * Math.Cos(2 * Math.PI * phase);
        return (int)Math.Round(PeakCustomers * (QuietShare + (1 - QuietShare) * shape));
    }
}

public sealed record Customer(string Id, string Name, GeoPoint Location);

public static class Menu
{
    static readonly string[] Coffees = ["Flat white", "Latte", "Long black", "Cappuccino", "Piccolo latte", "Magic", "Mocha", "Iced latte"];
    static readonly string[] Treats = ["Anzac biscuit", "Lamington", "Almond croissant", "Banana bread"];
    static readonly string[] FirstNames = ["Ava", "Noah", "Mia", "Leo", "Isla", "Oliver", "Zoe", "Jack", "Ruby", "Hamish", "Priya", "Wei", "Sofia", "Tariq", "Grace", "Luca"];
    static readonly string[] Initials = ["A", "B", "C", "D", "F", "K", "L", "M", "N", "P", "R", "S", "T", "W"];

    public static IReadOnlyList<Customer> Customers(int count, Random random) =>
        Enumerable.Range(1, count)
            .Select(i => new Customer($"customer-{i:000}", $"{FirstNames[random.Next(FirstNames.Length)]} {Initials[random.Next(Initials.Length)]}.", ServiceArea.RandomPoint(random)))
            .ToList();

    /// <summary>Most orders fit a Piccolo; quad payloads are rare but need the scarce Abbondante drones.</summary>
    public static IReadOnlyList<OrderLine> Basket(Random random)
    {
        var roll = random.NextDouble();
        var bays = roll < .6 ? 1 : roll < .88 ? 2 : random.Next(3, 5);
        return Enumerable.Range(0, bays)
            .Select(_ => random.NextDouble() < .75
                ? new OrderLine(Coffees[random.Next(Coffees.Length)], 1)
                : new OrderLine(Treats[random.Next(Treats.Length)], 1))
            .ToList();
    }

    /// <summary>Payload boxes come in 1, 2 and 4 bays.</summary>
    public static int PayloadFor(IReadOnlyList<OrderLine> lines) => lines.Sum(line => line.Bays) switch
    {
        <= 1 => 1,
        2 => 2,
        _ => 4,
    };
}
