using Aspire_StarterApplication._1.Web;
using Aspire_StarterApplication._1.Web.Components;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Identity.Web;

var builder = WebApplication.CreateBuilder(args);

// Add service defaults & Aspire client integrations.
builder.AddServiceDefaults();

// Sign users in with Microsoft Entra ID and acquire access tokens to call the API service.
// The AzureAd and DownstreamApis configuration sections are provided by the AppHost from the
// frontend's Entra ID app registration.
builder.Services.AddAuthentication(OpenIdConnectDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApp(builder.Configuration)
    .EnableTokenAcquisitionToCallDownstreamApi()
    .AddInMemoryTokenCaches();
builder.Services.AddCascadingAuthenticationState();
builder.Services.AddScoped<BlazorAuthenticationChallengeHandler>();

// Require an authenticated user by default. The fallback policy applies to every endpoint without its own
// authorization metadata, so all pages require sign-in unless they explicitly opt out with [AllowAnonymous].
var requireAuthenticatedUser = new AuthorizationPolicyBuilder()
    .RequireAuthenticatedUser()
    .Build();
builder.Services.AddAuthorizationBuilder()
    .SetDefaultPolicy(requireAuthenticatedUser)
    .SetFallbackPolicy(requireAuthenticatedUser);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

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

// Static assets (CSS, JS, images) don't need to be protected and are required to render pages
// such as the error page for signed-out users.
app.MapStaticAssets()
    .AllowAnonymous();

app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.MapGroup("/authentication").MapLoginAndLogout();

app.MapDefaultEndpoints();

app.Run();
