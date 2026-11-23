using System.Collections.Concurrent;
using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Net;
using System.Text.Json;
using DroneDelivery.Domain;
using DroneDelivery.Server;
using DroneDelivery.UiHosting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Azure.SignalR.Management;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace DroneDelivery.Tests;

public class RealtimeTests
{
    static readonly DateTimeOffset Now = new(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
    static readonly GeoPoint Store = ServiceArea.Stores[0].Location;

    static OrderPlaced Order(string orderId) => new(orderId, "customer", "Test", Store, 1, [], Now, "test");

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("FC-abcdef")]
    [InlineData("FC-123456\n")]
    [InlineData("FC-../123456")]
    public void Invalid_order_ids_cannot_subscribe(string? orderId) =>
        Assert.False(CustomerSubscriptions.IsValidOrderId(orderId));

    [Fact]
    public void Subscriptions_are_bounded_and_renewed_without_evicting_live_orders()
    {
        var time = new TestTime();
        var subscriptions = new CustomerSubscriptions(time);
        for (var i = 0; i < CustomerSubscriptions.Capacity; i++)
            Assert.True(subscriptions.TrySubscribe($"FC-{i:X6}"));
        Assert.False(subscriptions.TrySubscribe("FC-FFFFFF"));
        time.Now += TimeSpan.FromMinutes(30);
        Assert.True(subscriptions.TrySubscribe("FC-000000"));
        time.Now += TimeSpan.FromMinutes(30);
        Assert.Equal(["FC-000000"], subscriptions.Active());
        Assert.True(subscriptions.TrySubscribe("FC-FFFFFF"));
        time.Now += CustomerSubscriptions.Lease;
        Assert.Empty(subscriptions.Active());
    }

    [Fact]
    public async Task Broadcasts_only_negotiated_customer_orders_and_filters_other_mission_telemetry()
    {
        var dispatcher = new Dispatcher();
        var time = new TestTime();
        var subscriptions = new CustomerSubscriptions(time);
        var manager = new TestManager();
        var contexts = new RealtimeContexts(manager, NullLogger<RealtimeContexts>.Instance);
        await contexts.StartAsync(TestContext.Current.CancellationToken);
        var telemetry = new DroneTelemetry("PIC-01", DroneClass.Piccolo, 1, Now, Store, Store,
            0, 0, 100, DroneState.Parked, Manoeuvre.OnTheGround, null, null, 0);
        dispatcher.Observe(telemetry);
        dispatcher.Accept(Order("FC-000001"));
        dispatcher.Accept(Order("FC-000002"));
        dispatcher.Accept(Order("FC-000003"));
        dispatcher.PlanPending(Now);
        dispatcher.Observe(telemetry with { Sequence = 2, OrderId = "FC-000001", State = DroneState.FlyingToPickup });
        subscriptions.TrySubscribe("FC-000001");
        subscriptions.TrySubscribe("FC-000002");

        var worker = new RealtimeWorker(dispatcher, subscriptions, contexts, time, NullLogger<RealtimeWorker>.Instance);
        await worker.BroadcastAsync(TestContext.Current.CancellationToken);

        var customerSends = manager.Hubs["customers"].Sends;
        Assert.Equal(2, customerSends.Count);
        Assert.All(customerSends, send => Assert.Equal("orderUpdated", send.Method));
        Assert.Equal(["FC-000001", "FC-000002"], customerSends.Select(send => send.User));
        Assert.Equal("FC-000001", Assert.IsType<OrderSnapshot>(customerSends[0].Payload).Telemetry!.OrderId);
        Assert.Null(Assert.IsType<OrderSnapshot>(customerSends[1].Payload).Telemetry);
        var operatorSend = Assert.Single(manager.Hubs["operators"].Sends);
        Assert.Null(operatorSend.User);
        Assert.Equal("snapshot", operatorSend.Method);
        var snapshot = Assert.IsType<OperatorSnapshot>(operatorSend.Payload);
        Assert.Single(snapshot.Fleet);
        Assert.Equal(3, snapshot.Orders.Count);
        Assert.Equal(ServiceArea.Stores, snapshot.Stores);
        await contexts.StopAsync(TestContext.Current.CancellationToken);
        Assert.All(manager.Hubs.Values, hub => Assert.True(hub.Disposed));
    }

    [Fact]
    public async Task Failed_repeated_customer_broadcast_is_traced_without_tracing_successful_ticks()
    {
        var spans = new ConcurrentQueue<Activity>();
        var messages = new ConcurrentQueue<(string Audience, string Outcome)>();
        using var meters = new MeterListener
        {
            InstrumentPublished = (instrument, listener) =>
            {
                if (instrument.Meter.Name == DeliveryMetrics.MeterName && instrument.Name == "drone_delivery.realtime.messages")
                    listener.EnableMeasurementEvents(instrument);
            },
        };
        meters.SetMeasurementEventCallback<long>((_, _, tags, _) =>
        {
            var all = tags.ToArray();
            string Tag(string name) => (string)all.Single(tag => tag.Key == name).Value!;
            messages.Enqueue((Tag("drone_delivery.realtime.audience"), Tag("drone_delivery.realtime.outcome")));
        });
        meters.Start();
        using var listener = new ActivityListener
        {
            ShouldListenTo = source => source.Name == Tracing.SourceName,
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded,
            ActivityStopped = activity =>
            {
                if (activity.OperationName == "realtime publish order update" &&
                    Equals(activity.GetTagItem("drone_delivery.order.id"), "FC-ABC123"))
                    spans.Enqueue(activity);
            },
        };
        ActivitySource.AddActivityListener(listener);
        using var accepted = Tracing.Start("process orders")!;
        var dispatcher = new Dispatcher();
        dispatcher.Accept(Order("FC-ABC123"), accepted.Context);
        var time = new TestTime();
        var subscriptions = new CustomerSubscriptions(time);
        subscriptions.TrySubscribe("FC-ABC123");
        var manager = new TestManager();
        var contexts = new RealtimeContexts(manager, NullLogger<RealtimeContexts>.Instance);
        await contexts.StartAsync(TestContext.Current.CancellationToken);
        var worker = new RealtimeWorker(dispatcher, subscriptions, contexts, time, NullLogger<RealtimeWorker>.Instance);

        await worker.BroadcastAsync(TestContext.Current.CancellationToken);
        await worker.BroadcastAsync(TestContext.Current.CancellationToken);
        var published = Assert.Single(spans);
        // Only the stage change carries trace context to the browser; the repeated tick does not.
        var sends = manager.Hubs["customers"].Sends;
        Assert.Equal($"00-{published.TraceId}-{published.SpanId}-01", sends[0].TraceParent);
        Assert.Null(sends[1].TraceParent);

        manager.Hubs["customers"].FailSends = true;
        await worker.BroadcastAsync(TestContext.Current.CancellationToken);
        var failed = Assert.Single(spans, span => span.Status == ActivityStatusCode.Error);
        Assert.Equal(accepted.TraceId, failed.TraceId);
        Assert.Equal(accepted.SpanId, failed.ParentSpanId);
        Assert.Equal(2, spans.Count);

        manager.Hubs["customers"].FailSends = false;
        await worker.BroadcastAsync(TestContext.Current.CancellationToken);
        Assert.Equal(2, spans.Count);
        // Every send is counted, including the untraced ticks.
        Assert.Equal([("customer", "sent"), ("customer", "sent"), ("customer", "failed"), ("customer", "sent")],
            messages.Where(message => message.Audience == "customer"));
        Assert.Equal(4, messages.Count(message => message.Audience == "operator"));
        await contexts.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task Negotiate_validates_orders_and_returns_sdk_redirect_with_scoped_identity()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        var dispatcher = new Dispatcher();
        dispatcher.Accept(Order("FC-123ABC"));
        var manager = new TestManager();
        var contexts = new RealtimeContexts(manager, NullLogger<RealtimeContexts>.Instance);
        await contexts.StartAsync(TestContext.Current.CancellationToken);
        builder.Services.AddSingleton(dispatcher);
        builder.Services.AddSingleton(new CustomerSubscriptions(new TestTime()));
        builder.Services.AddSingleton(contexts);
        await using var app = builder.Build();
        app.MapRealtimeEndpoints();
        await app.StartAsync(TestContext.Current.CancellationToken);
        var client = app.GetTestClient();

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/realtime/customer/negotiate", null, TestContext.Current.CancellationToken)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/realtime/customer/negotiate?orderId=FC-FFFFFF", null, TestContext.Current.CancellationToken)).StatusCode);
        Assert.Null(manager.Hubs["customers"].Negotiation);
        var response = await client.PostAsync("/realtime/customer/negotiate?orderId=FC-123ABC&negotiateVersion=1", null, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl!.NoStore);
        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)).RootElement;
        Assert.Equal("https://example.test/client", json.GetProperty("url").GetString());
        Assert.Equal("test-token", json.GetProperty("accessToken").GetString());
        Assert.False(json.TryGetProperty("error", out _));
        var negotiation = manager.Hubs["customers"].Negotiation!;
        Assert.Equal("FC-123ABC", negotiation.UserId);
        Assert.True(negotiation.CloseOnAuthenticationExpiration);
        Assert.Equal(CustomerSubscriptions.Lease, negotiation.TokenLifetime);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/realtime/operator/negotiate?negotiateVersion=1", null, TestContext.Current.CancellationToken)).StatusCode);
        Assert.Null(manager.Hubs["operators"].Negotiation!.UserId);
        await contexts.StopAsync(TestContext.Current.CancellationToken);
    }

    [Theory]
    [InlineData("customer", "operator")]
    [InlineData("operator", "customer")]
    public async Task Ui_proxy_forwards_api_and_own_negotiate_but_not_other_realtime_routes(string own, string other)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["services:backend:http:0"] = "http://backend.test" });
        builder.AddBackendProxy();
        var forwarded = new List<string>();
        builder.Services.AddHttpClient("backend").ConfigurePrimaryHttpMessageHandler(() => new TestHandler(async request =>
        {
            forwarded.Add(request.RequestUri!.PathAndQuery);
            if (request.Method == HttpMethod.Post && request.RequestUri.AbsolutePath == "/api/orders")
                Assert.Equal("{\"lines\":[\"Coffee\"]}", await request.Content!.ReadAsStringAsync());
            return new HttpResponseMessage(HttpStatusCode.Accepted) { Content = new StringContent("{\"ok\":true}") };
        }));
        await using var app = builder.Build();
        app.MapBackendProxy($"/realtime/{own}/negotiate");
        await app.StartAsync(TestContext.Current.CancellationToken);
        var client = app.GetTestClient();
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsync("/api/orders", new StringContent("{\"lines\":[\"Coffee\"]}"), TestContext.Current.CancellationToken)).StatusCode);
        var ownRoute = $"/realtime/{own}/negotiate?orderId=FC-123ABC&negotiateVersion=1";
        Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsync(ownRoute, null, TestContext.Current.CancellationToken)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync($"/realtime/{other}/negotiate", null, TestContext.Current.CancellationToken)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/realtime/{own}/negotiate", TestContext.Current.CancellationToken)).StatusCode);
        Assert.Equal(["/api/orders", ownRoute], forwarded);
    }

    [Fact]
    public async Task Ui_proxy_preserves_backend_errors_and_reports_transport_failures_as_bad_gateway()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["services:backend:http:0"] = "http://backend.test" });
        builder.AddBackendProxy();
        builder.Services.AddHttpClient("backend").ConfigurePrimaryHttpMessageHandler(() => new TestHandler(request =>
            request.RequestUri!.AbsolutePath == "/api/unavailable"
                ? Task.FromException<HttpResponseMessage>(new HttpRequestException("Test transport failure"))
                : Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable) { Content = new StringContent("Backend failure") })));
        await using var app = builder.Build();
        app.MapBackendProxy("/realtime/customer/negotiate");
        await app.StartAsync(TestContext.Current.CancellationToken);
        var client = app.GetTestClient();
        var backendError = await client.GetAsync("/api/error", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, backendError.StatusCode);
        Assert.Equal("Backend failure", await backendError.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        var transportError = await client.GetAsync("/api/unavailable", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadGateway, transportError.StatusCode);
        Assert.Equal("application/problem+json", transportError.Content.Headers.ContentType!.MediaType);
    }

    [Theory]
    [InlineData("http/protobuf", true)]
    [InlineData("grpc", false)]
    public async Task Built_sites_relay_bounded_browser_spans_with_server_side_otlp_headers(string protocol, bool enabled)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["services:backend:http:0"] = "http://backend.test",
            ["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://dashboard.test:4318/",
            ["OTEL_EXPORTER_OTLP_PROTOCOL"] = protocol,
            ["OTEL_EXPORTER_OTLP_HEADERS"] = "x-otlp-api-key=s%3Dcret",
        });
        builder.AddBackendProxy();
        builder.AddBrowserTelemetry();
        var forwarded = new List<(string Uri, string? Key, int Bytes)>();
        builder.Services.AddHttpClient(nameof(BrowserTelemetry)).ConfigurePrimaryHttpMessageHandler(() => new TestHandler(async request =>
        {
            forwarded.Add((request.RequestUri!.AbsoluteUri, request.Headers.GetValues("x-otlp-api-key").Single(),
                (await request.Content!.ReadAsByteArrayAsync()).Length));
            return new HttpResponseMessage(HttpStatusCode.OK);
        }));
        await using var app = builder.Build();
        app.MapBrowserTelemetry("customer-site");
        app.MapFallback(() => "index.html");
        await app.StartAsync(TestContext.Current.CancellationToken);
        var client = app.GetTestClient();
        HttpContent Spans(int bytes, string type = "application/x-protobuf")
        {
            var content = new ByteArrayContent(new byte[bytes]);
            content.Headers.ContentType = new(type);
            return content;
        }

        var config = await client.GetAsync(BrowserTelemetry.ConfigPath, TestContext.Current.CancellationToken);
        var export = await client.PostAsync(BrowserTelemetry.TracesPath, Spans(64), TestContext.Current.CancellationToken);
        if (!enabled)
        {
            Assert.Equal(HttpStatusCode.NotFound, config.StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, export.StatusCode);
            Assert.Empty(forwarded);
            return;
        }
        Assert.Equal("{\"serviceName\":\"customer-site\"}", await config.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(HttpStatusCode.OK, export.StatusCode);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType,
            (await client.PostAsync(BrowserTelemetry.TracesPath, Spans(64, "application/json"), TestContext.Current.CancellationToken)).StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge,
            (await client.PostAsync(BrowserTelemetry.TracesPath, Spans(BrowserTelemetry.MaxBodyBytes + 1), TestContext.Current.CancellationToken)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await client.PostAsync("/otlp/v1/logs", Spans(64), TestContext.Current.CancellationToken)).StatusCode);
        Assert.Equal([("http://dashboard.test:4318/v1/traces", "s=cret", 64)], forwarded);
    }

    [Fact]
    public async Task Management_transient_transport_serializes_string_enums_and_web_property_names()
    {
        var received = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var app = builder.Build();
        app.Run(async context =>
        {
            if (context.Request.Method == "POST")
            {
                using var document = await JsonDocument.ParseAsync(context.Request.Body);
                received.TrySetResult(document.RootElement.Clone());
            }
            context.Response.StatusCode = StatusCodes.Status202Accepted;
        });
        await app.StartAsync(TestContext.Current.CancellationToken);
        var endpoint = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        // An isolated fake service uses a deterministic test key; no actual SignalR credentials.
        using var manager = RealtimeContexts.CreateManager(
            $"Endpoint={endpoint};AccessKey={Convert.ToBase64String(new byte[32])};Version=1.0;",
            NullLoggerFactory.Instance);
        var hub = await manager.CreateHubContextAsync("customers", TestContext.Current.CancellationToken);
        try
        {
            var dispatcher = new Dispatcher();
            var order = dispatcher.Accept(Order("FC-123ABC")) with
            {
                DroneClass = DroneClass.Piccolo,
                Photos = [new OrderPhoto("test.svg", PhotoTrigger.LandingEnd, true, Now)],
            };
            await hub.Clients.User(order.Order.OrderId).SendAsync("orderUpdated", order, TestContext.Current.CancellationToken);
            var message = await received.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
            var payload = message.GetProperty("Arguments")[0];
            Assert.Equal("AwaitingFleet", payload.GetProperty("status").GetString());
            Assert.Equal("Piccolo", payload.GetProperty("droneClass").GetString());
            Assert.Equal("LandingEnd", payload.GetProperty("photos")[0].GetProperty("trigger").GetString());
            Assert.Equal("FC-123ABC", payload.GetProperty("order").GetProperty("orderId").GetString());
            Assert.Equal(JsonValueKind.Null, payload.GetProperty("telemetry").ValueKind);
        }
        finally
        {
            await hub.DisposeAsync();
        }
    }

    sealed class TestTime : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = RealtimeTests.Now;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    sealed class TestHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request);
    }

    sealed class TestManager : ServiceManager
    {
        public Dictionary<string, TestHub> Hubs { get; } = [];
        public override Task<ServiceHubContext> CreateHubContextAsync(string hubName, CancellationToken cancellationToken)
        {
            var hub = new TestHub();
            Hubs.Add(hubName, hub);
            return Task.FromResult<ServiceHubContext>(hub);
        }
        public override Task<bool> IsServiceHealthy(CancellationToken cancellationToken) => Task.FromResult(true);
        public override void Dispose() { }
    }

    sealed class TestHub : ServiceHubContext
    {
        public List<(string? User, string Method, object Payload, string? TraceParent)> Sends { get; } = [];
        public bool FailSends { get; set; }
        public NegotiationOptions? Negotiation { get; private set; }
        public bool Disposed { get; private set; }
        public override IHubClients Clients => new TestClients(this);
        public override ValueTask<NegotiationResponse> NegotiateAsync(NegotiationOptions? negotiationOptions = null, CancellationToken cancellationToken = default)
        {
            Negotiation = negotiationOptions;
            return ValueTask.FromResult(new NegotiationResponse { Url = "https://example.test/client", AccessToken = "test-token" });
        }
        public override Task DisposeAsync()
        {
            Disposed = true;
            return Task.CompletedTask;
        }
    }

    sealed class TestProxy(TestHub hub, string? user) : IClientProxy
    {
        public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
        {
            if (hub.FailSends)
                return Task.FromException(new InvalidOperationException("Test broadcast failure"));
            hub.Sends.Add((user, method, args[0]!, args.Length > 1 ? (string?)args[1] : null));
            return Task.CompletedTask;
        }
    }

    sealed class TestClients(TestHub hub) : IHubClients
    {
        public IClientProxy All => new TestProxy(hub, null);
        public IClientProxy User(string userId) => new TestProxy(hub, userId);
        public IClientProxy AllExcept(IReadOnlyList<string> excludedConnectionIds) => throw new NotSupportedException();
        public IClientProxy Client(string connectionId) => throw new NotSupportedException();
        public IClientProxy Clients(IReadOnlyList<string> connectionIds) => throw new NotSupportedException();
        public IClientProxy Group(string groupName) => throw new NotSupportedException();
        public IClientProxy GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => throw new NotSupportedException();
        public IClientProxy Groups(IReadOnlyList<string> groupNames) => throw new NotSupportedException();
        public IClientProxy Users(IReadOnlyList<string> userIds) => throw new NotSupportedException();
    }
}
