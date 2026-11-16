using System.Text.Json;
using System.Text.Json.Serialization;

namespace SupportDesk;

public sealed class BrandOptions
{
    public const string SectionName = "Brand";

    public string Name { get; set; } = "Contoso";
    public string LegalName { get; set; } = "Contoso, Ltd.";
    public string Domain { get; set; } = "contoso.com";
    public string Tagline { get; set; } = "Reliable energy for every home";
    public string SupportTeamName { get; set; } = "Contoso Care";
}

public enum ConversationStatus
{
    Waiting,
    Active,
    Closed
}

public enum MessageSender
{
    Customer,
    Agent,
    System
}

public sealed record ChatMessage(
    string Id,
    string ConversationId,
    MessageSender Sender,
    string SenderName,
    string Text,
    DateTimeOffset SentAt,
    string? ClientMessageId);

public sealed record ConversationSummary(
    string Id,
    string CustomerName,
    string Topic,
    ConversationStatus Status,
    string? AgentId,
    string? AgentName,
    DateTimeOffset CreatedAt,
    DateTimeOffset? AcceptedAt,
    DateTimeOffset? ClosedAt,
    int MessageCount,
    ChatMessage? LastMessage,
    bool CustomerOnline);

public sealed record ConversationDetail(ConversationSummary Conversation, IReadOnlyList<ChatMessage> Messages);

public sealed record StartConversationRequest(string? CustomerName, string? Topic, string? Message);

public sealed record StartConversationResponse(ConversationDetail Conversation, string CustomerKey);

public sealed record NegotiateResponse(string Url);

public sealed record AgentRequest(string? AgentId, string? AgentName);

// Payloads pushed to clients through Web PubSub. The "type" property tells the
// client how to interpret the rest of the message.
public sealed record ConversationUpdatedEvent(ConversationSummary Conversation)
{
    public string Type => "conversation";
}

public sealed record MessageEvent(string ConversationId, ChatMessage Message)
{
    public string Type => "message";
}

public sealed record TypingEvent(string ConversationId, MessageSender Sender, bool IsTyping)
{
    public string Type => "typing";
}

// Payloads clients send to the server as Web PubSub user events.
public sealed record ClientChatMessage(string? ConversationId, string? Text, string? ClientMessageId);

public sealed record ClientTyping(string? ConversationId, bool IsTyping);

public static class SupportJson
{
    public static readonly JsonSerializerOptions Options = Configure(new JsonSerializerOptions(JsonSerializerDefaults.Web));

    public static JsonSerializerOptions Configure(JsonSerializerOptions options)
    {
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        options.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        return options;
    }
}

public static class SupportLimits
{
    public const int MaxNameLength = 60;
    public const int MaxTopicLength = 60;
    public const int MaxMessageLength = 2000;
    public const int MaxClientIdLength = 64;
}
