using DroneDelivery.UiHosting;

var builder = WebApplication.CreateBuilder(args);
builder.AddBackendProxy();
builder.AddBrowserTelemetry();
var app = builder.Build();
app.UseExceptionHandler();
app.MapHealthChecks("/health");
app.MapBrowserTelemetry("operator-site");
app.MapBackendProxy("/realtime/operator/negotiate");
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallbackToFile("index.html");
app.Run();
