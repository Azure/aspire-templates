using DroneDelivery.CustomerSimulator;
using DroneDelivery.Domain;

var builder = Host.CreateApplicationBuilder(args);

builder.AddAzureEventHubProducerClient(Hubs.Orders);
builder.Services.AddSingleton(DemandOptions.FromConfiguration(builder.Configuration));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHostedService<CustomerDemandSimulator>();

builder.Build().Run();
