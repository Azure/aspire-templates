namespace DroneDelivery.Domain;

/// <summary>When and where a drone will next be free, including work it has already been given.</summary>
public sealed record DroneAvailability(
    string DroneId,
    DroneClass Class,
    GeoPoint Location,
    GeoPoint HomePad,
    double ChargePercent,
    DateTimeOffset AvailableAt);

public sealed record DeliveryRequest(string OrderId, int PayloadBays, GeoPoint Pickup, GeoPoint DropOff, DateTimeOffset ReadyAt);

public sealed record DeliveryPlan(
    string OrderId,
    string DroneId,
    DroneClass Class,
    DateTimeOffset DepartAt,
    DateTimeOffset PickupAt,
    DateTimeOffset DeliverAt,
    TimeSpan ChargeBeforeDeparture,
    DroneAvailability After);

public static class LogisticsPlanner
{
    public static readonly TimeSpan LoadingTime = TimeSpan.FromSeconds(30);
    public static readonly TimeSpan UnloadingTime = TimeSpan.FromSeconds(20);

    /// <summary>
    /// Picks the capable drone that delivers soonest, preferring the smallest class on a tie.
    /// A busy drone's queued work and any charging it needs are part of the estimate, so scarce
    /// large drones push their orders later rather than being double-booked.
    /// </summary>
    public static DeliveryPlan? Plan(DeliveryRequest request, IEnumerable<DroneAvailability> fleet, DateTimeOffset now) =>
        fleet
            .Where(drone => DroneSpec.For(drone.Class).CanCarry(request.PayloadBays))
            .Select(drone => PlanWith(request, drone, now))
            .Where(plan => plan is not null)
            .OrderBy(plan => plan!.DeliverAt)
            .ThenBy(plan => DroneSpec.For(plan!.Class).Bays)
            .ThenBy(plan => plan!.DroneId, StringComparer.Ordinal)
            .FirstOrDefault();

    public static DeliveryPlan? PlanWith(DeliveryRequest request, DroneAvailability drone, DateTimeOffset now)
    {
        try { return PlanClearRoute(request, drone, now); }
        catch (FlightRoutingException) { return null; }
    }

    static DeliveryPlan? PlanClearRoute(DeliveryRequest request, DroneAvailability drone, DateTimeOffset now)
    {
        var spec = DroneSpec.For(drone.Class);
        var toPickup = spec.Leg(drone.Location, request.Pickup);
        var toCustomer = spec.Leg(request.Pickup, request.DropOff);
        var toPad = spec.Leg(request.DropOff, drone.HomePad);
        var needed = toPickup.BatteryPercent + toCustomer.BatteryPercent + toPad.BatteryPercent + DroneSpec.ReserveBatteryPercent;
        if (needed > 100)
            return null;

        var free = drone.AvailableAt > now ? drone.AvailableAt : now;
        var charge = TimeSpan.FromMinutes(Math.Max(0, needed - drone.ChargePercent) / spec.ChargePerMinute);
        // Wait on the pad rather than hovering: leave just in time to arrive when the order is ready.
        var depart = Max(free + charge, request.ReadyAt - toPickup.Duration);
        var arrive = depart + toPickup.Duration;
        var pickup = Max(arrive, request.ReadyAt) + LoadingTime;
        var deliver = pickup + toCustomer.Duration;
        var home = deliver + UnloadingTime + toPad.Duration;
        var chargeAtDeparture = Math.Min(100, drone.ChargePercent + (depart - free).TotalMinutes * spec.ChargePerMinute);
        var after = drone with
        {
            Location = drone.HomePad,
            ChargePercent = chargeAtDeparture - toPickup.BatteryPercent - toCustomer.BatteryPercent - toPad.BatteryPercent,
            AvailableAt = home,
        };
        return new(request.OrderId, drone.DroneId, drone.Class, depart, pickup, deliver, charge, after);
    }

    static DateTimeOffset Max(DateTimeOffset a, DateTimeOffset b) => a > b ? a : b;

    public static TimeSpan PreparationTime(int payloadBays) => TimeSpan.FromSeconds(45 + 15 * payloadBays);
}
