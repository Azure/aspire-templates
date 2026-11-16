using DroneDelivery.Domain;

namespace DroneDelivery.Tests;

public class DemoSkipTests
{
    static readonly DateTimeOffset Now = new(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
    static readonly GeoPoint Store = ServiceArea.Stores[0].Location;

    [Fact]
    public void Preparation_skip_changes_readiness_without_pretending_a_drone_was_assigned()
    {
        var dispatcher = new Dispatcher();
        dispatcher.Accept(new("FC-123456", "web", "You", Store, 1, [], Now, "web"));
        Assert.True(dispatcher.CanSkip("FC-123456", DemoStage.Preparing, Now));
        Assert.False(dispatcher.CanSkip("FC-123456", DemoStage.Delivering, Now));
        dispatcher.SkipPreparation("FC-123456", Now);
        var order = dispatcher.Order("FC-123456")!;
        Assert.Equal(Now, order.ReadyAt);
        Assert.Null(order.DroneId);
        Assert.Equal(OrderStatus.AwaitingFleet, order.Status);
        Assert.False(dispatcher.CanSkip(order.Order.OrderId, DemoStage.Preparing, Now));
        Assert.False(dispatcher.CanSkip(order.Order.OrderId, DemoStage.ReadyForPickup, Now));
        Assert.False(dispatcher.CanSkip("missing", DemoStage.Preparing, Now));
    }

    [Fact]
    public void Skip_requests_are_scoped_to_order_and_stage_and_safe_to_repeat()
    {
        var skips = new DemoSkips();
        skips.Request(new("queued", DemoStage.ReadyForPickup));
        skips.Request(new("queued", DemoStage.ReadyForPickup));
        Assert.True(skips.Contains("queued", DemoStage.ReadyForPickup));
        Assert.False(skips.Contains("active", DemoStage.ReadyForPickup));
        Assert.False(skips.Contains("queued", DemoStage.Delivering));
        skips.Request(new("active", DemoStage.Delivering));
        skips.Complete("queued");
        Assert.False(skips.Contains("queued", DemoStage.ReadyForPickup));
        Assert.True(skips.Contains("active", DemoStage.Delivering));
    }

    [Fact]
    public void Skip_guard_follows_real_mission_milestones_and_rejects_completed_stages()
    {
        var dispatcher = new Dispatcher();
        dispatcher.Observe(new DroneTelemetry("PIC-01", DroneClass.Piccolo, 1, Now, Store, Store,
            0, 0, 100, DroneState.Parked, Manoeuvre.OnTheGround, null, null, 0));
        dispatcher.Accept(new("FC-123456", "web", "You", Store, 1, [], Now, "web"));
        dispatcher.SkipPreparation("FC-123456", Now);
        var mission = Assert.Single(dispatcher.PlanPending(Now));
        Assert.True(dispatcher.CanSkip(mission.OrderId, DemoStage.ReadyForPickup, Now));
        Assert.False(dispatcher.CanSkip(mission.OrderId, DemoStage.Delivering, Now));
        dispatcher.Observe(new(mission.MissionId, mission.OrderId, mission.DroneId,
            MissionMilestone.PickedUp, Now, Store), Now);
        Assert.False(dispatcher.CanSkip(mission.OrderId, DemoStage.ReadyForPickup, Now));
        Assert.True(dispatcher.CanSkip(mission.OrderId, DemoStage.Delivering, Now));
        dispatcher.Observe(new(mission.MissionId, mission.OrderId, mission.DroneId,
            MissionMilestone.Delivered, Now, Store), Now);
        foreach (var stage in Enum.GetValues<DemoStage>())
            Assert.False(dispatcher.CanSkip(mission.OrderId, stage, Now));
    }
}
