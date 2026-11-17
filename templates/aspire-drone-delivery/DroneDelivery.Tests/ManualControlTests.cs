using DroneDelivery.Domain;

namespace DroneDelivery.Tests;

public class ManualControlTests
{
    static readonly DroneSpec Spec = DroneSpec.For(DroneClass.Piccolo);
    static readonly GeoPoint Start = new(-37.835, 144.956);
    static readonly AirPoint Origin = AirPoint.From(Start);
    static readonly DateTimeOffset Now = new(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
    static BuildingVolume Block(double x0, double y0, double x1, double y1, double height) => new(
        [new(Origin.X + x0, Origin.Y + y0), new(Origin.X + x1, Origin.Y + y0),
         new(Origin.X + x1, Origin.Y + y1), new(Origin.X + x0, Origin.Y + y1)], height);

    static ManualFlight Fly(ManualFlight flight, ManualInput input, double seconds, BuildingAirspace? airspace = null)
    {
        for (var t = 0d; t < seconds; t += ManualFlight.StepSeconds)
            flight.Step(input, ManualFlight.StepSeconds, airspace ?? BuildingAirspace.Empty);
        return flight;
    }

    [Fact]
    public void Sticks_accelerate_towards_body_frame_velocities_and_release_brakes_to_a_hover()
    {
        var flight = Fly(new ManualFlight(Spec, Start, 40, 90), new(1, 0, 0, 0), .5);
        Assert.InRange(flight.Speed, 1, 2);
        Assert.True(flight.Pitch < -5, "the nose dips while accelerating forward");
        Fly(flight, new(1, 0, 0, 0), 10);
        Assert.Equal(Spec.CruiseSpeedMetresPerSecond, flight.Speed, 3);
        Assert.InRange(Start.HeadingTo(flight.Position), 89, 91);

        var strafe = Fly(new ManualFlight(Spec, Start, 40, 0), new(0, 1, 0, 0), 10);
        Assert.Equal(Spec.CruiseSpeedMetresPerSecond * ManualFlight.StrafeFraction, strafe.Speed, 3);
        Assert.InRange(Start.HeadingTo(strafe.Position), 89, 91);

        Fly(flight, ManualInput.Hover, 8);
        Assert.Equal(0, flight.Speed, 3);
        Assert.Equal(0, flight.Pitch, 0);
    }

    [Fact]
    public void Yawing_at_speed_banks_to_arrest_the_old_momentum_within_tilt_limits()
    {
        var flight = Fly(new ManualFlight(Spec, Start, 40, 0), new(1, 0, 0, 0), 10);
        var maxRoll = 0d;
        for (var t = 0d; t < 1.5; t += ManualFlight.StepSeconds)
        {
            flight.Step(new(1, 0, 0, 1), ManualFlight.StepSeconds, BuildingAirspace.Empty);
            maxRoll = Math.Max(maxRoll, Math.Abs(flight.Roll));
            Assert.InRange(flight.Roll, -ManualFlight.MaxTiltDegrees, ManualFlight.MaxTiltDegrees);
            Assert.InRange(flight.Pitch, -ManualFlight.MaxTiltDegrees, ManualFlight.MaxTiltDegrees);
        }
        Assert.InRange(flight.Heading, 60, 90);
        Assert.True(maxRoll > 5, $"expected a visible bank, got {maxRoll:0.0}°");
        Fly(flight, new(1, 0, 0, 0), 10);
        Assert.Equal(0, flight.Roll, 0);
        Assert.Equal(Spec.CruiseSpeedMetresPerSecond, flight.Speed, 3);
    }

    [Fact]
    public void Vertical_control_stops_at_building_clearance_the_en_route_floor_and_the_ceiling()
    {
        var airspace = new BuildingAirspace([Block(-20, -20, 20, 20, 30)]);
        var floor = ManualFlight.Floor(airspace, Start);
        Assert.Equal(30 + BuildingAirspace.ClearanceMetres, floor);
        var descending = Fly(new ManualFlight(Spec, Start, 60, 0), new(0, 0, -1, 0), 30, airspace);
        Assert.Equal(floor, descending.Altitude, 6);
        Assert.Equal(0, descending.VerticalSpeed);

        var open = Fly(new ManualFlight(Spec, Start, 30, 0), new(0, 0, -1, 0), 30);
        Assert.Equal(BuildingAirspace.MinimumEnRouteAltitudeMetres, open.Altitude, 6);
        var climbing = Fly(new ManualFlight(Spec, Start, 110, 0), new(0, 0, 1, 0), 30);
        Assert.Equal(BuildingAirspace.MaximumAltitudeMetres, climbing.Altitude, 6);
    }

    [Fact]
    public void Flying_into_a_taller_building_is_blocked_and_slides_along_it()
    {
        // A tall slab to the east; the operator pushes north-east into it at 25 m.
        var airspace = new BuildingAirspace([Block(40, -400, 80, 400, 60)]);
        var flight = Fly(new ManualFlight(Spec, Start, 25, 45), new(1, 0, 0, 0), 40, airspace);
        var reached = AirPoint.From(flight.Position);
        Assert.True(reached.X - Origin.X < 40 - BuildingAirspace.ClearanceMetres + 1, $"entered the envelope at x={reached.X - Origin.X:0.0}");
        Assert.True(Origin.Y - reached.Y > 100, "kept sliding north along the slab");
        Assert.True(airspace.ClearanceAltitude(flight.Position) <= flight.Altitude);

        // Climbing above it lets the drone cross.
        Fly(flight, new(0, 0, 1, 0), 15, airspace);
        Fly(flight, new(0, 1, 0, 0), 20, airspace);
        Assert.True(AirPoint.From(flight.Position).X - Origin.X > 80, "crossed once above the clearance altitude");
    }

    [Fact]
    public void Inputs_are_clamped_and_non_finite_values_centre()
    {
        var input = new ManualInput(5, double.NaN, -3, double.PositiveInfinity, -200, 400).Clamped();
        Assert.Equal(new ManualInput(1, 0, -1, 0, ManualFlight.CameraPitchMin, ManualFlight.CameraYawLimit), input);
    }

    static DroneTelemetry Airborne(DroneState state = DroneState.FlyingToCustomer, ManualControlState? manual = null, long sequence = 1,
        DateTimeOffset? at = null) => new("PIC-01", DroneClass.Piccolo, sequence, at ?? Now, Start, Start, 40, 0, 80, state, Manoeuvre.Cruise,
        "m1", "o1", 0, Manual: manual);

    static ManualControlRequested Request(ManualAction action, string session = "s1") => new(Guid.NewGuid().ToString("N"), "PIC-01", session, action);

    [Fact]
    public void Dispatcher_allows_one_session_to_take_an_airborne_drone_and_only_that_session_to_fly_or_release_it()
    {
        var dispatcher = new Dispatcher();
        dispatcher.Observe(Airborne() with { Manoeuvre = Manoeuvre.OnTheGround, State = DroneState.Loading });
        Assert.False(dispatcher.TryBeginManual(Request(ManualAction.Take), Now, out var error));
        Assert.Contains("airborne", error);

        dispatcher.Observe(Airborne(sequence: 2));
        Assert.True(dispatcher.TryBeginManual(Request(ManualAction.Take), Now, out _));
        Assert.True(dispatcher.IsFlying("PIC-01", "s1", Now));
        Assert.False(dispatcher.TryBeginManual(Request(ManualAction.Take, "s2"), Now, out error));
        Assert.Equal("Another operator is flying this drone.", error);
        Assert.False(dispatcher.IsFlying("PIC-01", "s2", Now));
        Assert.False(dispatcher.TryBeginManual(Request(ManualAction.Resume, "s2"), Now, out _));

        // Confirmed by telemetry, the hold outlives the claim; RTB reserves the command slot so commands can't race it.
        var active = new ManualControlState("s1", ManualStatus.Active, 3, .4, 0, "Operator in control");
        dispatcher.Observe(Airborne(manual: active, sequence: 3, at: Now.AddSeconds(1)));
        Assert.True(dispatcher.IsFlying("PIC-01", "s1", Now.AddMinutes(1)));
        Assert.True(dispatcher.TryBeginManual(Request(ManualAction.ReturnToBase), Now.AddSeconds(2), out _));
        Assert.False(dispatcher.TryBeginCommand(new("c1", "PIC-01", DroneCommand.EmergencyLanding), Now.AddSeconds(2), out _));

        dispatcher.Observe(Airborne(manual: active with { Status = ManualStatus.Released }, sequence: 4, at: Now.AddSeconds(3)));
        Assert.False(dispatcher.IsFlying("PIC-01", "s1", Now.AddSeconds(3)));
        Assert.False(dispatcher.TryBeginManual(Request(ManualAction.Resume), Now.AddSeconds(3), out error));
        Assert.Equal("This session is not flying the drone.", error);
    }

    [Fact]
    public void Dispatcher_refuses_takeover_during_commands_and_expires_unconfirmed_claims()
    {
        var dispatcher = new Dispatcher();
        dispatcher.Observe(Airborne() with { Control = new("c1", DroneCommand.ReturnToBase, CommandStatus.Executing, "") });
        Assert.False(dispatcher.TryBeginManual(Request(ManualAction.Take), Now, out var error));
        Assert.Equal("A command is in progress.", error);

        dispatcher.Observe(Airborne(sequence: 2));
        Assert.True(dispatcher.TryBeginManual(Request(ManualAction.Take), Now, out _));
        // The simulator never confirmed (e.g. the drone landed first); another operator may try after the claim lapses.
        Assert.True(dispatcher.TryBeginManual(Request(ManualAction.Take, "s2"), Now.AddSeconds(11), out _));
    }
}
