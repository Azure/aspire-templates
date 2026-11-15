using DroneDelivery.Domain;
using Microsoft.Azure.SignalR.Management;

namespace DroneDelivery.Server;

public static class RealtimeEndpoints
{
    public static void MapRealtimeEndpoints(this WebApplication app)
    {
        app.MapPost("/realtime/customer/negotiate", async (
            string? orderId, Dispatcher dispatcher, CustomerSubscriptions subscriptions,
            RealtimeContexts hubs, HttpResponse response, CancellationToken cancellationToken) =>
        {
            response.Headers.CacheControl = "no-store";
            if (!CustomerSubscriptions.IsValidOrderId(orderId))
                return Results.BadRequest(new { error = "A valid ForthCoffee order ID is required." });
            if (dispatcher.Order(orderId!) is null)
                return Results.NotFound();
            if (!subscriptions.TrySubscribe(orderId!))
                return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            var negotiation = await hubs.Customers.NegotiateAsync(new NegotiationOptions
            {
                UserId = orderId,
                TokenLifetime = CustomerSubscriptions.Lease,
                CloseOnAuthenticationExpiration = true,
            }, cancellationToken);
            return Results.Json(negotiation, RealtimeContexts.NegotiationJson);
        });
        app.MapPost("/realtime/operator/negotiate", async (
            RealtimeContexts hubs, HttpResponse response, CancellationToken cancellationToken) =>
        {
            response.Headers.CacheControl = "no-store";
            var negotiation = await hubs.Operators.NegotiateAsync(new NegotiationOptions(), cancellationToken);
            return Results.Json(negotiation, RealtimeContexts.NegotiationJson);
        });
    }
}
