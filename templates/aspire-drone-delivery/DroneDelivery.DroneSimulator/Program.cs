using DroneDelivery.DroneSimulator;
using DroneDelivery.Domain;

var builder = Host.CreateApplicationBuilder(args);

builder.AddAzureEventHubConsumerClient(Hubs.DroneMissions, settings => settings.ConsumerGroup ??= "$Default");
builder.AddKeyedAzureEventHubProducerClient(Hubs.DroneTelemetry);
builder.AddKeyedAzureEventHubProducerClient(Hubs.DronePhotos);
builder.AddAzureBlobContainerClient(Hubs.PhotoContainer);

builder.Services.AddSingleton(FleetOptions.FromConfiguration(builder.Configuration));
builder.Services.AddSingleton<DroneCamera>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHostedService<DroneFleetSimulator>();

builder.Build().Run();
