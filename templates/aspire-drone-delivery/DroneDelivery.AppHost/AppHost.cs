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

var droneSimulator = builder.AddDotnetProject("drone-simulator", "../DroneDelivery.DroneSimulator/DroneDelivery.DroneSimulator.csproj")
    .WithReference(missions).WithReference(telemetry).WithReference(photos).WithReference(photoStore)
    .WithEnvironment("FLEET_PICCOLO", "6")
    .WithEnvironment("FLEET_DOPPIO", "3")
    .WithEnvironment("FLEET_ABBONDANTE", "2")
    .WaitFor(eventHubs).WaitFor(photoStore);

var server = builder.AddDotnetProject("server", "../DroneDelivery.Server/DroneDelivery.Server.csproj")
    .WithReference(orders).WithReference(missions).WithReference(telemetry).WithReference(photos).WithReference(photoStore)
    .WaitFor(eventHubs).WaitFor(photoStore).WaitFor(droneSimulator)
    .WithHttpHealthCheck("/health")
    .WithExternalHttpEndpoints();

builder.AddDotnetProject("customer-simulator", "../DroneDelivery.CustomerSimulator/DroneDelivery.CustomerSimulator.csproj")
    .WithReference(orders)
    .WithEnvironment("CUSTOMERS_PEAK", "60")
    .WithEnvironment("DEMAND_CYCLE_MINUTES", "15")
    .WaitFor(server);

var frontend = builder.AddViteApp("frontend", "../frontend")
    .WithReference(server)
    .WaitFor(server);

server.PublishWithContainerFiles(frontend, "wwwroot");

builder.Build().Run();
