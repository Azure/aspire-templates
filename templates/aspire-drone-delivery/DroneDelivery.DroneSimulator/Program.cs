using DroneDelivery.DroneSimulator;
using DroneDelivery.Domain;

var builder = Host.CreateApplicationBuilder(args);
builder.AddServiceDefaults();

builder.AddAzureEventHubConsumerClient(Hubs.DroneMissions, settings => { settings.ConsumerGroup ??= "$Default"; settings.DisableTracing = true; });
builder.AddKeyedAzureEventHubProducerClient(Hubs.DroneTelemetry, settings => settings.DisableTracing = true);
builder.AddKeyedAzureEventHubProducerClient(Hubs.DronePhotos, settings => settings.DisableTracing = true);
builder.AddAzureBlobContainerClient(Hubs.PhotoContainer);

builder.Services.AddSingleton(FleetOptions.FromConfiguration(builder.Configuration));
builder.Services.AddSingleton<DroneCamera>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<DroneCamera>());
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHostedService<DroneFleetSimulator>();

builder.Build().Run();
