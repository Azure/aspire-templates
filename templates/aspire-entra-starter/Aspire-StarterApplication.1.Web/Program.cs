using Aspire_StarterApplication._1.Web;
using Aspire_StarterApplication._1.Web.Components;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.Identity.Web;

var builder = WebApplication.CreateBuilder(args);

// Add service defaults & Aspire client integrations.
builder.AddServiceDefaults();
#if (UseRedisCache)
builder.AddRedisClientBuilder("cache")
    .WithAzureAuthentication()
    .WithOutputCache();
#endif

// Sign users in with Microsoft Entra ID and acquire access tokens to call the API service.
// The AzureAd and DownstreamApis configuration sections are provided by the AppHost from the
// frontend's Entra ID app registration.
builder.Services.AddAuthentication(OpenIdConnectDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApp(builder.Configuration)
    .EnableTokenAcquisitionToCallDownstreamApi()
    .AddInMemoryTokenCaches();
builder.Services.AddCascadingAuthenticationState();
builder.Services.AddAuthorization();
builder.Services.AddScoped<BlazorAuthenticationChallengeHandler>();

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

#if (!UseRedisCache)
builder.Services.AddOutputCache();

#endif
builder.Services.AddHttpClient<WeatherApiClient>(client =>
    {
        // This URL uses "https+http://" to indicate HTTPS is preferred over HTTP.
        // Learn more about service discovery scheme resolution at https://aka.ms/dotnet/sdschemes.
        client.BaseAddress = new("https+http://apiservice");
    })
    // Attaches an access token for the signed-in user, with the API's scopes, to each request.
    .AddMicrosoftIdentityMessageHandler(builder.Configuration.GetSection("DownstreamApis:apiservice"));

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

app.UseHttpsRedirection();

app.UseAuthentication();
app.UseAuthorization();

app.UseAntiforgery();

app.UseOutputCache();

app.MapStaticAssets();

app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.MapGroup("/authentication").MapLoginAndLogout();

app.MapDefaultEndpoints();

app.Run();
