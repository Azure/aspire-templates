using System.Text.Json;

namespace SupportDesk;

/// <summary>
/// Receives Web PubSub upstream events (CloudEvents over HTTP). Clients raise
/// "message" and "typing" user events; the server validates that the sender
/// belongs to the conversation before broadcasting to its group.
/// </summary>
public static class WebPubSubEventHandler
{
    public static IEndpointConventionBuilder MapWebPubSubEventHandler(this IEndpointRouteBuilder app, string pattern) =>
        app.Map(pattern, HandleAsync).ExcludeFromDescription();

    private static async Task<IResult> HandleAsync(HttpContext context, ConversationStore store, SupportNotifier notifier, ILogger<Conversation> logger)
    {
        var request = context.Request;

        // Abuse protection handshake: https://learn.microsoft.com/azure/azure-web-pubsub/howto-develop-eventhandler
        if (HttpMethods.IsOptions(request.Method))
        {
            context.Response.Headers["WebHook-Allowed-Origin"] = "*";
            return Results.Ok();
        }

        if (!HttpMethods.IsPost(request.Method) || request.Headers["ce-type"].ToString() is not { Length: > 0 } eventType)
        {
            return Results.BadRequest();
        }

        // Production deployments should also validate the ce-signature header against the service access key.
        var userId = request.Headers["ce-userId"].ToString();

        switch (eventType)
        {
            case "azure.webpubsub.sys.connected":
            case "azure.webpubsub.sys.disconnected":
                await OnPresenceAsync(userId, connected: eventType.EndsWith(".connected", StringComparison.Ordinal), store, notifier);
                return Results.Ok();

            // User events arrive as azure.webpubsub.user.<eventName>.
            case var _ when eventType.StartsWith("azure.webpubsub.user.", StringComparison.Ordinal):
                return await OnUserEventAsync(request, userId, store, notifier, logger);

            default:
                return Results.Ok();
        }
    }

    private static async Task OnPresenceAsync(string userId, bool connected, ConversationStore store, SupportNotifier notifier)
    {
        if (!userId.StartsWith("customer-", StringComparison.Ordinal) ||
            store.Find(userId["customer-".Length..]) is not { } conversation)
        {
            return;
        }

        var changed = connected ? conversation.CustomerConnected() : conversation.CustomerDisconnected();
        if (changed && conversation.Status != ConversationStatus.Closed)
        {
            await notifier.PublishConversationAsync(conversation);
        }
    }

    private static async Task<IResult> OnUserEventAsync(HttpRequest request, string userId, ConversationStore store, SupportNotifier notifier, ILogger logger)
    {
        var eventName = request.Headers["ce-eventName"].ToString();
        try
        {
            switch (eventName)
            {
                case "message":
                    var chat = await request.ReadFromJsonAsync<ClientChatMessage>(SupportJson.Options);
                    return await OnChatMessageAsync(chat, userId, store, notifier);

                case "typing":
                    var typing = await request.ReadFromJsonAsync<ClientTyping>(SupportJson.Options);
                    if (typing?.ConversationId is { } id && Authorize(store, id, userId) is { } typingContext)
                    {
                        await notifier.PublishTypingAsync(id, typingContext.Sender, typing.IsTyping);
                    }

                    return Results.Ok();

                default:
                    return Results.BadRequest();
            }
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "Rejected malformed {EventName} event from {UserId}.", eventName, userId);
            return Results.BadRequest();
        }
    }

    private static async Task<IResult> OnChatMessageAsync(ClientChatMessage? chat, string userId, ConversationStore store, SupportNotifier notifier)
    {
        var text = SupportEndpoints.Clean(chat?.Text, SupportLimits.MaxMessageLength);
        var clientMessageId = SupportEndpoints.Clean(chat?.ClientMessageId, SupportLimits.MaxClientIdLength);
        if (chat?.ConversationId is not { } id || text is null)
        {
            return Results.BadRequest();
        }

        if (Authorize(store, id, userId) is not { } context)
        {
            return Results.StatusCode(StatusCodes.Status403Forbidden);
        }

        var message = context.Conversation.Append(context.Sender, context.SenderName, text, clientMessageId, store.Now);
        await notifier.PublishMessageAsync(message);
        await notifier.PublishConversationAsync(context.Conversation);
        return Results.Ok();
    }

    private static SenderContext? Authorize(ConversationStore store, string conversationId, string userId)
    {
        if (store.Find(conversationId) is not { Status: not ConversationStatus.Closed } conversation)
        {
            return null;
        }

        if (userId == SupportNotifier.CustomerUserId(conversation.Id))
        {
            return new(conversation, MessageSender.Customer, conversation.CustomerName);
        }

        if (conversation.AgentId is { } agentId && userId == SupportNotifier.AgentUserId(agentId))
        {
            return new(conversation, MessageSender.Agent, conversation.AgentName ?? "Support agent");
        }

        return null;
    }

    private sealed record SenderContext(Conversation Conversation, MessageSender Sender, string SenderName);
}
