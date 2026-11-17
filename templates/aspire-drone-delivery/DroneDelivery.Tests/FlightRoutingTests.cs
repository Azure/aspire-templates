using DroneDelivery.Domain;

namespace DroneDelivery.Tests;

public class FlightRoutingTests
{
    static readonly DroneSpec Spec = DroneSpec.For(DroneClass.Piccolo);
    static readonly AirPoint Origin = AirPoint.From(new(-37.835, 144.956));
    static GeoPoint Point(double x, double y = 0) => new AirPoint(Origin.X + x, Origin.Y + y).Geo;
    static BuildingVolume Block(double x0, double y0, double x1, double y1, double height) => new(
        [new(Origin.X + x0, Origin.Y + y0), new(Origin.X + x1, Origin.Y + y0),
         new(Origin.X + x1, Origin.Y + y1), new(Origin.X + x0, Origin.Y + y1)], height);

    [Theory]
    [InlineData(20)]
    [InlineData(1000)]
    public void Travel_accelerates_and_brakes_without_overshooting_even_on_short_hops(double distance)
    {
        var motion = new TravelMotion(distance, 16);
        Assert.Equal((0d, 0d), motion.At(0));
        Assert.Equal((1d, 0d), motion.At(motion.Duration));
        var first = motion.At(.1);
        var later = motion.At(.2);
        Assert.True(later.Speed > first.Speed);
        Assert.True(motion.At(motion.Duration - .1).Speed < motion.At(motion.Duration - .2).Speed);
        double last = 0;
        for (double t = 0; t <= motion.Duration; t += .05)
        {
            var sample = motion.At(t);
            Assert.InRange(sample.Fraction, last, 1);
            Assert.InRange(sample.Speed, 0, 16);
            last = sample.Fraction;
        }
    }

    [Fact]
    public void Routes_around_a_tall_building_even_when_both_endpoints_are_clear()
    {
        var airspace = new BuildingAirspace([Block(140, -40, 220, 40, 90)]);
        Assert.False(airspace.SegmentClear(Point(0), Point(400), 60));
        var leg = new FlightLeg(Spec, Point(0), Point(400), Airspace: airspace);
        Assert.True(leg.Path.Turns.Count > 2);
        Assert.True(leg.DistanceMetres > Point(0).DistanceTo(Point(400)));
        // Detouring ~14 m is far cheaper than climbing ~76 m and back down, so the drone stays low.
        Assert.True(leg.Path.PeakAltitude < 30);
        foreach (var (a, b) in leg.Path.Points.Zip(leg.Path.Points.Skip(1)))
            Assert.True(airspace.SegmentClear(a.Position, b.Position, Math.Min(a.AltitudeMetres, b.AltitudeMetres)));
        for (double t = 0; t < leg.Duration.TotalSeconds; t += .1)
        {
            var sample = leg.At(TimeSpan.FromSeconds(t));
            var p = AirPoint.From(sample.Position);
            if (sample.AltitudeMetres < 96)
                Assert.False(p.X > Origin.X + 134 && p.X < Origin.X + 226 && p.Y > Origin.Y - 46 && p.Y < Origin.Y + 46);
        }
    }

    [Fact]
    public void Low_roofs_can_be_overflown_but_pads_land_above_the_roof_and_keep_vtol_vertical()
    {
        var airspace = new BuildingAirspace([Block(140, -40, 220, 40, 20)]);
        var direct = airspace.Plan(Point(0), Point(400));
        Assert.Equal(2, direct.Turns.Count);
        var leg = new FlightLeg(Spec, Point(180), Point(400), Airspace: airspace);
        Assert.Equal(26, leg.At(TimeSpan.Zero).AltitudeMetres);
        Assert.Equal(Point(180), leg.At(leg.ClimbDuration / 2).Position);
        var landing = new FlightLeg(Spec, Point(400), Point(180), Airspace: airspace);
        Assert.Equal(26, landing.At(landing.Duration).AltitudeMetres);
        Assert.Equal(Point(180), landing.At(landing.Duration).Position);
        Assert.True(landing.At(landing.Duration - TimeSpan.FromSeconds(.5)).Position.DistanceTo(Point(180)) < .5);
        var emergency = new FlightLeg(Spec, Point(180), Point(180), 123, 50, LandingOnly: true, Airspace: airspace);
        Assert.Equal(26, emergency.At(emergency.Duration).AltitudeMetres);
        Assert.Equal(123, emergency.At(emergency.Duration).Heading);
        Assert.Throws<FlightRoutingException>(() => airspace.Plan(Point(180), Point(400), initialAltitude: 10));
    }

    [Fact]
    public void Unsafe_or_unsurveyed_paths_are_explicit_failures_not_straight_line_fallbacks()
    {
        var wall = new BuildingAirspace([Block(140, -10000, 220, 10000, 200)]);
        Assert.Throws<FlightRoutingException>(() => wall.Plan(Point(0), Point(400)));
        Assert.Throws<FlightRoutingException>(() => BuildingAirspace.Shared.Plan(new(0, 0), Point(0)));
    }

    [Fact]
    public void Turbulence_is_bounded_and_resting_pose_is_still()
    {
        var leg = new FlightLeg(Spec, Point(0), Point(400), Airspace: BuildingAirspace.Empty);
        var rolls = new List<double>();
        for (double t = 0; t < leg.Duration.TotalSeconds; t += .1)
        {
            var sample = leg.At(TimeSpan.FromSeconds(t));
            Assert.InRange(sample.PitchDegrees, -1.6, 1.6);
            Assert.InRange(sample.RollDegrees, -2, 2);
            var bearing = Point(0).HeadingTo(Point(400));
            Assert.InRange((sample.Heading - bearing + 540) % 360 - 180, -1.2, 1.2);
            if (rolls.Count > 0) Assert.True(Math.Abs(sample.RollDegrees - rolls[^1]) < .5);
            rolls.Add(sample.RollDegrees);
        }
        Assert.True(rolls.Max() - rolls.Min() > 3);
        Assert.Equal(0, leg.At(TimeSpan.Zero).RollDegrees);
        Assert.Equal(0, leg.At(leg.Duration).PitchDegrees);
        Assert.Equal(0, leg.At(leg.Duration).RollDegrees);
    }

    [Fact]
    public void Coventry_to_north_service_area_detours_around_the_real_osm_towers()
    {
        var leg = Spec.Leg(ServiceArea.Stores[0].Location, new(-37.8261, 144.9580));
        Assert.True(leg.Path.Turns.Count > 2);
        Assert.All(leg.Path.Points.Zip(leg.Path.Points.Skip(1)), pair => Assert.True(BuildingAirspace.Shared.SegmentClear(
            pair.First.Position, pair.Second.Position, Math.Min(pair.First.AltitudeMetres, pair.Second.AltitudeMetres))));
    }

    [Fact]
    public void Bundled_buildings_are_shared_by_the_planner_and_real_routes_have_full_segment_clearance()
    {
        var airspace = BuildingAirspace.Shared;
        Assert.True(airspace.Buildings.Count > 7000);
        var random = new Random(73);
        for (var i = 0; i < 30; i++)
        {
            var leg = Spec.Leg(ServiceArea.RandomPoint(random), ServiceArea.RandomPoint(random));
            AssertRouteClearance(airspace, leg.Path.Points);
            AssertFlownClearance(airspace, leg);
        }
    }

    [Fact]
    public void Final_approach_curves_from_the_route_onto_the_pad_and_touches_down_vertically()
    {
        var leg = new FlightLeg(Spec, Point(0), Point(400), Airspace: BuildingAirspace.Empty);
        // Low-clearance arrival (20 m floor onto a ground pad) still bends down a ~12 m radius curve.
        Assert.Equal(.6 * (leg.Path.ArrivalAltitude - leg.Path.LandingAltitude), leg.ApproachRadiusMetres, 3);
        var start = leg.Duration - leg.DescentDuration;
        double lastAltitude = leg.Path.PeakAltitude, lastDistance = double.MaxValue;
        for (var t = start; t <= leg.Duration; t += TimeSpan.FromSeconds(.1))
        {
            var sample = leg.At(t);
            var distance = sample.Position.DistanceTo(Point(400));
            Assert.True(sample.AltitudeMetres <= lastAltitude + 1e-6 && distance <= lastDistance + 1e-6);
            Assert.InRange(Math.Abs(sample.Heading - Point(0).HeadingTo(Point(400))), 0, 1.2);
            lastAltitude = sample.AltitudeMetres;
            lastDistance = distance;
        }
        // A third of the way down the drone is still off to the side; the last metres are effectively vertical.
        Assert.True(leg.At(start + leg.DescentDuration / 3).Position.DistanceTo(Point(400)) > 1);
        var flare = leg.At(leg.Duration - TimeSpan.FromSeconds(.5));
        Assert.True(flare.Position.DistanceTo(Point(400)) < .3 && flare.AltitudeMetres > leg.Path.LandingAltitude);
        Assert.Equal(-90, flare.CameraPitchDegrees, 3);
        Assert.Equal((Point(400), 0d), (leg.At(leg.Duration).Position, leg.At(leg.Duration).AltitudeMetres));
    }

    [Fact]
    public void Approach_falls_back_to_vertical_descent_when_a_curve_would_clip_a_building()
    {
        // A mid-rise right beside the pad: worth climbing over rather than detouring, but any sloped approach would clip it.
        var airspace = new BuildingAirspace([Block(388, -20, 392, 20, 25)]);
        var leg = new FlightLeg(Spec, Point(0), Point(400), Airspace: airspace);
        Assert.Equal(0, leg.ApproachRadiusMetres);
        Assert.Equal(Point(400), leg.At(leg.Duration - leg.DescentDuration / 2).Position);
        Assert.Equal([leg.Path.ArrivalAltitude, leg.Path.LandingAltitude], leg.PlannedRoute.Where(waypoint => waypoint.Position == Point(400)).Select(waypoint => waypoint.AltitudeMetres));
    }

    [Fact]
    public void Planned_route_is_the_flown_route_and_ends_on_every_store_pad_clear_of_buildings()
    {
        var airspace = BuildingAirspace.Shared;
        var random = new Random(11);
        foreach (var pad in ServiceArea.Stores.SelectMany(store => store.Pads))
        {
            var leg = Spec.Leg(ServiceArea.RandomPoint(random), pad.Location);
            var route = leg.PlannedRoute;
            Assert.Equal(new FlightWaypoint(pad.Location, leg.Path.LandingAltitude), route[^1]);
            foreach (var (a, b) in route.Zip(route.Skip(1)))
                Assert.True(airspace.SegmentClear(a.Position, b.Position, Math.Min(a.AltitudeMetres, b.AltitudeMetres)));
            for (var t = TimeSpan.Zero; t <= leg.Duration; t += TimeSpan.FromSeconds(.5))
            {
                var sample = leg.At(t);
                Assert.True(DistanceToRoute(route, sample.Position, sample.AltitudeMetres) < 1.5, $"{pad.Id} drifted at {t}");
            }
            Assert.Equal(pad.Location, leg.At(leg.Duration).Position);
        }
    }

    [Fact]
    public void Low_roofs_are_crossed_a_few_metres_above_instead_of_at_a_fixed_cruise_altitude()
    {
        var airspace = new BuildingAirspace([Block(140, -40, 220, 40, 20)]);
        var leg = new FlightLeg(Spec, Point(0), Point(400), Airspace: airspace);
        Assert.Equal(2, leg.Path.Turns.Count);
        Assert.Equal(BuildingAirspace.MinimumEnRouteAltitudeMetres, leg.Path.DepartureAltitude);
        Assert.InRange(leg.Path.PeakAltitude, 26, 28.01);
        Assert.InRange(leg.Path.AltitudeAt(40), 20, 21);
        Assert.InRange(leg.Path.AltitudeAt(180), 26, 28.01);
        AssertFlownClearance(airspace, leg);
    }

    [Fact]
    public void A_long_mid_rise_wall_is_climbed_over_when_the_detour_would_cost_more_energy()
    {
        var airspace = new BuildingAirspace([Block(140, -500, 220, 500, 40)]);
        var leg = new FlightLeg(Spec, Point(0), Point(400), Airspace: airspace);
        Assert.Equal(2, leg.Path.Turns.Count);
        Assert.InRange(leg.Path.PeakAltitude, 46, 48.01);
        Assert.True(leg.Path.AltitudeAt(20) < 30 && leg.Path.AltitudeAt(380) < 46);
        AssertFlownClearance(airspace, leg);
    }

    [Fact]
    public void Clearance_is_continuous_through_take_off_climbs_descents_and_landing()
    {
        // Launch from one low roof, climb over a mid-rise, dip, and land on another roof.
        var airspace = new BuildingAirspace([Block(-10, -10, 10, 10, 15), Block(120, -300, 160, 300, 34), Block(390, -10, 410, 10, 9)]);
        var leg = new FlightLeg(Spec, Point(0), Point(400), Airspace: airspace);
        Assert.True(leg.Path.PeakAltitude >= 40 && leg.Path.VerticalVariationMetres > 30);
        AssertFlownClearance(airspace, leg);
    }

    /// <summary>Sloped segments are checked every half metre against the envelope directly below.</summary>
    static void AssertRouteClearance(BuildingAirspace airspace, IReadOnlyList<FlightWaypoint> points)
    {
        foreach (var (a, b) in points.Zip(points.Skip(1)))
        {
            var steps = Math.Max(1, (int)Math.Ceiling(a.Position.DistanceTo(b.Position) / .5));
            for (var k = 0; k <= steps; k++)
            {
                var position = a.Position.Towards(b.Position, (double)k / steps);
                var altitude = a.AltitudeMetres + (b.AltitudeMetres - a.AltitudeMetres) * k / steps;
                Assert.True(altitude >= airspace.ClearanceAltitude(position) - 1e-6);
            }
        }
    }

    /// <summary>Every flown sample clears the envelope under it, and the profile never exceeds the climb gradient.</summary>
    static void AssertFlownClearance(BuildingAirspace airspace, FlightLeg leg)
    {
        for (var t = TimeSpan.Zero; t <= leg.Duration; t += TimeSpan.FromSeconds(.1))
        {
            var sample = leg.At(t);
            Assert.True(sample.AltitudeMetres >= airspace.ClearanceAltitude(sample.Position) - 1e-6,
                $"{sample.AltitudeMetres:F1} m is below clearance {airspace.ClearanceAltitude(sample.Position):F1} m at {t}");
        }
        var points = leg.Path.Points;
        for (var i = 1; i < points.Count; i++)
        {
            var run = leg.Path.PointDistances[i] - leg.Path.PointDistances[i - 1];
            if (run > .01)
                Assert.True(Math.Abs(points[i].AltitudeMetres - points[i - 1].AltitudeMetres) <= leg.Spec.MaxClimbGradient * run + .01,
                    $"{points[i - 1].AltitudeMetres:F2} -> {points[i].AltitudeMetres:F2} over {run:F2} m at {i}/{points.Count}");
        }
    }

    static double DistanceToRoute(IReadOnlyList<FlightWaypoint> route, GeoPoint position, double altitude)
    {
        var p = AirPoint.From(position);
        return route.Zip(route.Skip(1)).Min(pair =>
        {
            var a = AirPoint.From(pair.First.Position); var b = AirPoint.From(pair.Second.Position);
            var (dx, dy, dz) = (b.X - a.X, b.Y - a.Y, pair.Second.AltitudeMetres - pair.First.AltitudeMetres);
            var length = dx * dx + dy * dy + dz * dz;
            var f = length < 1e-9 ? 0 : Math.Clamp(((p.X - a.X) * dx + (p.Y - a.Y) * dy + (altitude - pair.First.AltitudeMetres) * dz) / length, 0, 1);
            return Math.Sqrt(Math.Pow(a.X + dx * f - p.X, 2) + Math.Pow(a.Y + dy * f - p.Y, 2) + Math.Pow(pair.First.AltitudeMetres + dz * f - altitude, 2));
        });
    }
}
