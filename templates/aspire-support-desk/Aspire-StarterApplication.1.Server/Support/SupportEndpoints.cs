using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace SupportDesk;

public static partial class SupportEndpoints
{
    private const string CustomerKeyHeader = "X-Customer-Key";

    public static RouteGroupBuilder MapBrandEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("brand", (IOptions<BrandOptions> brand) => brand.Value).WithName("GetBrand");
        return api;
    }

    public static RouteGroupBuilder MapCustomerEndpoints(this RouteGroupBuilder api)
    {
        var customer = api.MapGroup("conversations");

        customer.MapPost("", async (StartConversationRequest request, ConversationStore store, SupportNotifier notifier) =>
        {
            var name = Clean(request.CustomerName, SupportLimits.MaxNameLength);
            var topic = Clean(request.Topic, SupportLimits.MaxTopicLength) ?? "General question";
            var message = Clean(request.Message, SupportLimits.MaxMessageLength);
            if (name is null)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["customerName"] = ["Please tell us your name."] });
            }

            var (conversation, _) = store.Start(name, topic, message);
            await notifier.PublishConversationAsync(conversation);
            return Results.Ok(new StartConversationResponse(conversation.ToDetail(), conversation.CustomerKey));
        }).WithName("StartConversation");

        customer.MapGet("{id}", (string id, HttpRequest http, ConversationStore store) =>
            store.FindForCustomer(id, http.Headers[CustomerKeyHeader]) is { } conversation
                ? Results.Ok(conversation.ToDetail())
                : Results.NotFound()).WithName("GetCustomerConversation");

        customer.MapPost("{id}/negotiate", async (string id, HttpRequest http, ConversationStore store, SupportNotifier notifier, CancellationToken ct) =>
        {
            if (store.FindForCustomer(id, http.Headers[CustomerKeyHeader]) is not { } conversation)
            {
                return Results.NotFound();
            }

            var url = await notifier.GetCustomerUrlAsync(conversation, ct);
            return Results.Ok(new NegotiateResponse(url.AbsoluteUri));
        }).WithName("NegotiateCustomer");

        customer.MapPost("{id}/close", async (string id, HttpRequest http, ConversationStore store, SupportNotifier notifier) =>
        {
            if (store.FindForCustomer(id, http.Headers[CustomerKeyHeader]) is not { } conversation)
            {
                return Results.NotFound();
            }

            await CloseAsync(conversation, $"{conversation.CustomerName} ended the chat.", store, notifier);
            return Results.Ok(conversation.ToDetail());
        }).WithName("CloseCustomerConversation");

        return api;
    }

    // The agent console is unauthenticated to keep the sample focused. Protect these
    // endpoints with your identity provider before exposing them to real users.
    public static RouteGroupBuilder MapAgentEndpoints(this RouteGroupBuilder api)
    {
        var agent = api.MapGroup("agent");

        agent.MapPost("negotiate", async (AgentRequest request, ConversationStore store, SupportNotifier notifier, CancellationToken ct) =>
        {
            if (!TryGetAgent(request, out var agentId, out _))
            {
                return Results.BadRequest();
            }

            var url = await notifier.GetAgentUrlAsync(agentId, store.ActiveForAgent(agentId), ct);
            return Results.Ok(new NegotiateResponse(url.AbsoluteUri));
        }).WithName("NegotiateAgent");

        agent.MapGet("conversations", (ConversationStore store) => store.List()).WithName("ListConversations");

        agent.MapGet("conversations/{id}", (string id, ConversationStore store) =>
            store.Find(id) is { } conversation ? Results.Ok(conversation.ToDetail()) : Results.NotFound())
            .WithName("GetConversation");

        agent.MapPost("conversations/{id}/accept", async (string id, AgentRequest request, ConversationStore store, SupportNotifier notifier) =>
        {
            if (!TryGetAgent(request, out var agentId, out var agentName))
            {
                return Results.BadRequest();
            }

            if (store.Find(id) is not { } conversation)
            {
                return Results.NotFound();
            }

            if (!conversation.TryAccept(agentId, agentName, store.Now))
            {
                return Results.Conflict(new { error = "This conversation has already been picked up." });
            }

            await notifier.AddAgentToConversationAsync(agentId, conversation.Id);
            var joined = conversation.Append(MessageSender.System, "System", $"{agentName} joined the chat.", null, store.Now);
            await notifier.PublishMessageAsync(joined);
            await notifier.PublishConversationAsync(conversation);
            return Results.Ok(conversation.ToDetail());
        }).WithName("AcceptConversation");

        agent.MapPost("conversations/{id}/close", async (string id, AgentRequest request, ConversationStore store, SupportNotifier notifier) =>
        {
            if (!TryGetAgent(request, out var agentId, out var agentName))
            {
                return Results.BadRequest();
            }

            if (store.Find(id) is not { } conversation)
            {
                return Results.NotFound();
            }

            if (conversation.AgentId != agentId)
            {
                return Results.Conflict(new { error = "Only the assigned agent can close this conversation." });
            }

            await CloseAsync(conversation, $"{agentName} closed the chat.", store, notifier);
            return Results.Ok(conversation.ToDetail());
        }).WithName("CloseConversation");

        return api;
    }

    private static async Task CloseAsync(Conversation conversation, string reason, ConversationStore store, SupportNotifier notifier)
    {
        if (conversation.TryClose(store.Now))
        {
            var closed = conversation.Append(MessageSender.System, "System", reason, null, store.Now);
            await notifier.PublishMessageAsync(closed);
            await notifier.PublishConversationAsync(conversation);
        }
    }

    private static bool TryGetAgent(AgentRequest request, out string agentId, out string agentName)
    {
        agentId = request.AgentId ?? "";
        agentName = Clean(request.AgentName, SupportLimits.MaxNameLength) ?? "Support agent";
        return AgentIdPattern().IsMatch(agentId);
    }

    internal static string? Clean(string? value, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        return trimmed.Length > maxLength ? trimmed[..maxLength] : trimmed;
    }

    [GeneratedRegex("^[A-Za-z0-9-]{8,64}$")]
    private static partial Regex AgentIdPattern();
}
