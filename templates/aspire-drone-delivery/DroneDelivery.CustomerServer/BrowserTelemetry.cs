using System.Net.Http.Headers;
using Microsoft.AspNetCore.Http.Features;

namespace DroneDelivery.UiHosting;

/// <summary>
/// Lets a built site export browser spans through the UI server that hosts it. The browser posts OTLP/HTTP protobuf
/// to its own origin; the server forwards it to its configured OTLP endpoint and adds that endpoint's headers
/// (for example the Aspire dashboard API key), so the key never reaches the browser. Off unless the server's own
/// exporter uses http/protobuf, because a browser cannot speak OTLP over gRPC.
/// </summary>
public static class BrowserTelemetry
{
    public const string ConfigPath = "/telemetry-config.json";
    public const string TracesPath = "/otlp/v1/traces";
    public const int MaxBodyBytes = 512 * 1024;

    public static void AddBrowserTelemetry(this WebApplicationBuilder builder)
    {
        if (TracesEndpoint(builder.Configuration) is not { } endpoint)
            return;
        builder.Services.AddHttpClient(nameof(BrowserTelemetry), client =>
        {
            client.BaseAddress = endpoint;
            client.Timeout = TimeSpan.FromSeconds(10);
            foreach (var (name, value) in Headers(builder.Configuration["OTEL_EXPORTER_OTLP_HEADERS"]))
                client.DefaultRequestHeaders.TryAddWithoutValidation(name, value);
        });
    }

    public static void MapBrowserTelemetry(this WebApplication app, string serviceName)
    {
        if (TracesEndpoint(app.Configuration) is null)
        {
            // Without these routes the SPA fallback would answer with index.html.
            app.MapGet(ConfigPath, () => Results.NotFound());
            app.Map("/otlp/{**path}", () => Results.NotFound());
            return;
        }
        app.MapGet(ConfigPath, () => Results.Ok(new { serviceName }));
        app.MapPost(TracesPath, ForwardAsync);
        app.Map("/otlp/{**path}", () => Results.NotFound());
    }

    public static Uri? TracesEndpoint(IConfiguration configuration) =>
        configuration["OTEL_EXPORTER_OTLP_PROTOCOL"] == "http/protobuf" &&
        Uri.TryCreate(configuration["OTEL_EXPORTER_OTLP_ENDPOINT"], UriKind.Absolute, out var endpoint)
            ? new Uri(endpoint.AbsoluteUri.TrimEnd('/') + "/v1/traces")
            : null;

    static IEnumerable<(string Name, string Value)> Headers(string? headers) =>
        (headers ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(pair => pair.Split('=', 2))
            .Where(pair => pair.Length == 2 && pair[0].Trim().Length > 0)
            .Select(pair => (pair[0].Trim(), Uri.UnescapeDataString(pair[1].Trim())));

    static async Task<IResult> ForwardAsync(HttpContext context, IHttpClientFactory clients, ILoggerFactory loggers)
    {
        if (context.Request.ContentType?.StartsWith("application/x-protobuf", StringComparison.OrdinalIgnoreCase) != true)
            return Results.StatusCode(StatusCodes.Status415UnsupportedMediaType);
        if (context.Request.ContentLength > MaxBodyBytes)
            return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        if (context.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit)
            limit.MaxRequestBodySize = MaxBodyBytes;

        var body = new MemoryStream();
        var buffer = new byte[16 * 1024];
        int read;
        while ((read = await context.Request.Body.ReadAsync(buffer, context.RequestAborted)) > 0)
        {
            if (body.Length + read > MaxBodyBytes)
                return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            body.Write(buffer, 0, read);
        }

        using var content = new ByteArrayContent(body.GetBuffer(), 0, (int)body.Length);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/x-protobuf");
        try
        {
            using var response = await clients.CreateClient(nameof(BrowserTelemetry)).PostAsync("", content, context.RequestAborted);
            return Results.StatusCode((int)response.StatusCode);
        }
        catch (HttpRequestException exception)
        {
            loggers.CreateLogger(nameof(BrowserTelemetry)).LogWarning(exception, "Could not forward browser spans");
            return Results.StatusCode(StatusCodes.Status502BadGateway);
        }
    }
}
