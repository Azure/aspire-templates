using DroneDelivery.CustomerSimulator;
using DroneDelivery.Domain;

var builder = Host.CreateApplicationBuilder(args);
builder.AddServiceDefaults();

builder.AddAzureEventHubProducerClient(Hubs.Orders, settings => settings.DisableTracing = true);
builder.Services.AddSingleton(DemandOptions.FromConfiguration(builder.Configuration));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHostedService<CustomerDemandSimulator>();

builder.Build().Run();
