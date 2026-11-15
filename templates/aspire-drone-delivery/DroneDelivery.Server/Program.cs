using System.Text.RegularExpressions;
using Azure.Messaging.EventHubs.Producer;
using Azure.Storage.Blobs;
using DroneDelivery.Domain;
using DroneDelivery.Server;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHealthChecks();
builder.Services.AddProblemDetails();
builder.Services.ConfigureHttpJsonOptions(options =>
{
    foreach (var converter in EventSerializer.Options.Converters)
        options.SerializerOptions.Converters.Add(converter);
});

foreach (var hub in new[] { Hubs.Orders, Hubs.DroneTelemetry, Hubs.DronePhotos })
    builder.AddKeyedAzureEventHubConsumerClient(hub, settings => settings.ConsumerGroup ??= "$Default");
builder.AddKeyedAzureEventHubProducerClient(Hubs.Orders);
builder.AddKeyedAzureEventHubProducerClient(Hubs.DroneMissions);
builder.AddAzureBlobContainerClient(Hubs.PhotoContainer);

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<Dispatcher>();
builder.Services.AddHostedService<LogisticsWorker>();

var app = builder.Build();
app.UseExceptionHandler();
app.MapHealthChecks("/health");

app.MapGet("/api/demo", () => new
{
    name = "ForthCoffee",
    location = "South Melbourne, Victoria",
    mode = "Simulated customers and drones communicate through Event Hubs; the web UI still runs its own browser simulation",
});

app.MapGet("/api/fleet", (Dispatcher dispatcher) => dispatcher.Fleet());
app.MapGet("/api/orders", (Dispatcher dispatcher, int? take) => dispatcher.Orders(Math.Clamp(take ?? 50, 1, 500)));
app.MapGet("/api/orders/{orderId}", (Dispatcher dispatcher, string orderId) =>
    dispatcher.Order(orderId) is { } order ? Results.Ok(order) : Results.NotFound());

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
    var lines = request.Lines.Select(item => new OrderLine(item.Trim(), 1)).ToList();
    var order = new OrderPlaced(
        $"FC-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}", "web", request.CustomerName?.Trim() is { Length: > 0 } name ? name : "You",
        request.DropOff, lines.Count switch { 1 => 1, 2 => 2, _ => 4 }, lines, time.GetUtcNow(), "web");
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

app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallbackToFile("index.html");
app.Run();

record PlaceOrder(string? CustomerName, GeoPoint DropOff, IReadOnlyList<string> Lines);

static partial class Program
{
    static readonly Regex PhotoName = new(@"^[A-Z]{3}-\d{2}/\d{8}T\d{9}-[A-Za-z]+\.svg$", RegexOptions.Compiled);
}
