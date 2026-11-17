using DroneDelivery.Domain;

namespace DroneDelivery.Tests;

public class LandingPadTests
{
    static readonly PickupLocation Store = ServiceArea.Stores[0];

    [Fact]
    public void Every_store_has_distinct_separated_pads_on_one_deck()
    {
        foreach (var store in ServiceArea.Stores)
        {
            Assert.Equal(ServiceArea.PadsPerStore, store.Pads.Count);
            Assert.Equal(store.Pads.Count, store.Pads.Select(pad => pad.Id).Distinct().Count());
            foreach (var pad in store.Pads)
            {
                Assert.True(ServiceArea.Contains(pad.Location));
                Assert.All(store.Pads.Where(other => other != pad),
                    other => Assert.True(pad.Location.DistanceTo(other.Location) >= ServiceArea.PadSpacingMetres - .01));
            }
            Assert.Single(store.Pads.Select(pad => BuildingAirspace.Shared.PadAltitude(pad.Location)).Distinct());
        }
        Assert.Equal(Store with { }, Store);
        Assert.Empty(ServiceArea.Waste.Pads);
    }

    [Fact]
    public void Concurrent_reservations_never_share_a_pad_and_extra_drones_wait()
    {
        var allocator = new PadAllocator();
        var granted = new System.Collections.Concurrent.ConcurrentBag<(string Drone, LandingPad Pad)>();
        Parallel.For(0, 32, i =>
        {
            if (allocator.TryReserve(Store, $"D-{i}") is { } pad)
                granted.Add(($"D-{i}", pad));
        });
        Assert.Equal(ServiceArea.PadsPerStore, granted.Count);
        Assert.Equal(granted.Count, granted.Select(grant => grant.Pad.Id).Distinct().Count());
        Assert.All(granted, grant => Assert.Equal(grant.Drone, allocator.HolderOf(grant.Pad.Id)));
        Assert.Null(allocator.TryReserve(Store, "waiting"));

        var (drone, held) = granted.First();
        Assert.Equal(held, allocator.TryReserve(Store, drone));
    }

    [Fact]
    public void Pads_are_released_only_once_the_drone_is_clear_and_then_go_to_the_next_drone()
    {
        var allocator = new PadAllocator();
        var pads = Enumerable.Range(0, ServiceArea.PadsPerStore).Select(i => allocator.TryReserve(Store, $"D-{i}")!).ToArray();
        Assert.Null(allocator.TryReserve(Store, "waiting"));

        var climbing = pads[2].Location;
        Assert.False(allocator.ReleaseIfClear("D-2", pads[2], climbing));
        Assert.Null(allocator.TryReserve(Store, "waiting"));

        Assert.True(allocator.ReleaseIfClear("D-2", pads[2], new AirPoint(AirPoint.From(climbing).X + 20, AirPoint.From(climbing).Y).Geo));
        Assert.Equal(pads[2], allocator.TryReserve(Store, "waiting"));

        // Releasing a stale reservation never frees a pad someone else now holds.
        Assert.True(allocator.ReleaseIfClear("D-2", pads[2], ServiceArea.Waste.Location));
        Assert.Equal("waiting", allocator.HolderOf(pads[2].Id));

        allocator.Release("D-0");
        Assert.Null(allocator.HolderOf(pads[0].Id));
        Assert.Equal(pads[0], allocator.TryReserve(ServiceArea.Stores[0], "late"));
        Assert.Equal(ServiceArea.Stores[1].Pads[0], allocator.TryReserve(ServiceArea.Stores[1], "late"));
        Assert.Null(allocator.HolderOf(pads[0].Id));
    }
}
