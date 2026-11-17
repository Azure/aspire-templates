using System.Collections.Concurrent;
using System.Diagnostics;
using Azure.Messaging.EventHubs.Consumer;
using Azure.Messaging.EventHubs.Producer;
using DroneDelivery.Domain;

namespace DroneDelivery.DroneSimulator;

/// <summary>
/// Simulates the fleet. Drones are created once at start-up at random positions with random charge,
/// then stay parked (charging) until logistics assigns them a mission. This service never chooses which
/// order a drone serves; it only flies the missions it is given and reports what happens.
/// </summary>
public sealed class DroneFleetSimulator(
    FleetOptions options,
    EventHubConsumerClient missions,
    [FromKeyedServices(Hubs.DroneTelemetry)] EventHubProducerClient telemetry,
    DroneCamera camera,
    TimeProvider time,
    ILogger<DroneFleetSimulator> logger) : BackgroundService
{
    static readonly TimeSpan Tick = TimeSpan.FromSeconds(1);
    readonly DemoSkips skips = new();
    readonly PadAllocator pads = new();
    // Each mission's spans join the trace that assigned it.
    readonly ConcurrentDictionary<string, ActivityContext> traces = new();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var fleet = SimulatedDrone.CreateFleet(options).ToDictionary(drone => drone.Id);
        logger.LogInformation("Simulating {Count} drones: {Fleet}", fleet.Count,
            string.Join(", ", options.FleetSize.Select(pair => $"{pair.Value} {pair.Key}")));

        var receiving = missions.ConsumeAsync((data, _) =>
        {
            if (data.TryRead<DemoStageSkipped>(out var skip))
                skips.Request(skip);
            else if (data.TryRead<DroneCommandRequested>(out var command))
            {
                if (fleet.TryGetValue(command.DroneId, out var controlled))
                    controlled.Commands.Enqueue((command, Activity.Current?.Context ?? default));
                else
                    logger.LogWarning("Command {CommandId} is for unknown drone {DroneId}", command.CommandId, command.DroneId);
            }
            else if (data.TryRead<ManualControlInput>(out var input))
            {
                if (fleet.TryGetValue(input.DroneId, out var flown))
                    flown.Receive(input, time.GetUtcNow());
            }
            else if (data.TryRead<ManualControlRequested>(out var manual))
            {
                if (fleet.TryGetValue(manual.DroneId, out var piloted))
                    piloted.ManualRequests.Enqueue((manual, Activity.Current?.Context ?? default));
            }
            else if (data.TryRead<MissionAssigned>(out var mission))
            {
                if (fleet.TryGetValue(mission.DroneId, out var drone))
                {
                    traces[mission.MissionId] = Activity.Current?.Context ?? default;
                    drone.Queue.Enqueue(mission);
                }
                else
                    logger.LogWarning("Mission {MissionId} is for unknown drone {DroneId}", mission.MissionId, mission.DroneId);
            }
            return Task.CompletedTask;
        }, logger, stoppingToken);

        await Task.WhenAll(fleet.Values.Select(drone => RunAsync(drone, stoppingToken)).Append(receiving));
    }

    async Task RunAsync(SimulatedDrone drone, CancellationToken cancellationToken)
    {
        var lastReport = DateTimeOffset.MinValue;
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                if (drone.Commands.TryDequeue(out var command))
                {
                    try { await ControlAsync(drone, command.Request, command.Trace, cancellationToken); }
                    catch (Exception exception) when (exception is not OperationCanceledException)
                    {
                        drone.ProcessedCommands.Remove(command.Request.CommandId);
                        drone.Commands.Enqueue(command);
                        if (drone.Control is { } control)
                            drone.Control = control with { Message = "Command interrupted by an infrastructure failure; retrying from the current pose." };
                        throw;
                    }
                    continue;
                }
                if (drone.State == DroneState.Grounded)
                {
                    await RejectQueuedAsync(drone, cancellationToken);
                    await ReportAsync(drone, cancellationToken);
                    await Task.Delay(Tick, time, cancellationToken);
                    continue;
                }
                if (drone.Queue.TryDequeue(out var mission))
                {
                    await FlyMissionAsync(drone, mission, cancellationToken);
                    lastReport = DateTimeOffset.MinValue;
                    continue;
                }
                drone.ChargeFor(Tick);
                var now = time.GetUtcNow();
                if (now - lastReport >= options.ParkedTelemetryInterval)
                {
                    await ReportAsync(drone, cancellationToken);
                    lastReport = now;
                }
                await Task.Delay(Tick, time, cancellationToken);
            }
            catch (CommandPendingException)
            {
                // Unwind the mission, preserving its actual pose and payload for ControlAsync.
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (FlightRoutingException exception)
            {
                logger.LogError(exception, "Drone {DroneId} cannot fly a safe route", drone.Id);
                drone.RoutingError = exception.Message;
                drone.PlannedRoute = null;
                drone.State = DroneState.Grounded;
                drone.SpeedMetresPerSecond = 0;
                drone.PitchDegrees = drone.RollDegrees = 0;
                if (drone.Control is { Status: CommandStatus.Executing } control)
                    drone.Control = control with { Status = CommandStatus.Rejected, Message = exception.Message };
                if (drone.Mission is { } failed)
                    await MilestoneAsync(drone, failed, drone.MissionTrace, MissionMilestone.Interrupted, cancellationToken, exception.Message);
                drone.Mission = null;
                await ReportAsync(drone, cancellationToken);
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Drone {DroneId} simulation step failed", drone.Id);
                await Task.Delay(Tick, time, cancellationToken);
            }
        }
    }

    async Task FlyMissionAsync(SimulatedDrone drone, MissionAssigned mission, CancellationToken cancellationToken)
    {
        var trace = traces.TryRemove(mission.MissionId, out var context) ? context : default;
        Activity? Step(string name) => Tracing.Start(name, trace).Describe(mission);
        drone.Mission = mission;
        drone.MissionTrace = trace;
        var toPickup = drone.Spec.Leg(drone.Position, mission.Pickup);
        var toCustomer = drone.Spec.Leg(mission.Pickup, mission.DropOff);
        var toPad = drone.Spec.Leg(mission.DropOff, drone.HomePad);
        var needed = toPickup.BatteryPercent + toCustomer.BatteryPercent + toPad.BatteryPercent + DroneSpec.ReserveBatteryPercent;
        if (!drone.Spec.CanCarry(mission.PayloadBays) || needed > 100)
        {
            await MilestoneAsync(drone, mission, trace, MissionMilestone.Rejected, cancellationToken,
                needed > 100 ? "Round trip exceeds battery range" : $"{drone.Spec.Class} has {drone.Spec.Bays} bays");
            drone.Mission = null;
            return;
        }

        drone.Mission = mission;
        drone.MissionTrace = trace;
        await MilestoneAsync(drone, mission, trace, MissionMilestone.Accepted, cancellationToken);

        // Stay on the pad, charging, until it is time to leave and there is enough battery for the whole trip.
        var lastReport = time.GetUtcNow();
        using (Step("drone await departure"))
        while (time.GetUtcNow() < mission.DepartAt || drone.BatteryPercent < needed)
        {
            InterruptIfRequested(drone);
            if (skips.Contains(mission.OrderId, DemoStage.ReadyForPickup))
            {
                // Fast-forward this mission's charging wait, not any preceding mission.
                drone.BatteryPercent = Math.Max(drone.BatteryPercent, needed);
                break;
            }
            await Task.Delay(Tick, time, cancellationToken);
            drone.ChargeFor(Tick);
            if (time.GetUtcNow() - lastReport >= options.ParkedTelemetryInterval)
            {
                await ReportAsync(drone, cancellationToken);
                lastReport = time.GetUtcNow();
            }
        }

        var pickup = await ReservePadAsync(drone, mission, cancellationToken);
        using (Step("drone fly to pickup"))
            await FlyAsync(drone, LegFromPose(drone, pickup), DroneState.FlyingToPickup, proofOfDelivery: false, cancellationToken);
        await MilestoneAsync(drone, mission, trace, MissionMilestone.ArrivedAtPickup, cancellationToken);

        using (Step("drone load order"))
        {
            drone.State = DroneState.Loading;
            var loaded = (time.GetUtcNow() > mission.ReadyAt ? time.GetUtcNow() : mission.ReadyAt) + LogisticsPlanner.LoadingTime;
            drone.StageEndsAt = loaded;
            await ReportAsync(drone, cancellationToken);
            await WaitUntilAsync(drone, loaded, DemoStage.ReadyForPickup, cancellationToken);
        }
        drone.CarryingPackage = true;
        await MilestoneAsync(drone, mission, trace, MissionMilestone.PickedUp, cancellationToken);

        using (Step("drone fly to customer"))
            await FlyAsync(drone, LegFromPose(drone, mission.DropOff), DroneState.FlyingToCustomer, proofOfDelivery: true, cancellationToken);
        using (Step("drone unload order"))
        {
            drone.State = DroneState.Unloading;
            drone.StageEndsAt = time.GetUtcNow() + LogisticsPlanner.UnloadingTime;
            await ReportAsync(drone, cancellationToken);
            await WaitUntilAsync(drone, drone.StageEndsAt.Value, DemoStage.Delivering, cancellationToken);
        }
        drone.CarryingPackage = false;
        await MilestoneAsync(drone, mission, trace, MissionMilestone.Delivered, cancellationToken);

        using (Step("drone return to pad"))
            await FlyAsync(drone, LegFromPose(drone, drone.HomePad), DroneState.ReturningToPad, proofOfDelivery: false, cancellationToken);
        await MilestoneAsync(drone, mission, trace, MissionMilestone.ReturnedToPad, cancellationToken);
        drone.Mission = null;
        skips.Complete(mission.OrderId);
        drone.ChargeFor(TimeSpan.Zero);
        await ReportAsync(drone, cancellationToken);
    }

    async Task FlyAsync(SimulatedDrone drone, FlightLeg leg, DroneState state, bool proofOfDelivery, CancellationToken cancellationToken)
    {
        drone.State = state;
        drone.RoutingError = null;
        drone.PlannedRoute = leg.PlannedRoute;
        var start = time.GetUtcNow();
        drone.StageEndsAt = start + leg.Duration;
        var startBattery = drone.BatteryPercent;
        var previous = Manoeuvre.OnTheGround;
        var lastPhoto = start;
        drone.InFlightLeg = true;
        try
        {
        while (true)
        {
            if (drone.Control is not { Status: CommandStatus.Executing })
                InterruptIfRequested(drone);
            if (NextTakeover(drone) is { } takeover)
            {
                await ManualAsync(drone, takeover.Request, takeover.Trace, cancellationToken);
                // Cancel-and-RTB queued a ReturnToBase command; otherwise resume the leg from wherever the operator left the drone.
                InterruptIfRequested(drone);
                leg = LegFromPose(drone, leg.To);
                drone.PlannedRoute = leg.PlannedRoute;
                start = lastPhoto = time.GetUtcNow();
                // Re-estimate from wherever the operator left the drone.
                drone.StageEndsAt = start + leg.Duration;
                startBattery = drone.BatteryPercent;
                previous = Manoeuvre.Cruise;
                continue;
            }
            var now = time.GetUtcNow();
            var skip = drone.Mission is { } mission && (state switch
            {
                DroneState.FlyingToPickup => skips.Contains(mission.OrderId, DemoStage.ReadyForPickup),
                DroneState.FlyingToCustomer => skips.Contains(mission.OrderId, DemoStage.Delivering),
                _ => false,
            });
            var elapsed = skip ? leg.Duration : now - start;
            if (skip)
                drone.StageEndsAt = now;
            var sample = leg.At(elapsed);
            drone.FlightProgress = sample.Progress;
            drone.Position = sample.Position;
            drone.AltitudeMetres = sample.AltitudeMetres;
            drone.Heading = sample.Heading;
            drone.CameraPitchDegrees = sample.CameraPitchDegrees;
            drone.PitchDegrees = sample.PitchDegrees;
            drone.RollDegrees = sample.RollDegrees;
            drone.SpeedMetresPerSecond = sample.SpeedMetresPerSecond;
            drone.Manoeuvre = sample.Manoeuvre;
            drone.BatteryPercent = startBattery - leg.BatteryPercent * sample.Progress;

            var trigger = skip ? PhotoTrigger.LandingEnd : (previous, sample.Manoeuvre) switch
            {
                (Manoeuvre.OnTheGround, _) when elapsed < Tick * 1.5 => PhotoTrigger.TakeoffStart,
                (Manoeuvre.VerticalClimb, Manoeuvre.Cruise) => PhotoTrigger.TakeoffEnd,
                (Manoeuvre.Cruise or Manoeuvre.VerticalClimb, Manoeuvre.VerticalDescent) => PhotoTrigger.LandingStart,
                (Manoeuvre.VerticalDescent or Manoeuvre.Cruise, Manoeuvre.OnTheGround) => PhotoTrigger.LandingEnd,
                (Manoeuvre.Cruise, Manoeuvre.Cruise) when now - lastPhoto >= options.CruisePhotoInterval => PhotoTrigger.Cruise,
                _ => (PhotoTrigger?)null,
            };
            await ReportAsync(drone, cancellationToken);
            if (trigger is { } photo)
            {
                lastPhoto = now;
                camera.CaptureFrame(drone, photo, proofOfDelivery && photo == PhotoTrigger.LandingEnd, now);
            }
            previous = sample.Manoeuvre;
            if (elapsed >= leg.Duration)
                return;
            await Task.Delay(Tick, time, cancellationToken);
        }
        }
        finally { drone.InFlightLeg = false; }
    }

    /// <summary>Returns a takeover the drone can accept now, rejecting any it cannot (on the ground or executing a command).</summary>
    (ManualControlRequested Request, ActivityContext Trace)? NextTakeover(SimulatedDrone drone)
    {
        while (drone.ManualRequests.TryDequeue(out var queued))
        {
            var request = queued.Request;
            // Resume/RTB outside manual control are stale (e.g. a duplicate after the session already ended).
            if (request.Action != ManualAction.Take || !drone.ProcessedCommands.Add(ManualKey(request.RequestId)))
                continue;
            var reason = !drone.InFlightLeg || drone.Manoeuvre == Manoeuvre.OnTheGround ? "Take control is available while the drone is airborne."
                : drone.Control is { Status: CommandStatus.Executing } ? "A command is in progress."
                : null;
            if (reason is null)
                return queued;
            drone.Manual = new(request.SessionId, ManualStatus.Rejected, 0, 0, 0, reason);
            logger.LogWarning("Manual control of {DroneId} rejected: {Reason}", drone.Id, reason);
        }
        return null;
    }

    /// <summary>
    /// Flies the drone from the operator's stick inputs until they resume programming or cancel and return to base.
    /// Missing inputs brake to a hover; after <see cref="ManualFlight.LinkLossResume"/> without the operator's link the
    /// previous programming resumes. Operator commands (e.g. emergency landing) still interrupt manual flight.
    /// </summary>
    async Task ManualAsync(SimulatedDrone drone, ManualControlRequested take, ActivityContext trace, CancellationToken cancellationToken)
    {
        using var activity = Tracing.Start("drone manual control", trace,
            links: drone.Mission is null ? [] : [new ActivityLink(drone.MissionTrace)])
            ?.SetTag("drone_delivery.drone.id", drone.Id).SetTag("drone_delivery.manual.request.id", take.RequestId);
        logger.LogInformation("Operator took manual control of {DroneId}", drone.Id);
        // Start from the camera the operations view already shows, so taking control does not jump the feed.
        var flight = new ManualFlight(drone.Spec, drone.Position, drone.AltitudeMetres, drone.Heading,
            drone.CameraPitchDegrees, drone.CameraYawDegrees, drone.CameraZoom, drone.CameraFocusMetres);
        var now = time.GetUtcNow();
        var (lastStep, lastInput, lastReport, lastPhoto) = (now, now, DateTimeOffset.MinValue, now);
        var sticks = ManualInput.Hover with
            { CameraPitchDegrees = flight.CameraPitch, CameraYawDegrees = flight.CameraYaw, CameraZoom = flight.CameraZoom, CameraFocusMetres = flight.CameraFocus };
        long acknowledged = 0;
        double applied = 0;
        var battery = drone.BatteryPercent;
        var outcome = "Operator released control; resumed previous programming.";
        drone.PlannedRoute = null;
        drone.StageEndsAt = null;
        drone.Manual = new(take.SessionId, ManualStatus.Active, 0, 0, 0, "Operator in control");
        try
        {
            while (true)
            {
                InterruptIfRequested(drone);
                now = time.GetUtcNow();
                ManualAction? ending = null;
                string? endingId = null;
                while (drone.ManualRequests.TryDequeue(out var queued))
                    if (queued.Request.SessionId == take.SessionId && queued.Request.Action != ManualAction.Take &&
                        drone.ProcessedCommands.Add(ManualKey(queued.Request.RequestId)))
                    {
                        (ending, endingId) = (queued.Request.Action, queued.Request.RequestId);
                        if (ending == ManualAction.ReturnToBase)
                            outcome = "Operator cancelled programming; returning to base.";
                    }
                if (drone.LatestInput(take.SessionId) is { } latest && latest.Input.Sequence > acknowledged)
                {
                    (acknowledged, sticks, lastInput, applied) = (latest.Input.Sequence, latest.Input.Input.Clamped(), latest.ReceivedAt, 0);
                }
                var silent = now - lastInput;
                if (ending is null && silent >= ManualFlight.LinkLossResume)
                {
                    ending = ManualAction.Resume;
                    outcome = $"Operator link lost for {ManualFlight.LinkLossResume.TotalSeconds:0} s; resumed previous programming.";
                }
                if (ending is null && now - lastReport >= Tick && battery - drone.Spec.Leg(drone.Position, drone.HomePad).BatteryPercent <= DroneSpec.ReserveBatteryPercent)
                {
                    (ending, endingId) = (ManualAction.ReturnToBase, Guid.NewGuid().ToString("N"));
                    outcome = "Battery reserve reached; returning to base.";
                }
                if (ending == ManualAction.ReturnToBase)
                    drone.Commands.Enqueue((new DroneCommandRequested(endingId!, drone.Id, DroneCommand.ReturnToBase), trace));
                if (ending is not null)
                    return;

                var lost = silent > ManualFlight.InputTimeout;
                var input = lost ? sticks.Holding() : sticks;
                var dt = Math.Clamp((now - lastStep).TotalSeconds, 0, .25);
                lastStep = now;
                flight.Step(input, dt, BuildingAirspace.Shared);
                applied += dt;
                battery = Math.Max(0, battery - flight.HorizontalMetres / 1000 * drone.Spec.BatteryPerKm
                    - flight.VerticalMetres / DroneSpec.ReferenceManoeuvreMetres * drone.Spec.BatteryPerVerticalManoeuvre);
                flight.ResetDistance();
                drone.Position = flight.Position;
                drone.AltitudeMetres = flight.Altitude;
                drone.Heading = flight.Heading;
                drone.PitchDegrees = flight.Pitch;
                drone.RollDegrees = flight.Roll;
                drone.SpeedMetresPerSecond = flight.Speed;
                drone.CameraPitchDegrees = flight.CameraPitch;
                drone.CameraYawDegrees = flight.CameraYaw;
                drone.CameraZoom = flight.CameraZoom;
                drone.CameraFocusMetres = flight.CameraFocus;
                drone.Manoeuvre = Manoeuvre.Cruise;
                drone.BatteryPercent = battery;
                if (now - lastReport >= Tick)
                {
                    drone.Manual = new(take.SessionId, lost ? ManualStatus.LinkLost : ManualStatus.Active, acknowledged, Math.Round(applied, 3),
                        lost ? Math.Round(silent.TotalSeconds, 1) : 0,
                        lost ? $"Operator link lost; hovering. Resuming previous programming in {Math.Max(0, ManualFlight.LinkLossResume.TotalSeconds - silent.TotalSeconds):0} s."
                            : "Operator in control");
                    await ReportAsync(drone, cancellationToken);
                    lastReport = now;
                }
                if (now - lastPhoto >= options.CruisePhotoInterval)
                {
                    camera.CaptureFrame(drone, PhotoTrigger.Cruise, false, now);
                    lastPhoto = now;
                }
                await Task.Delay(TimeSpan.FromSeconds(ManualFlight.StepSeconds), time, cancellationToken);
            }
        }
        catch (CommandPendingException)
        {
            outcome = "An operator command took over from manual control.";
            throw;
        }
        finally
        {
            // Back to the autonomous camera: forward-facing, wide and autofocus; the resumed leg sets the gimbal pitch.
            (drone.CameraYawDegrees, drone.CameraZoom, drone.CameraFocusMetres) = (0, 1, 0);
            drone.Manual = (drone.Manual ?? new(take.SessionId, ManualStatus.Active, 0, 0, 0, "")) with
                { Status = ManualStatus.Released, Acknowledged = acknowledged, LinkLostSeconds = 0, Message = outcome };
            activity?.SetTag("drone_delivery.manual.outcome", outcome);
            logger.LogInformation("Manual control of {DroneId} ended: {Outcome}", drone.Id, outcome);
        }
    }

    /// <summary>
    /// Reserves one of the store's pads before leaving home. When every pad is reserved the drone waits on its
    /// own pad, charging, rather than approaching an occupied store; the mission resumes as soon as a pad frees.
    /// </summary>
    async Task<GeoPoint> ReservePadAsync(SimulatedDrone drone, MissionAssigned mission, CancellationToken cancellationToken)
    {
        if (ServiceArea.StoreAt(mission.Pickup) is not { } store)
            return mission.Pickup;
        using var waiting = Tracing.Start("drone reserve pad", drone.MissionTrace).Describe(mission);
        var lastReport = time.GetUtcNow();
        var logged = false;
        while (pads.TryReserve(store, drone.Id) is not { } pad)
        {
            if (!logged)
            {
                logger.LogInformation("{DroneId} is holding at home: all {Count} pads at {Store} are reserved", drone.Id, store.Pads.Count, store.Id);
                logged = true;
            }
            InterruptIfRequested(drone);
            await Task.Delay(Tick, time, cancellationToken);
            drone.ChargeFor(Tick);
            if (time.GetUtcNow() - lastReport >= options.ParkedTelemetryInterval)
            {
                await ReportAsync(drone, cancellationToken);
                lastReport = time.GetUtcNow();
            }
        }
        drone.Pad = store.Pads.Single(candidate => pads.HolderOf(candidate.Id) == drone.Id);
        waiting?.SetTag("drone.pad", drone.Pad.Id);
        return drone.Pad.Location;
    }

    async Task WaitUntilAsync(SimulatedDrone drone, DateTimeOffset until, DemoStage stage, CancellationToken cancellationToken)
    {
        while (until - time.GetUtcNow() is var remaining && remaining > TimeSpan.Zero)
        {
            InterruptIfRequested(drone);
            if (drone.Mission is { } mission && (skips.Contains(mission.OrderId, stage) ||
                stage == DemoStage.ReadyForPickup && skips.Contains(mission.OrderId, DemoStage.Preparing)))
            {
                if (stage != DemoStage.ReadyForPickup || skips.Contains(mission.OrderId, stage))
                    break;
                // Preparation was shortened, but loading still takes its normal duration.
                until = until > time.GetUtcNow() + LogisticsPlanner.LoadingTime
                    ? time.GetUtcNow() + LogisticsPlanner.LoadingTime : until;
                drone.StageEndsAt = until;
            }
            await Task.Delay(remaining < Tick ? remaining : Tick, time, cancellationToken);
            await ReportAsync(drone, cancellationToken);
        }
    }

    static FlightLeg LegFromPose(SimulatedDrone drone, GeoPoint target) =>
        new(drone.Spec, drone.Position, target, drone.Heading, drone.AltitudeMetres);

    // Manual requests share the dedupe set with commands; a cancel-and-RTB request's id becomes its ReturnToBase command id.
    static string ManualKey(string requestId) => "manual:" + requestId;

    static void InterruptIfRequested(SimulatedDrone drone)
    {
        while (drone.Commands.TryPeek(out var queued))
        {
            if (drone.ProcessedCommands.Contains(queued.Request.CommandId))
            {
                drone.Commands.TryDequeue(out _);
                continue;
            }
            if (DroneCommands.Error(drone.State, drone.CarryingPackage, queued.Request.Command) is { } error)
            {
                drone.Commands.TryDequeue(out _);
                drone.ProcessedCommands.Add(queued.Request.CommandId);
                drone.Control = new(queued.Request.CommandId, queued.Request.Command, CommandStatus.Rejected, error);
                continue;
            }
            throw new CommandPendingException();
        }
    }

    async Task RejectQueuedAsync(SimulatedDrone drone, CancellationToken cancellationToken)
    {
        while (drone.Queue.TryPeek(out var queued))
        {
            traces.TryGetValue(queued.MissionId, out var trace);
            await MilestoneAsync(drone, queued, trace, MissionMilestone.Rejected, cancellationToken,
                "Queued delivery released after an operator intervention");
            drone.Queue.TryDequeue(out _);
            traces.TryRemove(queued.MissionId, out _);
        }
    }

    async Task ControlAsync(SimulatedDrone drone, DroneCommandRequested request, ActivityContext trace, CancellationToken cancellationToken)
    {
        // Event Hubs can redeliver. Repeating an acknowledged command must not fly the diversion twice.
        if (!drone.ProcessedCommands.Add(request.CommandId))
            return;
        if (drone.ProcessedCommands.Count > 128)
        {
            drone.ProcessedCommands.Clear();
            drone.ProcessedCommands.Add(request.CommandId);
        }
        if (drone.Control is not { Status: CommandStatus.Executing } &&
            DroneCommands.Error(drone.State, drone.CarryingPackage, request.Command) is { } error)
        {
            drone.Control = new(request.CommandId, request.Command, CommandStatus.Rejected, error);
            logger.LogWarning("Drone command {CommandId} rejected: {Reason}", request.CommandId, error);
            await ReportAsync(drone, cancellationToken);
            return;
        }
        using var activity = Tracing.Start("drone execute command", trace,
            links: drone.Mission is null ? [] : [new ActivityLink(drone.MissionTrace)])
            ?.SetTag("drone_delivery.drone.id", drone.Id).SetTag("drone_delivery.command", request.Command.ToString())
            .SetTag("drone_delivery.command.id", request.CommandId);
        drone.Control = new(request.CommandId, request.Command, CommandStatus.Executing, $"{request.Command} in progress");
        await ReportAsync(drone, cancellationToken);
        if (drone.Mission is { } mission)
        {
            await MilestoneAsync(drone, mission, drone.MissionTrace, MissionMilestone.Interrupted, cancellationToken,
                $"Delivery unable to complete: operator requested {request.Command}");
            skips.Complete(mission.OrderId);
        }
        await RejectQueuedAsync(drone, cancellationToken);

        if (request.Command == DroneCommand.EmergencyLanding)
        {
            using (Tracing.Start("drone emergency descent"))
                await FlyAsync(drone, new(drone.Spec, drone.Position, drone.Position, drone.Heading,
                    drone.AltitudeMetres, LandingOnly: true), DroneState.EmergencyLanding, false, cancellationToken);
            drone.State = DroneState.Grounded;
        }
        else
        {
            if (request.Command == DroneCommand.DiscardPackage && drone.CarryingPackage)
            {
                using (Tracing.Start("drone fly to waste"))
                    await FlyAsync(drone, LegFromPose(drone, ServiceArea.Waste.Location), DroneState.FlyingToWaste, false, cancellationToken);
                drone.State = DroneState.DiscardingPackage;
                await ReportAsync(drone, cancellationToken);
                using (Tracing.Start("drone discard package"))
                {
                    await Task.Delay(Tick, time, cancellationToken);
                    drone.CarryingPackage = false;
                    camera.CaptureFrame(drone, PhotoTrigger.LandingEnd, false, time.GetUtcNow());
                    await ReportAsync(drone, cancellationToken);
                }
            }
            using (Tracing.Start("drone commanded return"))
                await FlyAsync(drone, LegFromPose(drone, drone.HomePad), DroneState.ReturningToPad, false, cancellationToken);
            // Return-to-base and reactivation unload any retained package at the base, never at the customer.
            drone.CarryingPackage = false;
            drone.ChargeFor(TimeSpan.Zero);
        }
        drone.Mission = null;
        await RejectQueuedAsync(drone, cancellationToken);
        drone.Control = drone.Control with
        {
            Status = CommandStatus.Completed,
            Message = drone.State == DroneState.Grounded ? "Landed and grounded. Reactivate to return to base and rejoin dispatch."
                : request.Command == DroneCommand.DiscardPackage ? "Package discarded at the waste drop-off. Returned to base."
                : "Returned to base; available for dispatch.",
        };
        await ReportAsync(drone, cancellationToken);
    }

    sealed class CommandPendingException : Exception;

    // Position readings go out every second per drone, so they are not traced; legs and milestones are.
    Task ReportAsync(SimulatedDrone drone, CancellationToken cancellationToken)
    {
        if (!drone.InFlightLeg)
            NextTakeover(drone);
        // A pad is freed only once its drone is physically clear: after departing, or after being diverted elsewhere.
        if (drone.Pad is { } pad && drone.State is not (DroneState.FlyingToPickup or DroneState.Loading) &&
            pads.ReleaseIfClear(drone.Id, pad, drone.Position))
            drone.Pad = null;
        return telemetry.SendAsync(drone.Telemetry(time.GetUtcNow()), drone.Id, cancellationToken, traced: false);
    }

    Task MilestoneAsync(SimulatedDrone drone, MissionAssigned mission, ActivityContext trace, MissionMilestone milestone, CancellationToken cancellationToken, string? reason = null)
    {
        logger.LogInformation("{DroneId} {Milestone} for {OrderId}", drone.Id, milestone, mission.OrderId);
        return telemetry.SendAsync(
            new MissionProgress(mission.MissionId, mission.OrderId, drone.Id, milestone, time.GetUtcNow(), drone.Position, reason),
            drone.Id,
            cancellationToken,
            trace);
    }
}
