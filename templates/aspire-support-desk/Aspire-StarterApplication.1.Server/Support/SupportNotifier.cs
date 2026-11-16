using System.Text.Json;
using Azure.Core;
using Azure.Messaging.WebPubSub;

namespace SupportDesk;

/// <summary>
/// Wraps the Web PubSub service client: issues client access URLs and pushes
/// events to the agents group and to individual conversation groups.
/// </summary>
public sealed class SupportNotifier(WebPubSubServiceClient client)
{
    public const string AgentsGroup = "agents";

    private static readonly TimeSpan TokenLifetime = TimeSpan.FromHours(1);

    public static string ConversationGroup(string conversationId) => $"conversation-{conversationId}";

    public static string CustomerUserId(string conversationId) => $"customer-{conversationId}";

    public static string AgentUserId(string agentId) => $"agent-{agentId}";

    // Customers get no client roles: they can only receive messages for the single
    // conversation group baked into their token and raise events to the server.
    public async Task<Uri> GetCustomerUrlAsync(Conversation conversation, CancellationToken cancellationToken) =>
        await client.GetClientAccessUriAsync(
            expiresAfter: TokenLifetime,
            userId: CustomerUserId(conversation.Id),
            roles: [],
            groups: [ConversationGroup(conversation.Id)],
            cancellationToken: cancellationToken);

    public async Task<Uri> GetAgentUrlAsync(string agentId, IEnumerable<Conversation> activeConversations, CancellationToken cancellationToken) =>
        await client.GetClientAccessUriAsync(
            expiresAfter: TokenLifetime,
            userId: AgentUserId(agentId),
            roles: [],
            groups: [AgentsGroup, .. activeConversations.Select(c => ConversationGroup(c.Id))],
            cancellationToken: cancellationToken);

    public Task AddAgentToConversationAsync(string agentId, string conversationId) =>
        client.AddUserToGroupAsync(ConversationGroup(conversationId), AgentUserId(agentId));

    public Task PublishConversationAsync(Conversation conversation)
    {
        var payload = new ConversationUpdatedEvent(conversation.ToSummary());
        return Task.WhenAll(
            SendToGroupAsync(AgentsGroup, payload),
            SendToGroupAsync(ConversationGroup(conversation.Id), payload));
    }

    public Task PublishMessageAsync(ChatMessage message) =>
        SendToGroupAsync(ConversationGroup(message.ConversationId), new MessageEvent(message.ConversationId, message));

    public Task PublishTypingAsync(string conversationId, MessageSender sender, bool isTyping) =>
        SendToGroupAsync(ConversationGroup(conversationId), new TypingEvent(conversationId, sender, isTyping));

    private Task SendToGroupAsync<T>(string group, T payload) =>
        client.SendToGroupAsync(group, JsonSerializer.Serialize(payload, SupportJson.Options), ContentType.ApplicationJson);
}
