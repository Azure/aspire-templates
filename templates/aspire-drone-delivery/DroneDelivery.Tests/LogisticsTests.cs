using DroneDelivery.Domain;

namespace DroneDelivery.Tests;

public class LogisticsTests
{
    static readonly DateTimeOffset Now = new(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
    static readonly GeoPoint Store = ServiceArea.Stores[0].Location;
    static readonly GeoPoint Customer = new(-37.8420, 144.9740);

    static DroneAvailability Drone(string id, DroneClass droneClass, double charge = 100, GeoPoint? at = null) =>
        new(id, droneClass, at ?? Store, at ?? Store, charge, Now);

    [Fact]
    public void Legs_climb_vertically_and_curve_down_onto_the_pad()
    {
        var leg = DroneSpec.For(DroneClass.Doppio).Leg(Store, Customer);

        var climbing = leg.At(leg.ClimbDuration / 2);
        Assert.Equal((Manoeuvre.VerticalClimb, Store), (climbing.Manoeuvre, climbing.Position));
        Assert.Equal((leg.Path.LaunchAltitude + leg.Path.DepartureAltitude) / 2, climbing.AltitudeMetres, 3);

        var cruising = leg.At(leg.ClimbDuration + leg.CruiseDuration / 2);
        Assert.Equal(Manoeuvre.Cruise, cruising.Manoeuvre);
        Assert.InRange(cruising.AltitudeMetres, BuildingAirspace.MinimumEnRouteAltitudeMetres, leg.Path.PeakAltitude);

        var descending = leg.At(leg.Duration - leg.DescentDuration / 2);
        Assert.Equal(Manoeuvre.VerticalDescent, descending.Manoeuvre);
        Assert.InRange(descending.Position.DistanceTo(Customer), .01, leg.ApproachRadiusMetres);
        Assert.InRange(descending.AltitudeMetres, leg.Path.LandingAltitude, leg.Path.PeakAltitude);
        Assert.Equal(Customer, leg.At(leg.Duration).Position);
        Assert.Equal((Manoeuvre.OnTheGround, leg.Path.LandingAltitude), (leg.At(leg.Duration).Manoeuvre, leg.At(leg.Duration).AltitudeMetres));
    }

    [Fact]
    public void Flight_progress_covers_vertical_phases_even_without_horizontal_travel()
    {
        foreach (var target in new[] { Customer, Store })
        {
            var leg = DroneSpec.For(DroneClass.Doppio).Leg(Store, target);
            var climb = leg.At(leg.ClimbDuration / 2);
            var cruise = leg.At(leg.ClimbDuration + leg.CruiseDuration / 2);
            var descent = leg.At(leg.Duration - leg.DescentDuration / 2);

            Assert.Equal(Manoeuvre.VerticalClimb, climb.Manoeuvre);
            Assert.True(climb.Progress > 0 && climb.Progress < .5);
            Assert.InRange(cruise.Progress, climb.Progress, descent.Progress);
            Assert.Equal(Manoeuvre.VerticalDescent, descent.Manoeuvre);
            Assert.True(descent.Progress > .5 && descent.Progress < 1);
            Assert.Equal(0, leg.At(TimeSpan.FromSeconds(-1)).Progress);
            Assert.Equal(1, leg.At(leg.Duration + TimeSpan.FromSeconds(1)).Progress);
        }
    }

    [Fact]
    public void Picks_the_smallest_capable_drone_and_never_an_undersized_one()
    {
        var fleet = new[] { Drone("ABB-01", DroneClass.Abbondante), Drone("DOP-01", DroneClass.Doppio), Drone("PIC-01", DroneClass.Piccolo) };

        Assert.Equal("PIC-01", LogisticsPlanner.Plan(new("single", 1, Store, Customer, Now), fleet, Now)!.DroneId);
        Assert.Equal("ABB-01", LogisticsPlanner.Plan(new("quad", 4, Store, Customer, Now), fleet, Now)!.DroneId);
    }

    [Fact]
    public void Waits_on_the_pad_until_it_can_arrive_as_the_order_is_ready()
    {
        var readyAt = Now.AddMinutes(10);
        var drone = Drone("PIC-01", DroneClass.Piccolo, at: Customer);

        var plan = LogisticsPlanner.Plan(new("later", 1, Store, Customer, readyAt), [drone], Now)!;

        Assert.Equal(readyAt - DroneSpec.For(DroneClass.Piccolo).Leg(Customer, Store).Duration, plan.DepartAt);
        Assert.Equal(readyAt + LogisticsPlanner.LoadingTime, plan.PickupAt);
    }

    [Fact]
    public void Low_battery_drones_charge_before_departing()
    {
        var plan = LogisticsPlanner.Plan(new("order", 1, Store, Customer, Now), [Drone("PIC-01", DroneClass.Piccolo, charge: 5)], Now)!;

        Assert.True(plan.ChargeBeforeDeparture > TimeSpan.Zero);
        Assert.Equal(Now + plan.ChargeBeforeDeparture, plan.DepartAt);
    }

    [Fact]
    public void Quad_orders_queue_behind_the_only_two_capable_drones()
    {
        var dispatcher = new Dispatcher();
        foreach (var (id, droneClass) in new[] { ("ABB-01", DroneClass.Abbondante), ("ABB-02", DroneClass.Abbondante), ("PIC-01", DroneClass.Piccolo), ("PIC-02", DroneClass.Piccolo) })
            dispatcher.Observe(new DroneTelemetry(id, droneClass, 1, Now, Store, Store, 0, 0, 100, DroneState.Parked, Manoeuvre.OnTheGround, null, null, 0));

        var placed = Enumerable.Range(1, 3)
            .Select(i => new OrderPlaced($"QUAD-{i}", $"customer-{i}", "Test", Customer, 4, [], Now.AddSeconds(i), "test"))
            .ToList();
        placed.ForEach(order => dispatcher.Accept(order));
        var missions = dispatcher.PlanPending(Now);

        Assert.Equal(3, missions.Count);
        Assert.All(missions, mission => Assert.StartsWith("ABB-", mission.DroneId));
        Assert.Equal(2, missions.Take(2).Select(mission => mission.DroneId).Distinct().Count());

        var first = dispatcher.Order(missions.First(mission => mission.DroneId == missions[2].DroneId).OrderId)!;
        var third = dispatcher.Order("QUAD-3")!;
        Assert.True(third.DepartAt > first.EstimatedDelivery, "the third order waits for a drone to finish its first delivery");
        Assert.True(third.EstimatedDelivery > dispatcher.Order("QUAD-2")!.EstimatedDelivery);
        Assert.StartsWith("Queued for Abbondante", third.Note);
    }

    [Fact]
    public void Orders_no_drone_can_carry_are_unserviceable()
    {
        var dispatcher = new Dispatcher();
        dispatcher.Observe(new DroneTelemetry("PIC-01", DroneClass.Piccolo, 1, Now, Store, Store, 0, 0, 100, DroneState.Parked, Manoeuvre.OnTheGround, null, null, 0));
        dispatcher.Accept(new OrderPlaced("QUAD-1", "c", "Test", Customer, 4, [], Now, "test"));

        Assert.Empty(dispatcher.PlanPending(Now));
        Assert.Equal(OrderStatus.Unserviceable, dispatcher.Order("QUAD-1")!.Status);
    }

    [Fact]
    public void Order_tracking_does_not_expose_a_reserved_drones_unrelated_mission()
    {
        var dispatcher = new Dispatcher();
        var telemetry = new DroneTelemetry("PIC-01", DroneClass.Piccolo, 1, Now, Store, Store, 0, 0, 100, DroneState.Parked, Manoeuvre.OnTheGround, null, null, 0);
        dispatcher.Observe(telemetry);
        dispatcher.Accept(new OrderPlaced("A", "c", "Test", Customer, 1, [], Now, "test"));
        dispatcher.Accept(new OrderPlaced("B", "c", "Test", Customer, 1, [], Now, "test"));
        dispatcher.PlanPending(Now);
        dispatcher.Observe(telemetry with { Sequence = 2, OrderId = "A", State = DroneState.FlyingToPickup, Manoeuvre = Manoeuvre.Cruise });

        Assert.Equal("A", dispatcher.Order("A")!.Telemetry!.OrderId);
        Assert.Equal("PIC-01", dispatcher.Order("B")!.DroneId);
        Assert.Null(dispatcher.Order("B")!.Telemetry);
    }

    [Fact]
    public void A_returned_drone_is_available_again_from_its_pad()
    {
        var dispatcher = new Dispatcher();
        dispatcher.Observe(new DroneTelemetry("PIC-01", DroneClass.Piccolo, 1, Now, Customer, Store, 0, 0, 100, DroneState.Parked, Manoeuvre.OnTheGround, null, null, 0));
        dispatcher.Accept(new OrderPlaced("A", "c", "Test", Customer, 1, [], Now, "test"));
        var mission = Assert.Single(dispatcher.PlanPending(Now));

        dispatcher.Observe(new MissionProgress(mission.MissionId, "A", "PIC-01", MissionMilestone.Delivered, Now.AddMinutes(5), Customer), Now.AddMinutes(5));
        dispatcher.Observe(new MissionProgress(mission.MissionId, "A", "PIC-01", MissionMilestone.ReturnedToPad, Now.AddMinutes(8), Store), Now.AddMinutes(8));
        dispatcher.Accept(new OrderPlaced("B", "c", "Test", Customer, 1, [], Now.AddMinutes(8), "test"));
        var next = Assert.Single(dispatcher.PlanPending(Now.AddMinutes(8)));

        Assert.Equal(OrderStatus.Delivered, dispatcher.Order("A")!.Status);
        Assert.True(next.DepartAt <= Now.AddMinutes(9), "no longer waiting on the first mission's projected return");
    }

    static (Dispatcher Restored, MissionAssigned Mission) RestartDuringMission(MissionMilestone? reached = null)
    {
        var dispatcher = new Dispatcher();
        dispatcher.Observe(new DroneTelemetry("PIC-01", DroneClass.Piccolo, 1, Now, Store, Store, 0, 0, 100, DroneState.Parked, Manoeuvre.OnTheGround, null, null, 0));
        dispatcher.Accept(new OrderPlaced("A", "c", "Test", Customer, 1, [], Now, "test"));
        var mission = Assert.Single(dispatcher.PlanPending(Now));
        if (reached is { } milestone)
            dispatcher.Observe(new MissionProgress(mission.MissionId, "A", "PIC-01", milestone, Now.AddMinutes(1), Store), Now.AddMinutes(1));

        // Round-trip through the serializer the Cosmos DB client uses.
        var json = System.Text.Json.JsonSerializer.Serialize(dispatcher.TakeChanges().Select(record => new Server.OrderStore.OrderDocument(record.Order.Order.OrderId, record)), EventSerializer.Options);
        Assert.Contains("\"id\":\"A\"", json);
        var restored = new Dispatcher();
        restored.Restore(System.Text.Json.JsonSerializer.Deserialize<List<Server.OrderStore.OrderDocument>>(json, EventSerializer.Options)!.Select(document => document.Record));
        Assert.Empty(dispatcher.TakeChanges());
        return (restored, mission);
    }

    [Fact]
    public void A_restored_mission_keeps_its_drone_and_resumes_tracking()
    {
        var (dispatcher, mission) = RestartDuringMission(MissionMilestone.Accepted);
        dispatcher.Observe(new DroneTelemetry("PIC-01", DroneClass.Piccolo, 9, Now.AddMinutes(2), Store, Store, 40, 0, 90, DroneState.FlyingToPickup, Manoeuvre.Cruise, mission.MissionId, "A", 0));
        dispatcher.Accept(new OrderPlaced("B", "c", "Test", Customer, 1, [], Now.AddMinutes(2), "test"));

        Assert.Empty(dispatcher.PlanPending(Now.AddMinutes(2)));
        Assert.Equal(OrderStatus.DroneEnRoute, dispatcher.Order("A")!.Status);
        Assert.Equal("A", dispatcher.Order("A")!.Telemetry!.OrderId);

        dispatcher.Observe(new MissionProgress(mission.MissionId, "A", "PIC-01", MissionMilestone.Delivered, Now.AddMinutes(5), Customer), Now.AddMinutes(5));
        Assert.Equal(OrderStatus.Delivered, dispatcher.Order("A")!.Status);
    }

    [Fact]
    public void A_restored_mission_the_simulator_forgot_is_redispatched()
    {
        var (dispatcher, mission) = RestartDuringMission();
        var idle = new DroneTelemetry("PIC-01", DroneClass.Piccolo, 1, mission.DepartAt, Store, Store, 0, 0, 100, DroneState.Parked, Manoeuvre.OnTheGround, null, null, 0);
        dispatcher.Observe(idle);
        Assert.Equal(OrderStatus.Scheduled, dispatcher.Order("A")!.Status);

        dispatcher.Observe(idle with { Sequence = 2, Timestamp = mission.DepartAt + Dispatcher.RecoveryGrace });
        Assert.Equal(OrderStatus.AwaitingFleet, dispatcher.Order("A")!.Status);
        var replanned = Assert.Single(dispatcher.PlanPending(mission.DepartAt + Dispatcher.RecoveryGrace));
        Assert.NotEqual(mission.MissionId, replanned.MissionId);
    }

    [Fact]
    public void A_restored_delivery_lost_with_the_package_aboard_fails()
    {
        var (dispatcher, mission) = RestartDuringMission(MissionMilestone.PickedUp);
        dispatcher.Observe(new DroneTelemetry("PIC-01", DroneClass.Piccolo, 1, mission.DepartAt + Dispatcher.RecoveryGrace, Store, Store, 0, 0, 100, DroneState.Charging, Manoeuvre.OnTheGround, null, null, 0));

        Assert.Equal(OrderStatus.Failed, dispatcher.Order("A")!.Status);
        Assert.Empty(dispatcher.PlanPending(mission.DepartAt + Dispatcher.RecoveryGrace));
    }

    static (Dispatcher Dispatcher, MissionAssigned Mission) Dispatched()
    {
        var dispatcher = new Dispatcher();
        dispatcher.Observe(new DroneTelemetry("PIC-01", DroneClass.Piccolo, 1, Now, Store, Store, 0, 0, 100, DroneState.Parked, Manoeuvre.OnTheGround, null, null, 0));
        dispatcher.Accept(new OrderPlaced("A", "c", "Test", Customer, 1, [], Now, "test"));
        return (dispatcher, Assert.Single(dispatcher.PlanPending(Now)));
    }

    static DroneTelemetry Flying(MissionAssigned mission, long sequence, DateTimeOffset at, DroneState state, DateTimeOffset? stageEndsAt,
        ManualControlState? manual = null) =>
        new("PIC-01", DroneClass.Piccolo, sequence, at, Store, Store, 40, 0, 80, state, Manoeuvre.Cruise, mission.MissionId, "A", 0,
            Manual: manual, StageEndsAt: stageEndsAt);

    [Fact]
    public void Takeover_makes_arrival_indeterminate_and_resume_re_estimates_from_the_replanned_leg()
    {
        var (dispatcher, mission) = Dispatched();
        dispatcher.Observe(new MissionProgress(mission.MissionId, "A", "PIC-01", MissionMilestone.PickedUp, Now.AddMinutes(3), Store), Now.AddMinutes(3));
        dispatcher.Observe(Flying(mission, 2, Now.AddMinutes(3), DroneState.FlyingToCustomer, Now.AddMinutes(5)));
        Assert.Equal(Now.AddMinutes(5), dispatcher.Order("A")!.EstimatedDelivery);
        dispatcher.TakeChanges();

        var active = new ManualControlState("s1", ManualStatus.Active, 1, 1, 0, "Operator in control");
        dispatcher.Observe(Flying(mission, 3, Now.AddMinutes(4), DroneState.FlyingToCustomer, null, active));
        var held = dispatcher.Order("A")!;
        Assert.True(held.ArrivalIndeterminate);
        Assert.Null(held.EstimatedDelivery);
        Assert.True(Assert.Single(dispatcher.TakeChanges()).Order.ArrivalIndeterminate, "persisted so a restart doesn't revive the stale estimate");

        // Still indeterminate while hovering on a lost link (or while the operator decides how to hand back).
        dispatcher.Observe(Flying(mission, 4, Now.AddMinutes(9), DroneState.FlyingToCustomer, null, active with { Status = ManualStatus.LinkLost }));
        Assert.True(dispatcher.Order("A")!.ArrivalIndeterminate);
        Assert.Empty(dispatcher.TakeChanges());

        // Resumed far from the original route: the new leg ends later than the stale countdown ever said.
        dispatcher.Observe(Flying(mission, 5, Now.AddMinutes(10), DroneState.FlyingToCustomer, Now.AddMinutes(13), active with { Status = ManualStatus.Released }));
        var resumed = dispatcher.Order("A")!;
        Assert.False(resumed.ArrivalIndeterminate);
        Assert.Equal(Now.AddMinutes(13), resumed.EstimatedDelivery);
        Assert.Single(dispatcher.TakeChanges());

        // Normal drift along the leg updates the live estimate without rewriting the order every tick.
        dispatcher.Observe(Flying(mission, 6, Now.AddMinutes(11), DroneState.FlyingToCustomer, Now.AddMinutes(13).AddSeconds(1), active with { Status = ManualStatus.Released }));
        Assert.Equal(Now.AddMinutes(13), dispatcher.Order("A")!.EstimatedDelivery);
        Assert.Empty(dispatcher.TakeChanges());
    }

    [Fact]
    public void Before_pickup_the_estimate_adds_any_preparation_wait_loading_and_the_delivery_leg()
    {
        var (dispatcher, mission) = Dispatched();
        var order = dispatcher.Order("A")!;
        var deliveryLeg = DroneSpec.For(DroneClass.Piccolo).Leg(order.Store.Location, Customer).Duration;

        // Arriving before the order is ready: the drone waits for preparation, then loads.
        dispatcher.Observe(Flying(mission, 2, Now.AddSeconds(10), DroneState.FlyingToPickup, order.ReadyAt.AddMinutes(-1)));
        Assert.Equal(order.ReadyAt + LogisticsPlanner.LoadingTime, dispatcher.Order("A")!.EstimatedPickup);
        Assert.Equal(order.ReadyAt + LogisticsPlanner.LoadingTime + deliveryLeg, dispatcher.Order("A")!.EstimatedDelivery);

        var active = new ManualControlState("s1", ManualStatus.Active, 1, 1, 0, "Operator in control");
        dispatcher.Observe(Flying(mission, 3, Now.AddSeconds(20), DroneState.FlyingToPickup, null, active));
        Assert.True(dispatcher.Order("A")!.ArrivalIndeterminate);

        // Resumed after the order became ready: arrival now follows the late leg, not the preparation time.
        var late = order.ReadyAt.AddMinutes(2);
        dispatcher.Observe(Flying(mission, 4, order.ReadyAt, DroneState.FlyingToPickup, late, active with { Status = ManualStatus.Released }));
        var resumed = dispatcher.Order("A")!;
        Assert.False(resumed.ArrivalIndeterminate);
        Assert.Equal(late + LogisticsPlanner.LoadingTime + deliveryLeg, resumed.EstimatedDelivery);

        dispatcher.Observe(Flying(mission, 5, late, DroneState.Loading, late + LogisticsPlanner.LoadingTime) with { Manoeuvre = Manoeuvre.OnTheGround });
        Assert.Equal(late + LogisticsPlanner.LoadingTime + deliveryLeg, dispatcher.Order("A")!.EstimatedDelivery);
    }
}
