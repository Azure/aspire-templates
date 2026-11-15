namespace DroneDelivery.Domain;

public enum OrderStatus
{
    AwaitingFleet,
    Scheduled,
    DroneEnRoute,
    PickedUp,
    Delivered,
    Unserviceable,
}

public sealed record OrderPhoto(string BlobName, PhotoTrigger Trigger, bool ProofOfDelivery, DateTimeOffset Timestamp);

public sealed record OrderSnapshot(
    OrderPlaced Order,
    PickupLocation Store,
    DateTimeOffset ReadyAt,
    OrderStatus Status,
    string? DroneId,
    DroneClass? DroneClass,
    DateTimeOffset? DepartAt,
    DateTimeOffset? EstimatedPickup,
    DateTimeOffset? EstimatedDelivery,
    DateTimeOffset? DeliveredAt,
    string? Note,
    IReadOnlyList<OrderPhoto> Photos);

public sealed class OrderView(OrderPlaced order, PickupLocation store, DateTimeOffset readyAt)
{
    public OrderPlaced Order { get; } = order;
    public PickupLocation Store { get; } = store;
    public DateTimeOffset ReadyAt { get; } = readyAt;
    public OrderStatus Status { get; set; } = OrderStatus.AwaitingFleet;
    public string? DroneId { get; set; }
    public DroneClass? DroneClass { get; set; }
    public DateTimeOffset? DepartAt { get; set; }
    public DateTimeOffset? EstimatedPickup { get; set; }
    public DateTimeOffset? EstimatedDelivery { get; set; }
    public DateTimeOffset? DeliveredAt { get; set; }
    public string? Note { get; set; }
    public List<OrderPhoto> Photos { get; } = [];

    public OrderSnapshot Snapshot() => new(Order, Store, ReadyAt, Status, DroneId, DroneClass, DepartAt, EstimatedPickup, EstimatedDelivery, DeliveredAt, Note, [.. Photos]);
}

/// <summary>
/// Logistics state: the latest telemetry for every drone, each drone's committed work, and every order.
/// Orders are assigned to the capable drone that can deliver soonest, so when only a few drones can carry a
/// payload, later orders queue behind earlier ones and their estimates include the wait.
/// Thread safe; callers pass the current time so behaviour is deterministic in tests.
/// </summary>
public sealed class Dispatcher
{
    readonly object gate = new();
    readonly Dictionary<string, DroneTelemetry> fleet = [];
    readonly Dictionary<string, DroneAvailability> committed = [];
    readonly Dictionary<string, int> outstanding = [];
    readonly Dictionary<string, OrderView> orders = [];
    readonly Dictionary<string, OrderView> byMission = [];

    public OrderSnapshot Accept(OrderPlaced order)
    {
        var store = ServiceArea.NearestStore(order.DropOff);
        var view = new OrderView(order, store, order.PlacedAt + LogisticsPlanner.PreparationTime(order.PayloadBays));
        lock (gate)
            return (orders.TryAdd(order.OrderId, view) ? view : orders[order.OrderId]).Snapshot();
    }

    public void Observe(DroneTelemetry telemetry)
    {
        lock (gate)
        {
            if (fleet.TryGetValue(telemetry.DroneId, out var previous) && previous.Sequence >= telemetry.Sequence && previous.Timestamp >= telemetry.Timestamp)
                return;
            fleet[telemetry.DroneId] = telemetry;
            // A drone with no committed work is free now, wherever its telemetry says it is.
            if (outstanding.GetValueOrDefault(telemetry.DroneId) == 0 && telemetry.Manoeuvre == Manoeuvre.OnTheGround)
                committed[telemetry.DroneId] = new(telemetry.DroneId, telemetry.Class, telemetry.Position, telemetry.HomePad, telemetry.BatteryPercent, telemetry.Timestamp);
        }
    }

    public void Observe(MissionProgress progress, DateTimeOffset now)
    {
        lock (gate)
        {
            if (!byMission.TryGetValue(progress.MissionId, out var view))
                return;
            var spec = DroneSpec.For(view.DroneClass!.Value);
            switch (progress.Milestone)
            {
                case MissionMilestone.ArrivedAtPickup:
                    view.Status = OrderStatus.DroneEnRoute;
                    view.Note = "Drone waiting at the store";
                    break;
                case MissionMilestone.PickedUp:
                    view.Status = OrderStatus.PickedUp;
                    view.EstimatedDelivery = now + spec.Leg(view.Store.Location, view.Order.DropOff).Duration;
                    view.Note = null;
                    break;
                case MissionMilestone.Delivered:
                    view.Status = OrderStatus.Delivered;
                    view.DeliveredAt = progress.Timestamp;
                    break;
                case MissionMilestone.ReturnedToPad:
                    Release(progress.DroneId);
                    break;
                case MissionMilestone.Rejected:
                    view.Status = OrderStatus.AwaitingFleet;
                    view.Note = progress.Reason;
                    view.DroneId = null;
                    Release(progress.DroneId);
                    break;
                case MissionMilestone.Accepted when now >= (view.DepartAt ?? now):
                    view.Status = OrderStatus.DroneEnRoute;
                    break;
            }
        }
    }

    public void Observe(PhotoCaptured photo)
    {
        lock (gate)
        {
            if (photo.OrderId is { } orderId && orders.TryGetValue(orderId, out var view))
                view.Photos.Add(new(photo.BlobName, photo.Trigger, photo.ProofOfDelivery, photo.Timestamp));
        }
    }

    /// <summary>Plans every order still waiting for a drone, oldest first, and returns the missions to send.</summary>
    public IReadOnlyList<MissionAssigned> PlanPending(DateTimeOffset now)
    {
        var missions = new List<MissionAssigned>();
        lock (gate)
        {
            foreach (var view in orders.Values.Where(order => order.Status == OrderStatus.AwaitingFleet).OrderBy(order => order.Order.PlacedAt).ToList())
            {
                if (committed.Count == 0)
                {
                    view.Note = "Waiting for drones to report in";
                    continue;
                }
                var request = new DeliveryRequest(view.Order.OrderId, view.Order.PayloadBays, view.Store.Location, view.Order.DropOff, view.ReadyAt);
                if (LogisticsPlanner.Plan(request, committed.Values, now) is not { } plan)
                {
                    view.Status = OrderStatus.Unserviceable;
                    view.Note = committed.Values.Any(drone => DroneSpec.For(drone.Class).CanCarry(view.Order.PayloadBays))
                        ? "Out of range for every capable drone"
                        : $"No drone in the fleet has {view.Order.PayloadBays} bays";
                    continue;
                }
                var missionId = $"{plan.DroneId}-{view.Order.OrderId}";
                committed[plan.DroneId] = plan.After;
                outstanding[plan.DroneId] = outstanding.GetValueOrDefault(plan.DroneId) + 1;
                view.Status = OrderStatus.Scheduled;
                view.DroneId = plan.DroneId;
                view.DroneClass = plan.Class;
                view.DepartAt = plan.DepartAt;
                view.EstimatedPickup = plan.PickupAt;
                view.EstimatedDelivery = plan.DeliverAt;
                view.Note = plan.DepartAt - now > TimeSpan.FromMinutes(1)
                    ? $"Queued for {plan.Class} {plan.DroneId}"
                    : plan.ChargeBeforeDeparture > TimeSpan.Zero ? $"{plan.DroneId} is charging first" : null;
                byMission[missionId] = view;
                missions.Add(new(missionId, view.Order.OrderId, plan.DroneId, view.Store.Location, view.Order.DropOff, view.Order.PayloadBays, plan.DepartAt, view.ReadyAt));
            }
        }
        return missions;
    }

    public IReadOnlyList<DroneTelemetry> Fleet()
    {
        lock (gate)
            return fleet.Values.OrderBy(drone => drone.Class).ThenBy(drone => drone.DroneId, StringComparer.Ordinal).ToList();
    }

    public IReadOnlyList<OrderSnapshot> Orders(int take)
    {
        lock (gate)
            return orders.Values.OrderByDescending(order => order.Order.PlacedAt).Take(take).Select(order => order.Snapshot()).ToList();
    }

    public OrderSnapshot? Order(string orderId)
    {
        lock (gate)
            return orders.GetValueOrDefault(orderId)?.Snapshot();
    }

    void Release(string droneId)
    {
        var remaining = Math.Max(0, outstanding.GetValueOrDefault(droneId) - 1);
        outstanding[droneId] = remaining;
        if (remaining == 0 && fleet.TryGetValue(droneId, out var latest))
            committed[droneId] = new(droneId, latest.Class, latest.HomePad, latest.HomePad, latest.BatteryPercent, latest.Timestamp);
    }
}
