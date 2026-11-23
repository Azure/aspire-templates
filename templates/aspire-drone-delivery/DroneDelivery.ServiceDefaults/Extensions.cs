using System.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using OpenTelemetry;
using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;

namespace Microsoft.Extensions.Hosting;

/// <summary>
/// OpenTelemetry logs, metrics and traces for every DroneDelivery service, exported to the Aspire dashboard.
/// Service discovery resolves AppHost references such as <c>http://backend</c>. Health checks are mapped by each host,
/// and the UI hosts' proxy streams bodies, so this deliberately leaves out the starter's resilience handler and
/// default endpoints.
/// </summary>
public static class Extensions
{
    /// <summary>The ActivitySource every DroneDelivery project uses for its own spans.</summary>
    public const string ActivitySourceName = "DroneDelivery";

    public static TBuilder AddServiceDefaults<TBuilder>(this TBuilder builder) where TBuilder : IHostApplicationBuilder
    {
        builder.Services.AddServiceDiscovery();
        builder.Services.ConfigureHttpClientDefaults(http => http.AddServiceDiscovery());

        builder.Logging.AddOpenTelemetry(logging =>
        {
            logging.IncludeFormattedMessage = true;
            logging.IncludeScopes = true;
        });

        builder.Services.AddOpenTelemetry()
            .WithMetrics(metrics => metrics
                .AddMeter(ActivitySourceName)
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                .AddRuntimeInstrumentation())
            .WithTracing(tracing => tracing
                .AddSource(ActivitySourceName)
                .AddSource("Azure.Storage.Blobs.*")
                // Timers and SDK pollers make outbound calls with no caller (e.g. the per-second SignalR broadcast);
                // drop those rootless client spans so traces start where real work starts.
                .SetSampler(new ParentBasedSampler(new DropRootClientSpans()))
                // Browser span exports relayed through /otlp would otherwise trace themselves every second.
                .AddAspNetCoreInstrumentation(options => options.Filter = context =>
                    !context.Request.Path.StartsWithSegments("/health") && !context.Request.Path.StartsWithSegments("/alive") &&
                    !context.Request.Path.StartsWithSegments("/otlp") &&
                    // Manual-control stick inputs arrive several times a second while an operator flies a drone.
                    !(context.Request.Path.Value ?? "").EndsWith("/manual/input", StringComparison.Ordinal))
                .AddHttpClientInstrumentation());

        if (!string.IsNullOrWhiteSpace(builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"]))
            builder.Services.AddOpenTelemetry().UseOtlpExporter();

        return builder;
    }

    sealed class DropRootClientSpans : Sampler
    {
        public override SamplingResult ShouldSample(in SamplingParameters samplingParameters) =>
            new(samplingParameters.Kind == ActivityKind.Client ? SamplingDecision.Drop : SamplingDecision.RecordAndSample);
    }
}
