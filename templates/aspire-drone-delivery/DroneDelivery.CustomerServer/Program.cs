using DroneDelivery.UiHosting;

var builder = WebApplication.CreateBuilder(args);
builder.AddBackendProxy();
var app = builder.Build();
app.UseExceptionHandler();
app.MapHealthChecks("/health");
app.MapBackendProxy("/realtime/customer/negotiate");
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallbackToFile("index.html");
app.Run();
