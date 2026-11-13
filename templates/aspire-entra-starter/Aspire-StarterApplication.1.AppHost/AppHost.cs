var builder = DistributedApplication.CreateBuilder(args);

builder.AddAzureContainerAppEnvironment("env");

#if UseRedisCache
var cache = builder.AddAzureManagedRedis("cache")
    .RunAsContainer();

#endif
// Entra ID app registration for the API. It exposes the "access_as_user" delegated scope.
var apiEntra = builder.AddEntraIdApplication("apiservice-entra")
    .WithScope("access_as_user", "Access the weather API on behalf of the signed-in user");

var apiService = builder.AddDotnetProject("apiservice", "../Aspire-StarterApplication.1.ApiService/Aspire-StarterApplication.1.ApiService.csproj")
    .WithHttpHealthCheck("/health")
    .WithReference(apiEntra);

// Entra ID app registration for the web frontend. It signs users in and calls the API on their behalf.
// Locally it authenticates with a short-lived developer certificate; when deployed it uses a managed identity.
var webEntra = builder.AddEntraIdApplication("webfrontend-entra")
    .WithApiPermissions(apiEntra, "access_as_user")
    .RunWithLocalDeveloperCertificateCredential()
    .PublishWithFederatedManagedIdentityCredential();

var webFrontend = builder.AddDotnetProject("webfrontend", "../Aspire-StarterApplication.1.Web/Aspire-StarterApplication.1.Web.csproj")
    .WithExternalHttpEndpoints()
    .WithHttpHealthCheck("/health")
#if UseRedisCache
    .WithReference(cache)
    .WaitFor(cache)
#endif
    .WithReference(webEntra)
    .WithReference(apiService)
    .WaitFor(apiService);

// The redirect URIs follow the web frontend's endpoint: its local https address when running, the deployed host when published.
webEntra.WithRedirectUris(webFrontend.GetEndpoint("https"), "/signin-oidc", "/signout-callback-oidc");

builder.Build().Run();
