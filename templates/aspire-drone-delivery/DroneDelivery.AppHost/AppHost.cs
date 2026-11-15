using Aspire.Hosting.Azure;

var builder = DistributedApplication.CreateBuilder(args);

// Event Hubs (the local emulator during development) carries orders, missions, telemetry and camera events.
var eventHubs = builder.AddAzureEventHubs("eventhubs").RunAsEmulator();
var orders = eventHubs.AddHub("orders");
var missions = eventHubs.AddHub("drone-missions");
var telemetry = eventHubs.AddHub("drone-telemetry");
var photos = eventHubs.AddHub("drone-photos");

// Camera images go to blob storage (Azurite locally); only their names travel through Event Hubs.
var storage = builder.AddAzureStorage("storage").RunAsEmulator();
var photoStore = storage.AddBlobContainer("drone-photo-store");
var signalr = builder.AddAzureSignalR("signalr", AzureSignalRServiceMode.Serverless).RunAsEmulator();

var droneSimulator = builder.AddDotnetProject("drone-simulator", "../DroneDelivery.DroneSimulator/DroneDelivery.DroneSimulator.csproj")
    .WithReference(missions).WithReference(telemetry).WithReference(photos).WithReference(photoStore)
    .WithEnvironment("FLEET_PICCOLO", "6")
    .WithEnvironment("FLEET_DOPPIO", "3")
    .WithEnvironment("FLEET_ABBONDANTE", "2")
    .WaitFor(eventHubs).WaitFor(photoStore);

var backend = builder.AddDotnetProject("backend", "../DroneDelivery.Server/DroneDelivery.Server.csproj")
    .WithReference(orders).WithReference(missions).WithReference(telemetry).WithReference(photos).WithReference(photoStore)
    .WithReference(signalr).WaitFor(signalr)
    .WaitFor(eventHubs).WaitFor(photoStore).WaitFor(droneSimulator)
    .WithHttpHealthCheck("/health");

builder.AddDotnetProject("customer-simulator", "../DroneDelivery.CustomerSimulator/DroneDelivery.CustomerSimulator.csproj")
    .WithReference(orders)
    .WithEnvironment("CUSTOMERS_PEAK", "60")
    .WithEnvironment("DEMAND_CYCLE_MINUTES", "15")
    .WaitFor(backend);

var customerServer = builder.AddDotnetProject("customer-server", "../DroneDelivery.CustomerServer/DroneDelivery.CustomerServer.csproj")
    .WithHttpEndpoint()
    .WithReference(backend)
    .WithEnvironment("BACKEND_HTTP", backend.GetEndpoint("http"))
    .WaitFor(backend)
    .WithHttpHealthCheck("/health")
    .WithExternalHttpEndpoints();

var operatorServer = builder.AddDotnetProject("operator-server", "../DroneDelivery.OperatorServer/DroneDelivery.OperatorServer.csproj")
    .WithHttpEndpoint()
    .WithReference(backend)
    .WithEnvironment("BACKEND_HTTP", backend.GetEndpoint("http"))
    .WaitFor(backend)
    .WithHttpHealthCheck("/health")
    .WithExternalHttpEndpoints();

var customerSite = builder.AddViteApp("customer-site", "../customer-frontend")
    .WithReference(customerServer)
    .WithEnvironment("SERVER_HTTP", customerServer.GetEndpoint("http"))
    .WaitFor(customerServer);
var operatorSite = builder.AddViteApp("operator-site", "../operator-frontend")
    .WithReference(operatorServer)
    .WithEnvironment("SERVER_HTTP", operatorServer.GetEndpoint("http"))
    .WaitFor(operatorServer);

customerServer.PublishWithContainerFiles(customerSite, "wwwroot");
operatorServer.PublishWithContainerFiles(operatorSite, "wwwroot");

builder.Build().Run();
