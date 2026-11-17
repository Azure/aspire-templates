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

        using (Step("drone fly to pickup"))
            await FlyAsync(drone, LegFromPose(drone, mission.Pickup), DroneState.FlyingToPickup, proofOfDelivery: false, cancellationToken);
        await MilestoneAsync(drone, mission, trace, MissionMilestone.ArrivedAtPickup, cancellationToken);

        using (Step("drone load order"))
        {
            drone.State = DroneState.Loading;
            await ReportAsync(drone, cancellationToken);
            var loaded = (time.GetUtcNow() > mission.ReadyAt ? time.GetUtcNow() : mission.ReadyAt) + LogisticsPlanner.LoadingTime;
            await WaitUntilAsync(drone, loaded, DemoStage.ReadyForPickup, cancellationToken);
        }
        drone.CarryingPackage = true;
        await MilestoneAsync(drone, mission, trace, MissionMilestone.PickedUp, cancellationToken);

        using (Step("drone fly to customer"))
            await FlyAsync(drone, LegFromPose(drone, mission.DropOff), DroneState.FlyingToCustomer, proofOfDelivery: true, cancellationToken);
        using (Step("drone unload order"))
        {
            drone.State = DroneState.Unloading;
            await ReportAsync(drone, cancellationToken);
            await WaitUntilAsync(drone, time.GetUtcNow() + LogisticsPlanner.UnloadingTime, DemoStage.Delivering, cancellationToken);
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
        drone.PlannedRoute = [
            new(leg.From, leg.Path.LaunchAltitude),
            .. leg.Path.Points,
            new(leg.To, leg.Path.LandingAltitude),
        ];
        var start = time.GetUtcNow();
        var startBattery = drone.BatteryPercent;
        var previous = Manoeuvre.OnTheGround;
        var lastPhoto = start;
        while (true)
        {
            if (drone.Control is not { Status: CommandStatus.Executing })
                InterruptIfRequested(drone);
            var now = time.GetUtcNow();
            var skip = drone.Mission is { } mission && (state switch
            {
                DroneState.FlyingToPickup => skips.Contains(mission.OrderId, DemoStage.ReadyForPickup),
                DroneState.FlyingToCustomer => skips.Contains(mission.OrderId, DemoStage.Delivering),
                _ => false,
            });
            var elapsed = skip ? leg.Duration : now - start;
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
            }
            await Task.Delay(remaining < Tick ? remaining : Tick, time, cancellationToken);
            await ReportAsync(drone, cancellationToken);
        }
    }

    static FlightLeg LegFromPose(SimulatedDrone drone, GeoPoint target) =>
        new(drone.Spec, drone.Position, target, drone.Heading, drone.AltitudeMetres);

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
    Task ReportAsync(SimulatedDrone drone, CancellationToken cancellationToken) =>
        telemetry.SendAsync(drone.Telemetry(time.GetUtcNow()), drone.Id, cancellationToken, traced: false);

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
