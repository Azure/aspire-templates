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

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var fleet = SimulatedDrone.CreateFleet(options).ToDictionary(drone => drone.Id);
        logger.LogInformation("Simulating {Count} drones: {Fleet}", fleet.Count,
            string.Join(", ", options.FleetSize.Select(pair => $"{pair.Value} {pair.Key}")));

        var receiving = missions.ConsumeAsync((data, _) =>
        {
            if (data.TryRead<MissionAssigned>(out var mission))
            {
                if (fleet.TryGetValue(mission.DroneId, out var drone))
                    drone.Queue.Enqueue(mission);
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
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
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
        var toPickup = drone.Spec.Leg(drone.Position, mission.Pickup);
        var toCustomer = drone.Spec.Leg(mission.Pickup, mission.DropOff);
        var toPad = drone.Spec.Leg(mission.DropOff, drone.HomePad);
        var needed = toPickup.BatteryPercent + toCustomer.BatteryPercent + toPad.BatteryPercent + DroneSpec.ReserveBatteryPercent;
        if (!drone.Spec.CanCarry(mission.PayloadBays) || needed > 100)
        {
            await MilestoneAsync(drone, mission, MissionMilestone.Rejected, cancellationToken,
                needed > 100 ? "Round trip exceeds battery range" : $"{drone.Spec.Class} has {drone.Spec.Bays} bays");
            return;
        }

        drone.Mission = mission;
        await MilestoneAsync(drone, mission, MissionMilestone.Accepted, cancellationToken);

        // Stay on the pad, charging, until it is time to leave and there is enough battery for the whole trip.
        var lastReport = time.GetUtcNow();
        while (time.GetUtcNow() < mission.DepartAt || drone.BatteryPercent < needed)
        {
            await Task.Delay(Tick, time, cancellationToken);
            drone.ChargeFor(Tick);
            if (time.GetUtcNow() - lastReport >= options.ParkedTelemetryInterval)
            {
                await ReportAsync(drone, cancellationToken);
                lastReport = time.GetUtcNow();
            }
        }

        await FlyAsync(drone, toPickup, DroneState.FlyingToPickup, proofOfDelivery: false, cancellationToken);
        await MilestoneAsync(drone, mission, MissionMilestone.ArrivedAtPickup, cancellationToken);

        drone.State = DroneState.Loading;
        await ReportAsync(drone, cancellationToken);
        var loaded = (time.GetUtcNow() > mission.ReadyAt ? time.GetUtcNow() : mission.ReadyAt) + LogisticsPlanner.LoadingTime;
        await WaitUntilAsync(drone, loaded, cancellationToken);
        await MilestoneAsync(drone, mission, MissionMilestone.PickedUp, cancellationToken);

        await FlyAsync(drone, toCustomer, DroneState.FlyingToCustomer, proofOfDelivery: true, cancellationToken);
        drone.State = DroneState.Unloading;
        await ReportAsync(drone, cancellationToken);
        await WaitUntilAsync(drone, time.GetUtcNow() + LogisticsPlanner.UnloadingTime, cancellationToken);
        await MilestoneAsync(drone, mission, MissionMilestone.Delivered, cancellationToken);

        await FlyAsync(drone, toPad, DroneState.ReturningToPad, proofOfDelivery: false, cancellationToken);
        await MilestoneAsync(drone, mission, MissionMilestone.ReturnedToPad, cancellationToken);
        drone.Mission = null;
        drone.ChargeFor(TimeSpan.Zero);
        await ReportAsync(drone, cancellationToken);
    }

    async Task FlyAsync(SimulatedDrone drone, FlightLeg leg, DroneState state, bool proofOfDelivery, CancellationToken cancellationToken)
    {
        drone.State = state;
        var start = time.GetUtcNow();
        var startBattery = drone.BatteryPercent;
        var previous = Manoeuvre.OnTheGround;
        var lastPhoto = start;
        while (true)
        {
            var now = time.GetUtcNow();
            var elapsed = now - start;
            var sample = leg.At(elapsed);
            drone.FlightProgress = sample.Progress;
            drone.Position = sample.Position;
            drone.AltitudeMetres = sample.AltitudeMetres;
            drone.Heading = sample.Heading;
            drone.Manoeuvre = sample.Manoeuvre;
            drone.BatteryPercent = startBattery - leg.BatteryPercent * sample.Progress;

            var trigger = (previous, sample.Manoeuvre) switch
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
                await camera.CaptureAsync(drone, photo, proofOfDelivery && photo == PhotoTrigger.LandingEnd, now, cancellationToken);
            }
            previous = sample.Manoeuvre;
            if (elapsed >= leg.Duration)
                return;
            await Task.Delay(Tick, time, cancellationToken);
        }
    }

    async Task WaitUntilAsync(SimulatedDrone drone, DateTimeOffset until, CancellationToken cancellationToken)
    {
        while (until - time.GetUtcNow() is var remaining && remaining > TimeSpan.Zero)
        {
            await Task.Delay(remaining < options.ParkedTelemetryInterval ? remaining : options.ParkedTelemetryInterval, time, cancellationToken);
            await ReportAsync(drone, cancellationToken);
        }
    }

    Task ReportAsync(SimulatedDrone drone, CancellationToken cancellationToken) =>
        telemetry.SendAsync(drone.Telemetry(time.GetUtcNow()), drone.Id, cancellationToken);

    Task MilestoneAsync(SimulatedDrone drone, MissionAssigned mission, MissionMilestone milestone, CancellationToken cancellationToken, string? reason = null)
    {
        logger.LogInformation("{DroneId} {Milestone} for {OrderId}", drone.Id, milestone, mission.OrderId);
        return telemetry.SendAsync(
            new MissionProgress(mission.MissionId, mission.OrderId, drone.Id, milestone, time.GetUtcNow(), drone.Position, reason),
            drone.Id,
            cancellationToken);
    }
}
