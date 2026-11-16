using Aspire.Hosting.Azure;

// Dashboard tags (an evaluation API in Aspire 17) let resources be filtered by kind and by customer/operator role.
#pragma warning disable ASPIRERESOURCETRAITS001

var builder = DistributedApplication.CreateBuilder(args);

// Event Hubs (the local emulator during development) carries orders, missions, telemetry and camera events.
var eventHubs = builder.AddAzureEventHubs("eventhubs").RunAsEmulator().WithTags("infrastructure");
var orders = eventHubs.AddHub("orders").WithTags("infrastructure");
var missions = eventHubs.AddHub("drone-missions").WithTags("infrastructure");
var telemetry = eventHubs.AddHub("drone-telemetry").WithTags("infrastructure");
var photos = eventHubs.AddHub("drone-photos").WithTags("infrastructure");

// Camera images go to blob storage (Azurite locally); only their names travel through Event Hubs.
var storage = builder.AddAzureStorage("storage").RunAsEmulator().WithTags("infrastructure");
var photoStore = storage.AddBlobContainer("drone-photo-store").WithTags("infrastructure");
var signalr = builder.AddAzureSignalR("signalr", AzureSignalRServiceMode.Serverless).RunAsEmulator().WithTags("infrastructure");

var droneSimulator = builder.AddDotnetProject("drone-simulator", "../DroneDelivery.DroneSimulator/DroneDelivery.DroneSimulator.csproj")
    .WithTags("simulators")
    .WithReference(missions).WithReference(telemetry).WithReference(photos).WithReference(photoStore)
    .WithEnvironment("FLEET_PICCOLO", "6")
    .WithEnvironment("FLEET_DOPPIO", "3")
    .WithEnvironment("FLEET_ABBONDANTE", "2")
    .WaitFor(eventHubs).WaitFor(photoStore);

var backend = builder.AddDotnetProject("backend", "../DroneDelivery.Server/DroneDelivery.Server.csproj")
    .WithTags("servers")
    .WithReference(orders).WithReference(missions).WithReference(telemetry).WithReference(photos).WithReference(photoStore)
    .WithReference(signalr).WaitFor(signalr)
    .WaitFor(eventHubs).WaitFor(photoStore).WaitFor(droneSimulator)
    .WithHttpHealthCheck("/health");

builder.AddDotnetProject("customer-simulator", "../DroneDelivery.CustomerSimulator/DroneDelivery.CustomerSimulator.csproj")
    .WithTags("simulators", "customer")
    .WithReference(orders)
    .WithEnvironment("CUSTOMERS_PEAK", "60")
    .WithEnvironment("DEMAND_CYCLE_MINUTES", "15")
    .WaitFor(backend);

var customerServer = builder.AddDotnetProject("customer-server", "../DroneDelivery.CustomerServer/DroneDelivery.CustomerServer.csproj")
    .WithTags("servers", "customer")
    .WithHttpEndpoint()
    .WithReference(backend)
    .WithEnvironment("BACKEND_HTTP", backend.GetEndpoint("http"))
    .WaitFor(backend)
    .WithHttpHealthCheck("/health")
    .WithExternalHttpEndpoints();

var operatorServer = builder.AddDotnetProject("operator-server", "../DroneDelivery.OperatorServer/DroneDelivery.OperatorServer.csproj")
    .WithTags("servers", "operator")
    .WithHttpEndpoint()
    .WithReference(backend)
    .WithEnvironment("BACKEND_HTTP", backend.GetEndpoint("http"))
    .WaitFor(backend)
    .WithHttpHealthCheck("/health")
    .WithExternalHttpEndpoints();

var customerSite = builder.AddViteApp("customer-site", "../customer-frontend")
    .WithTags("frontends", "customer")
    .WithReference(customerServer)
    .WithEnvironment("SERVER_HTTP", customerServer.GetEndpoint("http"))
    .WaitFor(customerServer);
var operatorSite = builder.AddViteApp("operator-site", "../operator-frontend")
    .WithTags("frontends", "operator")
    .WithReference(operatorServer)
    .WithEnvironment("SERVER_HTTP", operatorServer.GetEndpoint("http"))
    .WaitFor(operatorServer);

customerServer.PublishWithContainerFiles(customerSite, "wwwroot");
operatorServer.PublishWithContainerFiles(operatorSite, "wwwroot");

// Integrations add these visible child resources themselves; they don't inherit their parent's tags.
TagGenerated("eventhubs-storage", "infrastructure");
TagGenerated("storage-blobs", "infrastructure");
TagGenerated("customer-site-installer", "frontends", "customer");
TagGenerated("operator-site-installer", "frontends", "operator");

builder.Build().Run();

void TagGenerated(string name, params string[] tags)
{
    var resource = builder.Resources.Single(resource => resource.Name == name);
    builder.CreateResourceBuilder(resource).WithTags(tags);
}
