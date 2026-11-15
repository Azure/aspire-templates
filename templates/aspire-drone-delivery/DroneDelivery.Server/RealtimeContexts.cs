using System.Text.Json;
using System.Text.Json.Serialization;
using Azure.Core.Serialization;
using DroneDelivery.Domain;
using Microsoft.Azure.SignalR.Management;

namespace DroneDelivery.Server;

public sealed class RealtimeContexts(ServiceManager manager, ILogger<RealtimeContexts> logger) : IHostedService
{
    public static readonly JsonSerializerOptions NegotiationJson = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public ServiceHubContext Customers { get; private set; } = null!;
    public ServiceHubContext Operators { get; private set; } = null!;

    public static ServiceManager CreateManager(string connectionString, ILoggerFactory loggerFactory) =>
        new ServiceManagerBuilder()
            .WithLoggerFactory(loggerFactory)
            .WithOptions(options =>
            {
                options.ConnectionString = connectionString;
                options.ServiceTransportType = ServiceTransportType.Transient;
                options.UseJsonObjectSerializer(new JsonObjectSerializer(EventSerializer.Options));
            })
            .BuildServiceManager();

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            Customers = await manager.CreateHubContextAsync("customers", cancellationToken);
            Operators = await manager.CreateHubContextAsync("operators", cancellationToken);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Could not initialize managed realtime hubs");
            if (Customers is not null)
                await Customers.DisposeAsync();
            throw;
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        try
        {
            await Operators.DisposeAsync();
        }
        finally
        {
            await Customers.DisposeAsync();
        }
    }
}
