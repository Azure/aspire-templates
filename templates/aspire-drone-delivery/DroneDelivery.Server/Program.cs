var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHealthChecks();
builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseExceptionHandler();
app.MapHealthChecks("/health");
app.MapGet("/api/demo", () => new
{
    name = "ForthCoffee",
    location = "South Melbourne, Victoria",
    mode = "UX spike: orders and flights are simulated in this browser"
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallbackToFile("index.html");
app.Run();
