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
        Assert.True(leg.Path.Points.Count > 2);
        Assert.True(leg.DistanceMetres > Point(0).DistanceTo(Point(400)));
        foreach (var (a, b) in leg.Path.Points.Zip(leg.Path.Points.Skip(1)))
            Assert.True(airspace.SegmentClear(a.Position, b.Position, a.AltitudeMetres));
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
        Assert.Equal(2, direct.Points.Count);
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
        Assert.True(leg.Path.Points.Count > 2);
        Assert.All(leg.Path.Points.Zip(leg.Path.Points.Skip(1)),
            pair => Assert.True(BuildingAirspace.Shared.SegmentClear(pair.First.Position, pair.Second.Position, leg.Path.CruiseAltitude)));
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
            foreach (var (a, b) in leg.Path.Points.Zip(leg.Path.Points.Skip(1)))
                Assert.True(airspace.SegmentClear(a.Position, b.Position, a.AltitudeMetres));
        }
    }

    [Fact]
    public void Final_approach_curves_from_cruise_onto_the_pad_and_touches_down_vertically()
    {
        var leg = new FlightLeg(Spec, Point(0), Point(400), Airspace: BuildingAirspace.Empty);
        Assert.InRange(leg.ApproachRadiusMetres, 20, 40);
        var start = leg.Duration - leg.DescentDuration;
        double lastAltitude = leg.Path.CruiseAltitude, lastDistance = double.MaxValue;
        for (var t = start; t <= leg.Duration; t += TimeSpan.FromSeconds(.1))
        {
            var sample = leg.At(t);
            var distance = sample.Position.DistanceTo(Point(400));
            Assert.True(sample.AltitudeMetres <= lastAltitude + 1e-6 && distance <= lastDistance + 1e-6);
            Assert.InRange(Math.Abs(sample.Heading - Point(0).HeadingTo(Point(400))), 0, 1.2);
            lastAltitude = sample.AltitudeMetres;
            lastDistance = distance;
        }
        // Halfway down the drone is still well off to the side; the last metres are effectively vertical.
        Assert.True(leg.At(start + leg.DescentDuration / 3).Position.DistanceTo(Point(400)) > 5);
        var flare = leg.At(leg.Duration - TimeSpan.FromSeconds(.5));
        Assert.True(flare.Position.DistanceTo(Point(400)) < .3 && flare.AltitudeMetres > leg.Path.LandingAltitude);
        Assert.Equal(-90, flare.CameraPitchDegrees, 3);
        Assert.Equal((Point(400), 0d), (leg.At(leg.Duration).Position, leg.At(leg.Duration).AltitudeMetres));
    }

    [Fact]
    public void Approach_falls_back_to_vertical_descent_when_a_curve_would_clip_a_building()
    {
        // A tower right beside the pad: cruise clears it, but any sloped approach would not.
        var airspace = new BuildingAirspace([Block(388, -20, 392, 20, 40)]);
        var leg = new FlightLeg(Spec, Point(0), Point(400), Airspace: airspace);
        Assert.Equal(0, leg.ApproachRadiusMetres);
        Assert.Equal(Point(400), leg.At(leg.Duration - leg.DescentDuration / 2).Position);
        Assert.Equal([leg.Path.CruiseAltitude, leg.Path.LandingAltitude], leg.PlannedRoute.Where(waypoint => waypoint.Position == Point(400)).Select(waypoint => waypoint.AltitudeMetres));
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
