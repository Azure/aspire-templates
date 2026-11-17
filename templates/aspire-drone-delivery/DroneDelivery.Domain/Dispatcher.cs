using System.Diagnostics;

namespace DroneDelivery.Domain;

public enum OrderStatus
{
    AwaitingFleet,
    Scheduled,
    DroneEnRoute,
    PickedUp,
    Delivered,
    Unserviceable,
    Failed,
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
    IReadOnlyList<OrderPhoto> Photos,
    DroneTelemetry? Telemetry = null,
    IReadOnlyList<CameraPose>? NearbyDrones = null);

/// <summary>What logistics persists for an order: its snapshot plus the mission and trace needed to resume it.</summary>
public sealed record OrderRecord(OrderSnapshot Order, string? MissionId, string? TraceParent);

public sealed class OrderView(OrderPlaced order, PickupLocation store, DateTimeOffset readyAt)
{
    public OrderPlaced Order { get; } = order;
    public PickupLocation Store { get; } = store;
    public DateTimeOffset ReadyAt { get; set; } = readyAt;
    public OrderStatus Status { get; set; } = OrderStatus.AwaitingFleet;
    public string? DroneId { get; set; }
    public DroneClass? DroneClass { get; set; }
    public DateTimeOffset? DepartAt { get; set; }
    public DateTimeOffset? EstimatedPickup { get; set; }
    public DateTimeOffset? EstimatedDelivery { get; set; }
    public DateTimeOffset? DeliveredAt { get; set; }
    public string? Note { get; set; }
    public List<OrderPhoto> Photos { get; } = [];
    public string? MissionId { get; set; }
    /// <summary>Restored after a restart and not yet confirmed by the drone's telemetry.</summary>
    public bool Recovered { get; set; }
    /// <summary>The span that accepted the order; later dispatch, mission and realtime spans join its trace.</summary>
    public ActivityContext Trace { get; init; }

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
    readonly Dictionary<string, string> pendingCommands = [];
    readonly HashSet<string> changed = new(StringComparer.Ordinal);

    /// <summary>How long a restored mission may be overdue before it's treated as lost by a restarted simulator.</summary>
    public static readonly TimeSpan RecoveryGrace = TimeSpan.FromSeconds(30);

    public OrderSnapshot Accept(OrderPlaced order, ActivityContext trace = default)
    {
        var store = ServiceArea.NearestStore(order.DropOff);
        var view = new OrderView(order, store, order.PlacedAt + LogisticsPlanner.PreparationTime(order.PayloadBays)) { Trace = trace };
        lock (gate)
        {
            if (orders.TryAdd(order.OrderId, view))
                changed.Add(order.OrderId);
            return orders[order.OrderId].Snapshot();
        }
    }

    public void Observe(DroneTelemetry telemetry)
    {
        lock (gate)
        {
            if (fleet.TryGetValue(telemetry.DroneId, out var previous) && previous.Sequence >= telemetry.Sequence && previous.Timestamp >= telemetry.Timestamp)
                return;
            fleet[telemetry.DroneId] = telemetry;
            if (telemetry.Control is { Status: CommandStatus.Completed or CommandStatus.Rejected } control &&
                pendingCommands.GetValueOrDefault(telemetry.DroneId) == control.CommandId)
                pendingCommands.Remove(telemetry.DroneId);
            // A drone with no committed work is free now, wherever its telemetry says it is.
            if (outstanding.GetValueOrDefault(telemetry.DroneId) == 0 && telemetry.Manoeuvre == Manoeuvre.OnTheGround &&
                telemetry.State is DroneState.Parked or DroneState.Charging)
                committed[telemetry.DroneId] = new(telemetry.DroneId, telemetry.Class, telemetry.Position, telemetry.HomePad, telemetry.BatteryPercent, telemetry.Timestamp);
            Reconcile(telemetry);
        }
    }

    /// <summary>
    /// Confirms or abandons missions restored after a restart. If the simulator restarted too it has forgotten them:
    /// once the drone sits idle on its pad well past departure, the order is re-dispatched (or failed if it was aboard).
    /// </summary>
    void Reconcile(DroneTelemetry telemetry)
    {
        foreach (var (missionId, view) in byMission.Where(entry => entry.Value.Recovered && entry.Value.DroneId == telemetry.DroneId).ToList())
        {
            if (telemetry.MissionId == missionId)
            {
                view.Recovered = false;
                continue;
            }
            if (telemetry.MissionId is not null || telemetry.Manoeuvre != Manoeuvre.OnTheGround ||
                telemetry.State is not (DroneState.Parked or DroneState.Charging) ||
                telemetry.Timestamp < (view.DepartAt ?? DateTimeOffset.MinValue) + RecoveryGrace)
                continue;
            byMission.Remove(missionId);
            view.Recovered = false;
            view.MissionId = null;
            if (view.Status == OrderStatus.Delivered) { }
            else if (view.Status == OrderStatus.PickedUp)
            {
                view.Status = OrderStatus.Failed;
                view.Note = "Delivery lost while logistics restarted";
                view.EstimatedDelivery = null;
            }
            else
            {
                view.Status = OrderStatus.AwaitingFleet;
                view.Note = "Re-dispatching after a restart";
                view.DroneId = null;
                view.DroneClass = null;
                view.DepartAt = view.EstimatedPickup = view.EstimatedDelivery = null;
            }
            changed.Add(view.Order.OrderId);
            Release(telemetry.DroneId);
        }
    }

    public void Observe(MissionProgress progress, DateTimeOffset now)
    {
        lock (gate)
        {
            if (!byMission.TryGetValue(progress.MissionId, out var view))
                return;
            var spec = DroneSpec.For(view.DroneClass!.Value);
            changed.Add(view.Order.OrderId);
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
                    view.MissionId = null;
                    Release(progress.DroneId);
                    byMission.Remove(progress.MissionId);
                    break;
                case MissionMilestone.Rejected:
                    view.Status = OrderStatus.AwaitingFleet;
                    view.Note = progress.Reason;
                    view.MissionId = null;
                    view.DroneId = null;
                    view.DroneClass = null;
                    view.DepartAt = view.EstimatedPickup = view.EstimatedDelivery = null;
                    Release(progress.DroneId);
                    byMission.Remove(progress.MissionId);
                    break;
                case MissionMilestone.Interrupted:
                    if (view.Status != OrderStatus.Delivered)
                    {
                        view.Status = OrderStatus.Failed;
                        view.Note = progress.Reason ?? "Delivery interrupted by fleet operations";
                        view.EstimatedDelivery = null;
                    }
                    view.MissionId = null;
                    Release(progress.DroneId);
                    byMission.Remove(progress.MissionId);
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
            {
                view.Photos.Add(new(photo.BlobName, photo.Trigger, photo.ProofOfDelivery, photo.Timestamp));
                changed.Add(orderId);
            }
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
                var available = committed.Values.Where(drone => !pendingCommands.ContainsKey(drone.DroneId) &&
                    fleet[drone.DroneId].State is not (DroneState.Grounded or DroneState.EmergencyLanding or DroneState.FlyingToWaste or DroneState.DiscardingPackage) &&
                    fleet[drone.DroneId].Control is not { Status: CommandStatus.Executing }).ToList();
                if (available.Count == 0)
                {
                    SetNote(view, "Waiting for drones to report in");
                    continue;
                }
                var request = new DeliveryRequest(view.Order.OrderId, view.Order.PayloadBays, view.Store.Location, view.Order.DropOff, view.ReadyAt);
                if (LogisticsPlanner.Plan(request, available, now) is not { } plan)
                {
                    if (committed.Values.Except(available).Any(drone => DroneSpec.For(drone.Class).CanCarry(view.Order.PayloadBays)))
                    {
                        SetNote(view, "Waiting for a capable drone to return to dispatch");
                        continue;
                    }
                    view.Status = OrderStatus.Unserviceable;
                    changed.Add(view.Order.OrderId);
                    view.Note = committed.Values.Any(drone => DroneSpec.For(drone.Class).CanCarry(view.Order.PayloadBays))
                        ? "Out of range for every capable drone"
                        : $"No drone in the fleet has {view.Order.PayloadBays} bays";
                    using (var unserviceable = Tracing.Start("dispatch unserviceable", view.Trace))
                        unserviceable.Describe(view.Order)?.SetStatus(ActivityStatusCode.Error, view.Note);
                    continue;
                }
                var missionId = $"{plan.DroneId}-{view.Order.OrderId}-{Guid.NewGuid():N}";
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
                view.MissionId = missionId;
                byMission[missionId] = view;
                changed.Add(view.Order.OrderId);
                missions.Add(new(missionId, view.Order.OrderId, plan.DroneId, view.Store.Location, view.Order.DropOff, view.Order.PayloadBays, plan.DepartAt, view.ReadyAt));
            }
        }
        return missions;
    }

    public ActivityContext TraceOf(string orderId)
    {
        lock (gate)
            return orders.GetValueOrDefault(orderId)?.Trace ?? default;
    }

    public IReadOnlyList<DroneTelemetry> Fleet()
    {
        lock (gate)
            return fleet.Values.OrderBy(drone => drone.Class).ThenBy(drone => drone.DroneId, StringComparer.Ordinal).ToList();
    }

    public bool CanSkip(string orderId, DemoStage stage, DateTimeOffset now)
    {
        lock (gate)
        {
            if (!orders.TryGetValue(orderId, out var view) ||
                view.Status is OrderStatus.Delivered or OrderStatus.Unserviceable or OrderStatus.Failed)
                return false;
            return stage switch
            {
                DemoStage.Preparing => view.Status != OrderStatus.PickedUp && now < view.ReadyAt,
                DemoStage.ReadyForPickup => view.Status != OrderStatus.PickedUp && now >= view.ReadyAt && view.DroneId is not null,
                DemoStage.Delivering => view.Status == OrderStatus.PickedUp,
                _ => false,
            };
        }
    }

    public void SkipPreparation(string orderId, DateTimeOffset now)
    {
        lock (gate)
        {
            if (orders.TryGetValue(orderId, out var view) && view.ReadyAt > now)
            {
                view.ReadyAt = now;
                changed.Add(orderId);
            }
        }
    }

    public IReadOnlyList<OrderSnapshot> Orders(int take)
    {
        lock (gate)
            return orders.Values.OrderByDescending(order => order.Order.PlacedAt).Take(take).Select(order => order.Snapshot()).ToList();
    }

    public OrderSnapshot? Order(string orderId)
    {
        lock (gate)
        {
            var view = orders.GetValueOrDefault(orderId);
            if (view is null)
                return null;
            var telemetry = view.DroneId is { } droneId ? fleet.GetValueOrDefault(droneId) : null;
            // A reserved drone may still be serving an earlier order.
            return view.Snapshot() with
            {
                Telemetry = telemetry?.OrderId == orderId ? telemetry : null,
                NearbyDrones = telemetry?.OrderId != orderId ? [] : fleet.Values
                    .Where(drone => drone.DroneId != telemetry.DroneId &&
                        telemetry.Timestamp - drone.Timestamp < TimeSpan.FromSeconds(30))
                    .OrderBy(drone => drone.Position.DistanceTo(telemetry.Position)).Take(24)
                    .Select(drone => drone.CameraPose()).ToList(),
            };
        }
    }

    public bool TryBeginCommand(DroneCommandRequested command, DateTimeOffset now, out string error)
    {
        lock (gate)
        {
            if (!fleet.TryGetValue(command.DroneId, out var drone))
                error = "Drone not found.";
            else if (now - drone.Timestamp > TimeSpan.FromSeconds(30))
                error = "Waiting for current drone telemetry.";
            else if (pendingCommands.ContainsKey(command.DroneId) || drone.Control is { Status: CommandStatus.Executing })
                error = "A command is already in progress.";
            else if (DroneCommands.Error(drone.State, drone.CarryingPackage, command.Command) is { } invalid)
                error = invalid;
            else
            {
                pendingCommands[command.DroneId] = command.CommandId;
                error = "";
                return true;
            }
            return false;
        }
    }

    public void CancelPendingCommand(DroneCommandRequested command)
    {
        lock (gate)
            if (pendingCommands.GetValueOrDefault(command.DroneId) == command.CommandId)
                pendingCommands.Remove(command.DroneId);
    }

    /// <summary>Returns the orders changed since the last call, for persistence.</summary>
    public IReadOnlyList<OrderRecord> TakeChanges()
    {
        lock (gate)
        {
            var records = changed.Select(orderId => Record(orders[orderId])).ToList();
            changed.Clear();
            return records;
        }
    }

    /// <summary>Marks orders as changed again, e.g. after a failed write.</summary>
    public void MarkChanged(IEnumerable<string> orderIds)
    {
        lock (gate)
            changed.UnionWith(orderIds.Where(orders.ContainsKey));
    }

    /// <summary>Reloads persisted orders at startup. Active missions keep their drone reserved until they finish or are found lost.</summary>
    public void Restore(IEnumerable<OrderRecord> records)
    {
        lock (gate)
        {
            foreach (var record in records)
            {
                var snapshot = record.Order;
                var view = new OrderView(snapshot.Order, snapshot.Store, snapshot.ReadyAt)
                {
                    Status = snapshot.Status,
                    DroneId = snapshot.DroneId,
                    DroneClass = snapshot.DroneClass,
                    DepartAt = snapshot.DepartAt,
                    EstimatedPickup = snapshot.EstimatedPickup,
                    EstimatedDelivery = snapshot.EstimatedDelivery,
                    DeliveredAt = snapshot.DeliveredAt,
                    Note = snapshot.Note,
                    MissionId = record.MissionId,
                    Trace = ActivityContext.TryParse(record.TraceParent, null, out var trace) ? trace : default,
                };
                view.Photos.AddRange(snapshot.Photos);
                if (!orders.TryAdd(snapshot.Order.OrderId, view))
                    continue;
                if (view.MissionId is { } missionId && view.DroneId is { } droneId &&
                    view.Status is OrderStatus.Scheduled or OrderStatus.DroneEnRoute or OrderStatus.PickedUp or OrderStatus.Delivered)
                {
                    view.Recovered = true;
                    byMission[missionId] = view;
                    outstanding[droneId] = outstanding.GetValueOrDefault(droneId) + 1;
                }
            }
        }
    }

    static OrderRecord Record(OrderView view) => new(view.Snapshot(), view.MissionId,
        view.Trace == default ? null : $"00-{view.Trace.TraceId}-{view.Trace.SpanId}-{(view.Trace.TraceFlags.HasFlag(ActivityTraceFlags.Recorded) ? "01" : "00")}");

    void SetNote(OrderView view, string note)
    {
        if (view.Note == note)
            return;
        view.Note = note;
        changed.Add(view.Order.OrderId);
    }

    void Release(string droneId)
    {
        var remaining = Math.Max(0, outstanding.GetValueOrDefault(droneId) - 1);
        outstanding[droneId] = remaining;
        if (remaining == 0 && fleet.TryGetValue(droneId, out var latest))
            committed[droneId] = new(droneId, latest.Class, latest.HomePad, latest.HomePad, latest.BatteryPercent, latest.Timestamp);
    }
}
