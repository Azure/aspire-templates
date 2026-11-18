using System.Diagnostics;
using System.Text.RegularExpressions;
using Azure.Messaging.EventHubs.Producer;
using Azure.Storage.Blobs;
using DroneDelivery.Domain;
using DroneDelivery.Server;

var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults();
builder.Services.AddHealthChecks();
builder.Services.AddProblemDetails();
builder.Services.ConfigureHttpJsonOptions(options =>
{
    foreach (var converter in EventSerializer.Options.Converters)
        options.SerializerOptions.Converters.Add(converter);
});

foreach (var hub in new[] { Hubs.Orders, Hubs.DroneTelemetry, Hubs.DronePhotos })
    builder.AddKeyedAzureEventHubConsumerClient(hub, settings => { settings.ConsumerGroup ??= "$Default"; settings.DisableTracing = true; });
builder.AddKeyedAzureEventHubProducerClient(Hubs.Orders, settings => settings.DisableTracing = true);
builder.AddKeyedAzureEventHubProducerClient(Hubs.DroneMissions, settings => settings.DisableTracing = true);
builder.AddAzureBlobContainerClient(Hubs.PhotoContainer);
builder.AddAzureCosmosContainer("order-store", configureClientOptions: (_, options) =>
    options.UseSystemTextJsonSerializerWithOptions = EventSerializer.Options);

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<Dispatcher>();
// Registered first so persisted orders are restored before logistics starts consuming events.
builder.Services.AddHostedService<OrderStore>();
builder.Services.AddHostedService<LogisticsWorker>();
builder.Services.AddSingleton(sp => RealtimeContexts.CreateManager(
    builder.Configuration.GetConnectionString("signalr")
        ?? throw new InvalidOperationException("The signalr connection string is required."),
    sp.GetRequiredService<ILoggerFactory>()));
builder.Services.AddSingleton<CustomerSubscriptions>();
builder.Services.AddSingleton<RealtimeContexts>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<RealtimeContexts>());
builder.Services.AddHostedService<RealtimeWorker>();

var app = builder.Build();
app.UseExceptionHandler();
app.MapHealthChecks("/health");

app.MapGet("/api/demo", () => new
{
    name = "ForthCoffee",
    location = "South Melbourne, Victoria",
    mode = "Customer and fleet operations sites share simulated orders, drone telemetry and camera events through the API",
});

app.MapGet("/api/fleet", (Dispatcher dispatcher) => dispatcher.Fleet());
app.MapGet("/api/stores", () => ServiceArea.Stores);
app.MapGet("/api/waste", () => ServiceArea.Waste);
app.MapGet("/api/orders", (Dispatcher dispatcher, int? take) => dispatcher.Orders(Math.Clamp(take ?? 50, 1, 500)));
app.MapGet("/api/orders/{orderId}", (Dispatcher dispatcher, string orderId) =>
    dispatcher.Order(orderId) is { } order ? Results.Ok(order) : Results.NotFound());

app.MapRealtimeEndpoints();

app.MapPost("/api/fleet/{droneId}/commands", async (
    string droneId, DroneCommand command, Dispatcher dispatcher, TimeProvider time,
    [FromKeyedServices(Hubs.DroneMissions)] EventHubProducerClient missions, CancellationToken cancellationToken) =>
{
    if (!Enum.IsDefined(command))
        return Results.BadRequest(new { message = "Unknown drone command." });
    var request = new DroneCommandRequested(Guid.NewGuid().ToString("N"), droneId, command);
    using var activity = Tracing.Start("operator drone command")
        ?.SetTag("drone_delivery.drone.id", droneId).SetTag("drone_delivery.command", command.ToString())
        .SetTag("drone_delivery.command.id", request.CommandId);
    if (!dispatcher.TryBeginCommand(request, time.GetUtcNow(), out var error))
    {
        activity?.SetStatus(ActivityStatusCode.Error, error);
        return Results.Conflict(new { message = error });
    }
    try { await missions.SendAsync(request, droneId, cancellationToken); }
    catch (Exception exception)
    {
        dispatcher.CancelPendingCommand(request);
        activity.Failed(exception);
        throw;
    }
    return Results.Accepted(value: new { request.CommandId });
});

// Manual control: take, resume previous programming, or cancel and return to base. Inputs stream separately (untraced).
app.MapPost("/api/fleet/{droneId}/manual", async (
    string droneId, ManualControlRequest body, Dispatcher dispatcher, TimeProvider time,
    [FromKeyedServices(Hubs.DroneMissions)] EventHubProducerClient missions, CancellationToken cancellationToken) =>
{
    if (!Enum.IsDefined(body.Action) || string.IsNullOrWhiteSpace(body.SessionId) || body.SessionId.Length > 64)
        return Results.BadRequest(new { message = "Specify a manual-control action and session." });
    var request = new ManualControlRequested(Guid.NewGuid().ToString("N"), droneId, body.SessionId, body.Action);
    using var activity = Tracing.Start("operator manual control")
        ?.SetTag("drone_delivery.drone.id", droneId).SetTag("drone_delivery.manual.action", body.Action.ToString())
        .SetTag("drone_delivery.manual.request.id", request.RequestId);
    if (!dispatcher.TryBeginManual(request, time.GetUtcNow(), out var error))
    {
        activity?.SetStatus(ActivityStatusCode.Error, error);
        return Results.Conflict(new { message = error });
    }
    try { await missions.SendAsync(request, droneId, cancellationToken); }
    catch (Exception exception)
    {
        dispatcher.CancelManual(request);
        activity.Failed(exception);
        throw;
    }
    return Results.Accepted(value: new { request.RequestId });
});

// Several stick updates a second per controlling operator: not traced (see ServiceDefaults) and sent untraced.
app.MapPost("/api/fleet/{droneId}/manual/input", async (
    string droneId, ManualInputRequest body, Dispatcher dispatcher, TimeProvider time,
    [FromKeyedServices(Hubs.DroneMissions)] EventHubProducerClient missions, CancellationToken cancellationToken) =>
{
    if (body.Input is null || string.IsNullOrWhiteSpace(body.SessionId))
        return Results.BadRequest();
    if (!dispatcher.IsFlying(droneId, body.SessionId, time.GetUtcNow()))
        return Results.Conflict(new { message = "This session is not flying the drone." });
    await missions.SendAsync(new ManualControlInput(droneId, body.SessionId, body.Sequence, body.Input.Clamped()), droneId,
        cancellationToken, traced: false);
    return Results.NoContent();
});

app.MapPost("/api/orders/{orderId}/demo/skip", async (
    string orderId, DemoStageSkipped request, Dispatcher dispatcher,
    [FromKeyedServices(Hubs.DroneMissions)] EventHubProducerClient missions,
    TimeProvider time, CancellationToken cancellationToken) =>
{
    if (request.OrderId != orderId || !Enum.IsDefined(request.Stage))
        return Results.BadRequest();
    if (dispatcher.Order(orderId) is not { } order)
        return Results.NotFound();
    // The skip is a separate request from the one that placed the order; link the two traces.
    using var activity = Tracing.Start($"demo skip {request.Stage}", links: [new ActivityLink(dispatcher.TraceOf(orderId))]).Describe(request);
    if (!dispatcher.CanSkip(orderId, request.Stage, time.GetUtcNow()))
    {
        activity?.SetStatus(ActivityStatusCode.Error, "Stage cannot be skipped now");
        return Results.Conflict(new { message = "This stage cannot be skipped now. Wait for an assigned drone or the next stage." });
    }
    await missions.SendAsync(request, order.DroneId ?? orderId, cancellationToken);
    if (request.Stage == DemoStage.Preparing)
        dispatcher.SkipPreparation(orderId, time.GetUtcNow());
    return Results.Accepted();
});

// Web orders take the same path as simulated customers: onto the orders hub, then through logistics.
app.MapPost("/api/orders", async (
    PlaceOrder request,
    [FromKeyedServices(Hubs.Orders)] EventHubProducerClient orders,
    TimeProvider time,
    CancellationToken cancellationToken) =>
{
    if (request.Lines is not { Count: > 0 and <= 4 } || request.Lines.Any(line => string.IsNullOrWhiteSpace(line)))
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["lines"] = ["Choose between one and four items."] });
    if (!ServiceArea.Contains(request.DropOff))
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["dropOff"] = ["Drop-off must be inside the South Melbourne service area."] });
    var payloadBays = request.PayloadBays ?? (request.Lines.Count switch { 1 => 1, 2 => 2, _ => 4 });
    if (payloadBays is not (1 or 2 or 4) || payloadBays < request.Lines.Count)
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["payloadBays"] = ["Choose a single, double or quad payload that fits the items."] });
    var lines = request.Lines.Select(item => new OrderLine(item.Trim(), 1)).ToList();
    var order = new OrderPlaced(
        $"FC-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}", "web", request.CustomerName?.Trim() is { Length: > 0 } name ? name : "You",
        request.DropOff, payloadBays, lines, time.GetUtcNow(), "web");
    Activity.Current.Describe(order);
    await orders.SendAsync(order, order.CustomerId, cancellationToken);
    return Results.Accepted($"/api/orders/{order.OrderId}", new { order.OrderId });
});

app.MapGet("/api/photos/{droneId}/{fileName}", async (string droneId, string fileName, BlobContainerClient container, HttpResponse response, CancellationToken cancellationToken) =>
{
    if (!PhotoName.IsMatch($"{droneId}/{fileName}"))
        return Results.NotFound();
    var blob = container.GetBlobClient($"{droneId}/{fileName}");
    if (!await blob.ExistsAsync(cancellationToken))
        return Results.NotFound();
    // Images are SVG: never let them run script or load anything.
    response.Headers.ContentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'";
    response.Headers.XContentTypeOptions = "nosniff";
    var download = await blob.DownloadStreamingAsync(cancellationToken: cancellationToken);
    return Results.Stream(download.Value.Content, "image/svg+xml");
});

app.Run();

record PlaceOrder(string? CustomerName, GeoPoint DropOff, IReadOnlyList<string> Lines, int? PayloadBays);

static partial class Program
{
    static readonly Regex PhotoName = new(@"^[A-Z]{3}-\d{2}/\d{8}T\d{9}-[A-Za-z]+\.svg$", RegexOptions.Compiled);
}

record ManualControlRequest(string SessionId, ManualAction Action);
record ManualInputRequest(string SessionId, long Sequence, ManualInput? Input);
