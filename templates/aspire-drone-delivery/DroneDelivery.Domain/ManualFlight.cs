namespace DroneDelivery.Domain;

public enum ManualAction { Take, Resume, ReturnToBase }

/// <summary>Published to <see cref="Hubs.DroneMissions"/>: an operator takes or releases manual control.</summary>
public sealed record ManualControlRequested(string RequestId, string DroneId, string SessionId, ManualAction Action);

/// <summary>
/// Stick positions in [-1, 1] (forward, right, up, clockwise yaw), the requested camera gimbal angles, optical zoom and
/// focus distance (0 = autofocus). The gimbal and zoom slew towards these; focus is applied directly.
/// </summary>
public sealed record ManualInput(double Forward, double Strafe, double Vertical, double Yaw,
    double CameraPitchDegrees = -30, double CameraYawDegrees = 0, double CameraZoom = 1, double CameraFocusMetres = 0)
{
    public static readonly ManualInput Hover = new(0, 0, 0, 0);

    public ManualInput Clamped() => new(Math.Clamp(Finite(Forward), -1, 1), Math.Clamp(Finite(Strafe), -1, 1),
        Math.Clamp(Finite(Vertical), -1, 1), Math.Clamp(Finite(Yaw), -1, 1),
        Math.Clamp(Finite(CameraPitchDegrees, -30), ManualFlight.CameraPitchMin, ManualFlight.CameraPitchMax),
        Math.Clamp(Finite(CameraYawDegrees), -ManualFlight.CameraYawLimit, ManualFlight.CameraYawLimit),
        Math.Clamp(Finite(CameraZoom, 1), 1, ManualFlight.MaxZoom),
        Finite(CameraFocusMetres) <= 0 ? 0 : Math.Clamp(CameraFocusMetres, ManualFlight.MinFocusMetres, ManualFlight.MaxFocusMetres));

    /// <summary>Centred sticks that hold this input's camera settings.</summary>
    public ManualInput Holding() => Hover with
        { CameraPitchDegrees = CameraPitchDegrees, CameraYawDegrees = CameraYawDegrees, CameraZoom = CameraZoom, CameraFocusMetres = CameraFocusMetres };

    static double Finite(double value, double fallback = 0) => double.IsFinite(value) ? value : fallback;
}

/// <summary>Published to <see cref="Hubs.DroneMissions"/> several times a second while an operator flies a drone.</summary>
public sealed record ManualControlInput(string DroneId, string SessionId, long Sequence, ManualInput Input);

/// <summary>Active and LinkLost hold control; Released and Rejected are final outcomes kept for the operator to read.</summary>
public enum ManualStatus { Active, LinkLost, Released, Rejected }

/// <summary>
/// Manual-control telemetry. <paramref name="Acknowledged"/> is the latest input sequence applied and
/// <paramref name="AppliedSeconds"/> how long it has been applied, so the controlling browser can reconcile its prediction.
/// </summary>
public sealed record ManualControlState(string SessionId, ManualStatus Status, long Acknowledged, double AppliedSeconds,
    double LinkLostSeconds, string Message);

/// <summary>
/// Deterministic manual flight model shared by the simulator (authoritative) and mirrored by the operator site (prediction).
/// Sticks command body-frame velocities; the airframe accelerates towards them, so yawing while moving leaves momentum that
/// the drone arrests by banking. Building clearance, the en-route floor, the ceiling and the service area are hard limits.
/// </summary>
public sealed class ManualFlight(DroneSpec spec, GeoPoint position, double altitude, double heading,
    double cameraPitch = -30, double cameraYaw = 0, double cameraZoom = 1, double cameraFocus = 0)
{
    public const double StepSeconds = .1;
    public const double HorizontalAcceleration = 3;
    public const double VerticalAcceleration = 2;
    public const double MaxYawRate = 60;
    public const double YawAcceleration = 180;
    public const double StrafeFraction = .6;
    public const double MaxTiltDegrees = 14;
    public const double CameraPitchMin = -90, CameraPitchMax = 10, CameraYawLimit = 90;
    /// <summary>The gimbal turns no faster than this, so the operator's aim moves smoothly rather than snapping.</summary>
    public const double CameraSlewDegreesPerSecond = 45;
    public const double MaxZoom = 8, ZoomPerSecond = 2, MinFocusMetres = 5, MaxFocusMetres = 400;
    /// <summary>Without a fresh input for this long the sticks are treated as centred and the drone brakes to a hover.</summary>
    public static readonly TimeSpan InputTimeout = TimeSpan.FromSeconds(1);
    /// <summary>After this long without the operator's link the drone resumes its previous programming.</summary>
    public static readonly TimeSpan LinkLossResume = TimeSpan.FromSeconds(30);
    const double MetresPerDegree = 6_371_000 * Math.PI / 180;

    public GeoPoint Position { get; private set; } = position;
    public double Altitude { get; private set; } = altitude;
    public double Heading { get; private set; } = (heading % 360 + 360) % 360;
    public double VelocityEast { get; private set; }
    public double VelocityNorth { get; private set; }
    public double VerticalSpeed { get; private set; }
    public double YawRate { get; private set; }
    public double Pitch { get; private set; }
    public double Roll { get; private set; }
    public double CameraPitch { get; private set; } = Math.Clamp(cameraPitch, CameraPitchMin, CameraPitchMax);
    public double CameraYaw { get; private set; } = Math.Clamp(cameraYaw, -CameraYawLimit, CameraYawLimit);
    public double CameraZoom { get; private set; } = Math.Clamp(cameraZoom, 1, MaxZoom);
    /// <summary>Manual focus distance in metres; 0 is autofocus.</summary>
    public double CameraFocus { get; private set; } = cameraFocus;
    public double Speed => Math.Sqrt(VelocityEast * VelocityEast + VelocityNorth * VelocityNorth);
    /// <summary>Distance travelled, for battery accounting.</summary>
    public double HorizontalMetres { get; private set; }
    public double VerticalMetres { get; private set; }

    public void ResetDistance() => HorizontalMetres = VerticalMetres = 0;

    /// <summary>Lowest altitude the operator may descend to here: the en-route floor or building clearance.</summary>
    public static double Floor(BuildingAirspace airspace, GeoPoint point) =>
        Math.Max(BuildingAirspace.MinimumEnRouteAltitudeMetres, airspace.ClearanceAltitude(point));

    public void Step(ManualInput input, double seconds, BuildingAirspace airspace)
    {
        input = input.Clamped();
        CameraPitch = Approach(CameraPitch, input.CameraPitchDegrees, CameraSlewDegreesPerSecond * seconds);
        CameraYaw = Approach(CameraYaw, input.CameraYawDegrees, CameraSlewDegreesPerSecond * seconds);
        CameraZoom = Approach(CameraZoom, input.CameraZoom, ZoomPerSecond * seconds);
        CameraFocus = input.CameraFocusMetres;

        YawRate = Approach(YawRate, input.Yaw * MaxYawRate, YawAcceleration * seconds);
        Heading = ((Heading + YawRate * seconds) % 360 + 360) % 360;

        var h = Heading * Math.PI / 180;
        var (forwardEast, forwardNorth) = (Math.Sin(h), Math.Cos(h));
        var (rightEast, rightNorth) = (Math.Cos(h), -Math.Sin(h));
        var forward = input.Forward * spec.CruiseSpeedMetresPerSecond;
        var strafe = input.Strafe * spec.CruiseSpeedMetresPerSecond * StrafeFraction;
        var targetEast = forward * forwardEast + strafe * rightEast;
        var targetNorth = forward * forwardNorth + strafe * rightNorth;
        var (deltaEast, deltaNorth) = (targetEast - VelocityEast, targetNorth - VelocityNorth);
        var delta = Math.Sqrt(deltaEast * deltaEast + deltaNorth * deltaNorth);
        var limit = HorizontalAcceleration * seconds;
        if (delta > limit) (deltaEast, deltaNorth) = (deltaEast / delta * limit, deltaNorth / delta * limit);
        VelocityEast += deltaEast;
        VelocityNorth += deltaNorth;

        // The airframe tilts into its acceleration: nose down to speed up or arrest backward drift, banking to arrest sideways momentum.
        var accelForward = (deltaEast * forwardEast + deltaNorth * forwardNorth) / seconds;
        var accelRight = (deltaEast * rightEast + deltaNorth * rightNorth) / seconds;
        var smoothing = Math.Clamp(seconds / .35, 0, 1);
        Pitch += (Math.Clamp(-accelForward / HorizontalAcceleration * MaxTiltDegrees, -MaxTiltDegrees, MaxTiltDegrees) - Pitch) * smoothing;
        Roll += (Math.Clamp(accelRight / HorizontalAcceleration * MaxTiltDegrees, -MaxTiltDegrees, MaxTiltDegrees) - Roll) * smoothing;

        var next = Offset(Position, VelocityEast * seconds, VelocityNorth * seconds);
        if (!CanOccupy(airspace, next, Altitude))
        {
            var eastOnly = Offset(Position, VelocityEast * seconds, 0);
            var northOnly = Offset(Position, 0, VelocityNorth * seconds);
            if (CanOccupy(airspace, eastOnly, Altitude)) { next = eastOnly; VelocityNorth = 0; }
            else if (CanOccupy(airspace, northOnly, Altitude)) { next = northOnly; VelocityEast = 0; }
            else { next = Position; VelocityEast = VelocityNorth = 0; }
        }
        HorizontalMetres += Position.DistanceTo(next);
        Position = next;

        VerticalSpeed = Approach(VerticalSpeed, input.Vertical * spec.VerticalSpeedMetresPerSecond, VerticalAcceleration * seconds);
        var altitude = Altitude + VerticalSpeed * seconds;
        // Below the floor (control taken during a low climb) the drone may climb or hold, never descend further.
        var floor = Math.Min(Altitude, Floor(airspace, Position));
        var ceiling = Math.Max(Altitude, BuildingAirspace.MaximumAltitudeMetres);
        if (altitude < floor || altitude > ceiling)
        {
            altitude = Math.Clamp(altitude, floor, ceiling);
            VerticalSpeed = 0;
        }
        VerticalMetres += Math.Abs(altitude - Altitude);
        Altitude = altitude;
    }

    static bool CanOccupy(BuildingAirspace airspace, GeoPoint point, double altitude) =>
        ServiceArea.Contains(point) && airspace.ClearanceAltitude(point) <= altitude + 1e-6;

    static GeoPoint Offset(GeoPoint point, double east, double north) => new(
        point.Latitude + north / MetresPerDegree,
        point.Longitude + east / (MetresPerDegree * Math.Cos(point.Latitude * Math.PI / 180)));

    static double Approach(double value, double target, double step) =>
        value < target ? Math.Min(target, value + step) : Math.Max(target, value - step);
}
