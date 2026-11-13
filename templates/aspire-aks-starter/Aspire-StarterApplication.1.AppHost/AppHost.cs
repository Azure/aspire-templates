#pragma warning disable ASPIREAZURE003 // Azure subnet APIs are experimental.

var builder = DistributedApplication.CreateBuilder(args);

#if UseRedisCache
var cache = builder.AddAzureManagedRedis("cache")
    .RunAsContainer();

#endif
var apiService = builder.AddDotnetProject("apiservice", "../Aspire-StarterApplication.1.ApiService/Aspire-StarterApplication.1.ApiService.csproj")
    .WithHttpHealthCheck("/health");

var webfrontend = builder.AddDotnetProject("webfrontend", "../Aspire-StarterApplication.1.Web/Aspire-StarterApplication.1.Web.csproj")
    .WithExternalHttpEndpoints()
    .WithHttpHealthCheck("/health")
#if UseRedisCache
    .WithReference(cache)
    .WaitFor(cache)
#endif
    .WithReference(apiService)
    .WaitFor(apiService);

var vnet = builder.AddAzureVirtualNetwork("vnet", "10.100.0.0/16");
var aksSubnet = vnet.AddSubnet("aks-nodes", "10.100.0.0/22");
var albSubnet = vnet.AddSubnet("alb-public", "10.100.4.0/24");

var nodeVmSize = builder.Configuration["Azure:AKS:VmSize"]
    ?? throw new InvalidOperationException("Azure:AKS:VmSize must specify an AKS node VM size.");
var aks = builder.AddAzureKubernetesEnvironment("aks")
    .WithSubnet(aksSubnet)
    .WithSystemNodePool(nodeVmSize);
aks.AddNodePool("workload", nodeVmSize, minCount: 1, maxCount: 3);

var publicLb = aks.AddLoadBalancer("public", albSubnet);

var acmeEmail = builder.AddParameter("acme-email");
var certManager = aks.AddCertManager("cert-manager");
var letsencrypt = certManager.AddIssuer("letsencrypt-prod")
    .WithLetsEncryptProduction(acmeEmail)
    .WithHttp01Solver();

aks.AddGateway("web")
    .WithLoadBalancer(publicLb)
    .WithRoute("/", webfrontend.GetEndpoint("http"))
    .WithTls(letsencrypt);

builder.Build().Run();
