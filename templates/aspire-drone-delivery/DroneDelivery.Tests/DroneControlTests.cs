using DroneDelivery.Domain;

namespace DroneDelivery.Tests;

public class DroneControlTests
{
    static readonly DateTimeOffset Now = new(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
    static readonly GeoPoint Store = ServiceArea.Stores[0].Location;
    static readonly GeoPoint Customer = new(-37.842, 144.974);
    static DroneTelemetry Reading(string id = "PIC-01") => new(id, DroneClass.Piccolo, 1, Now, Store, Store, 0,
        350, 100, DroneState.Parked, Manoeuvre.OnTheGround, null, null, 0);

    [Fact]
    public void Ascent_turns_from_arrival_heading_and_landing_keeps_the_approach_heading()
    {
        var target = Store.Towards(Customer, .5);
        var bearing = Store.HeadingTo(target);
        var leg = new FlightLeg(DroneSpec.For(DroneClass.Piccolo), Store, target, (bearing + 90) % 360);
        Assert.Equal((bearing + 90) % 360, leg.At(TimeSpan.Zero).Heading, 6);
        Assert.InRange(leg.At(leg.ClimbDuration / 2).Heading, (bearing + 45) % 360 - 1.2, (bearing + 45) % 360 + 1.2);
        Assert.Equal(bearing, leg.At(leg.ClimbDuration).Heading, 6);
        Assert.Equal(bearing, leg.At(leg.Duration).Heading, 6);
        Assert.Equal(-90, leg.At(TimeSpan.Zero).CameraPitchDegrees);
        Assert.Equal(-30, leg.At(leg.ClimbDuration).CameraPitchDegrees);
        Assert.Equal(-90, leg.At(leg.Duration - leg.DescentDuration / 2).CameraPitchDegrees);

        var wrap = new FlightLeg(DroneSpec.For(DroneClass.Piccolo), Store, new(Store.Latitude + .002, Store.Longitude), 350);
        Assert.InRange(wrap.At(wrap.ClimbDuration / 2).Heading, 353.8, 356.2);
    }

    [Fact]
    public void Diversions_begin_at_actual_altitude_and_emergency_lands_in_place()
    {
        var spec = DroneSpec.For(DroneClass.Piccolo);
        var returning = new FlightLeg(spec, Customer, Store, 20, 32);
        Assert.Equal(32, returning.At(TimeSpan.Zero).AltitudeMetres);
        Assert.Equal(20, returning.At(TimeSpan.Zero).Heading);
        var descent = new FlightLeg(spec, Customer, Customer, 123, 32, LandingOnly: true);
        Assert.Equal(TimeSpan.FromSeconds(8), descent.Duration);
        Assert.Equal(Customer, descent.At(descent.Duration / 2).Position);
        Assert.Equal(16, descent.At(descent.Duration / 2).AltitudeMetres);
        Assert.Equal(123, descent.At(descent.Duration).Heading);
        Assert.Equal(0, descent.At(descent.Duration).AltitudeMetres);
        Assert.True(ServiceArea.Contains(ServiceArea.Waste.Location));
    }

    [Fact]
    public void Interrupted_order_fails_but_queued_work_is_reassigned_without_old_milestones_applying()
    {
        var dispatcher = new Dispatcher();
        dispatcher.Observe(Reading());
        foreach (var id in new[] { "active", "queued" })
            dispatcher.Accept(new(id, "c", "Test", Customer, 1, [], Now, "test"));
        var missions = dispatcher.PlanPending(Now);
        var active = missions[0]; var queued = missions[1];
        var command = new DroneCommandRequested("command", "PIC-01", DroneCommand.EmergencyLanding);
        Assert.True(dispatcher.TryBeginCommand(command, Now, out _));
        dispatcher.Observe(new MissionProgress(active.MissionId, active.OrderId, active.DroneId, MissionMilestone.Interrupted, Now, Store, "Emergency landing"), Now);
        dispatcher.Observe(new MissionProgress(queued.MissionId, queued.OrderId, queued.DroneId, MissionMilestone.Rejected, Now, Store), Now);
        Assert.Equal(OrderStatus.Failed, dispatcher.Order("active")!.Status);
        Assert.False(dispatcher.CanSkip("active", DemoStage.ReadyForPickup, Now.AddMinutes(2)));
        Assert.Equal(OrderStatus.AwaitingFleet, dispatcher.Order("queued")!.Status);
        Assert.Empty(dispatcher.PlanPending(Now));

        dispatcher.Observe(Reading("PIC-02"));
        var reassigned = Assert.Single(dispatcher.PlanPending(Now));
        Assert.Equal("queued", reassigned.OrderId);
        Assert.Equal("PIC-02", reassigned.DroneId);
        Assert.NotEqual(queued.MissionId, reassigned.MissionId);
        dispatcher.Observe(new MissionProgress(queued.MissionId, queued.OrderId, queued.DroneId, MissionMilestone.Delivered, Now, Customer), Now);
        Assert.Equal(OrderStatus.Scheduled, dispatcher.Order("queued")!.Status);
    }

    [Fact]
    public void Command_availability_is_enforced_and_grounded_drone_rejoins_only_after_recovery()
    {
        var dispatcher = new Dispatcher();
        var reading = Reading();
        dispatcher.Observe(reading);
        DroneCommandRequested Request(DroneCommand command) => new(command.ToString(), reading.DroneId, command);
        Assert.False(dispatcher.TryBeginCommand(Request(DroneCommand.DiscardPackage), Now, out _));
        Assert.False(dispatcher.TryBeginCommand(Request(DroneCommand.Reactivate), Now, out _));
        Assert.False(dispatcher.TryBeginCommand(Request(DroneCommand.ReturnToBase), Now.AddMinutes(1), out _));
        Assert.True(dispatcher.TryBeginCommand(Request(DroneCommand.EmergencyLanding), Now, out _));
        Assert.False(dispatcher.TryBeginCommand(Request(DroneCommand.ReturnToBase), Now, out _));
        dispatcher.Observe(reading with { Sequence = 2, State = DroneState.Grounded,
            Control = new("EmergencyLanding", DroneCommand.EmergencyLanding, CommandStatus.Completed, "Grounded") });
        Assert.True(dispatcher.TryBeginCommand(Request(DroneCommand.Reactivate), Now, out _));
        dispatcher.Accept(new("waiting", "c", "Test", Customer, 1, [], Now, "test"));
        Assert.Empty(dispatcher.PlanPending(Now));
        dispatcher.Observe(reading with { Sequence = 3, State = DroneState.Parked,
            Control = new("Reactivate", DroneCommand.Reactivate, CommandStatus.Completed, "Available") });
        Assert.Single(dispatcher.PlanPending(Now));
    }

    [Fact]
    public void Customer_camera_neighbors_omit_order_details_and_reserved_drone_does_not_expose_them()
    {
        var dispatcher = new Dispatcher();
        dispatcher.Observe(Reading());
        dispatcher.Observe(Reading("PIC-02"));
        dispatcher.Accept(new("order", "c", "Test", Customer, 1, [], Now, "test"));
        dispatcher.PlanPending(Now);
        Assert.Empty(dispatcher.Order("order")!.NearbyDrones!);
        dispatcher.Observe(Reading() with { Sequence = 2, OrderId = "order", State = DroneState.FlyingToPickup });
        var neighbor = Assert.Single(dispatcher.Order("order")!.NearbyDrones!);
        Assert.Equal("PIC-02", neighbor.DroneId);
        Assert.DoesNotContain("orderId", System.Text.Json.JsonSerializer.Serialize(neighbor, EventSerializer.Options));
    }
}
