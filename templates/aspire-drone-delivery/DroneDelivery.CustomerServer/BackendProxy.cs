namespace DroneDelivery.UiHosting;

public static class BackendProxy
{
    static readonly HashSet<string> HopByHop = new(StringComparer.OrdinalIgnoreCase)
    {
        "Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization",
        "TE", "Trailer", "Transfer-Encoding", "Upgrade", "Host",
        // The HttpClient instrumentation writes the proxy span's own context; forwarding the caller's would skip it.
        "traceparent", "tracestate",
    };

    public static void AddBackendProxy(this WebApplicationBuilder builder)
    {
        builder.AddServiceDefaults();
        builder.Services.AddHealthChecks();
        builder.Services.AddProblemDetails();
        // WithReference(backend) in the AppHost supplies services:backend:http:0; service discovery resolves it.
        builder.Services.AddHttpClient("backend", client => client.BaseAddress = new Uri("http://backend"))
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false,
        });
    }

    public static void MapBackendProxy(this WebApplication app, string negotiateRoute)
    {
        app.Map("/api/{**path}", ForwardAsync);
        app.MapPost(negotiateRoute, ForwardAsync);
        app.Map("/realtime/{**path}", () => Results.NotFound());
    }

    static async Task ForwardAsync(HttpContext context, IHttpClientFactory clients, ILoggerFactory loggers)
    {
        var cancellationToken = context.RequestAborted;
        using var request = new HttpRequestMessage(new HttpMethod(context.Request.Method),
            context.Request.Path.ToUriComponent() + context.Request.QueryString.ToUriComponent());
        if (context.Request.ContentLength > 0 || context.Request.Headers.ContainsKey("Transfer-Encoding"))
            request.Content = new StreamContent(context.Request.Body);
        var excluded = ExcludedHeaders(context.Request.Headers);
        foreach (var header in context.Request.Headers)
        {
            if (excluded.Contains(header.Key))
                continue;
            if (!request.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray()))
                request.Content?.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
        }
        try
        {
            using var response = await clients.CreateClient("backend").SendAsync(request,
                HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            context.Response.StatusCode = (int)response.StatusCode;
            var responseExcluded = new HashSet<string>(HopByHop, StringComparer.OrdinalIgnoreCase);
            foreach (var name in response.Headers.Connection)
                responseExcluded.Add(name);
            foreach (var header in response.Headers.Concat(response.Content.Headers))
            {
                if (!responseExcluded.Contains(header.Key))
                    context.Response.Headers[header.Key] = header.Value.ToArray();
            }
            await response.Content.CopyToAsync(context.Response.Body, cancellationToken);
        }
        catch (Exception exception) when (exception is HttpRequestException ||
            exception is OperationCanceledException && !cancellationToken.IsCancellationRequested)
        {
            loggers.CreateLogger("BackendProxy").LogError(exception, "Backend request failed for {Path}", context.Request.Path);
            if (context.Response.HasStarted)
                context.Abort();
            else
            {
                context.Response.Clear();
                await Results.Problem(statusCode: StatusCodes.Status502BadGateway,
                    title: "The backend could not be reached.").ExecuteAsync(context);
            }
        }
    }

    static HashSet<string> ExcludedHeaders(IHeaderDictionary headers)
    {
        var excluded = new HashSet<string>(HopByHop, StringComparer.OrdinalIgnoreCase);
        foreach (var name in headers.Connection.ToString().Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            excluded.Add(name);
        return excluded;
    }
}
