using System.Diagnostics;
using DroneDelivery.Domain;

namespace DroneDelivery.Tests;

public sealed class TracingTests : IDisposable
{
    static readonly GeoPoint DropOff = new(-37.8335, 144.9580);
    readonly ActivityListener listener = new()
    {
        ShouldListenTo = source => source.Name == Tracing.SourceName,
        Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded,
    };

    public TracingTests() => ActivitySource.AddActivityListener(listener);

    public void Dispose() => listener.Dispose();

    [Fact]
    public void EventPropertiesCarryTraceContextToTheConsumer()
    {
        using var producer = Tracing.Start("send orders", kind: ActivityKind.Producer)!;
        var data = Messaging.ToEventData(new DemoStageSkipped("FC-ABC123", DemoStage.Preparing));
        Tracing.Inject(producer, data.Properties);

        var extracted = Tracing.Extract(data.Properties);

        Assert.Equal(producer.TraceId, extracted.TraceId);
        Assert.Equal(producer.SpanId, extracted.SpanId);
        Assert.True(extracted.IsRemote);
        Assert.Equal(default, Tracing.Extract(Messaging.ToEventData(new DemoStageSkipped("FC-ABC123", DemoStage.Preparing)).Properties));
    }

    [Fact]
    public void OrderSpansRecordIdentifiersButNoCustomerDetails()
    {
        var order = new OrderPlaced("FC-ABC123", "customer-42", "Jo Citizen", DropOff, 2,
            [new OrderLine("Flat white · oat", 1)], DateTimeOffset.UnixEpoch, "web");
        using var activity = Tracing.Start("process orders")!.Describe(order)!;

        Assert.Equal("FC-ABC123", activity.GetTagItem("drone_delivery.order.id"));
        var recorded = string.Join('|', activity.TagObjects.Select(tag => $"{tag.Key}={tag.Value}"));
        Assert.DoesNotContain("Jo Citizen", recorded);
        Assert.DoesNotContain("customer-42", recorded);
        Assert.DoesNotContain("Flat white", recorded);
        Assert.DoesNotContain("-37.83", recorded);
    }

    [Fact]
    public void DispatchKeepsEachOrdersTraceSoLaterWorkJoinsIt()
    {
        var dispatcher = new Dispatcher();
        using var accepted = Tracing.Start("process orders", kind: ActivityKind.Consumer)!;
        dispatcher.Accept(new OrderPlaced("FC-ABC123", "c", "Test", DropOff, 1, [], DateTimeOffset.UnixEpoch, "test"), accepted.Context);

        Assert.Equal(accepted.Context, dispatcher.TraceOf("FC-ABC123"));
        Assert.Equal(default, dispatcher.TraceOf("FC-MISSING"));
    }
}
