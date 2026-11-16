using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace SupportDesk;

/// <summary>
/// Keeps conversations and transcripts in memory. Replace this with durable storage
/// (for example Azure Cosmos DB or PostgreSQL) for anything beyond a demo.
/// </summary>
public sealed class ConversationStore(TimeProvider timeProvider)
{
    private readonly ConcurrentDictionary<string, Conversation> _conversations = new(StringComparer.Ordinal);

    public ConversationStore() : this(TimeProvider.System)
    {
    }

    public (Conversation Conversation, ChatMessage? FirstMessage) Start(string customerName, string topic, string? message)
    {
        var conversation = new Conversation(
            Id: Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(8)),
            CustomerKey: Convert.ToBase64String(RandomNumberGenerator.GetBytes(24)),
            CustomerName: customerName,
            Topic: topic,
            CreatedAt: timeProvider.GetUtcNow());

        _conversations[conversation.Id] = conversation;

        ChatMessage? first = null;
        if (!string.IsNullOrWhiteSpace(message))
        {
            first = conversation.Append(MessageSender.Customer, customerName, message, clientMessageId: null, timeProvider.GetUtcNow());
        }

        return (conversation, first);
    }

    public Conversation? Find(string id) => _conversations.TryGetValue(id, out var conversation) ? conversation : null;

    public Conversation? FindForCustomer(string id, string? customerKey)
    {
        var conversation = Find(id);
        if (conversation is null || string.IsNullOrEmpty(customerKey))
        {
            return null;
        }

        var expected = System.Text.Encoding.UTF8.GetBytes(conversation.CustomerKey);
        var actual = System.Text.Encoding.UTF8.GetBytes(customerKey);
        return CryptographicOperations.FixedTimeEquals(expected, actual) ? conversation : null;
    }

    public IReadOnlyList<ConversationSummary> List() =>
        _conversations.Values
            .Select(c => c.ToSummary())
            .OrderBy(c => c.Status)
            .ThenByDescending(c => c.LastMessage?.SentAt ?? c.CreatedAt)
            .ToList();

    public IEnumerable<Conversation> ActiveForAgent(string agentId) =>
        _conversations.Values.Where(c => c.IsActiveFor(agentId));

    public DateTimeOffset Now => timeProvider.GetUtcNow();
}

public sealed class Conversation(string Id, string CustomerKey, string CustomerName, string Topic, DateTimeOffset CreatedAt)
{
    private readonly Lock _gate = new();
    private readonly List<ChatMessage> _messages = [];
    private int _customerConnections;

    public string Id { get; } = Id;
    public string CustomerKey { get; } = CustomerKey;
    public string CustomerName { get; } = CustomerName;
    public string Topic { get; } = Topic;
    public DateTimeOffset CreatedAt { get; } = CreatedAt;
    public ConversationStatus Status { get; private set; } = ConversationStatus.Waiting;
    public string? AgentId { get; private set; }
    public string? AgentName { get; private set; }
    public DateTimeOffset? AcceptedAt { get; private set; }
    public DateTimeOffset? ClosedAt { get; private set; }

    public bool IsActiveFor(string agentId)
    {
        lock (_gate)
        {
            return Status == ConversationStatus.Active && AgentId == agentId;
        }
    }

    public ChatMessage Append(MessageSender sender, string senderName, string text, string? clientMessageId, DateTimeOffset now)
    {
        lock (_gate)
        {
            // Retries from a reconnecting client reuse their client message id; don't store them twice.
            if (clientMessageId is not null && _messages.FirstOrDefault(m => m.ClientMessageId == clientMessageId && m.Sender == sender) is { } existing)
            {
                return existing;
            }

            var message = new ChatMessage(Guid.NewGuid().ToString("N"), Id, sender, senderName, text, now, clientMessageId);
            _messages.Add(message);
            return message;
        }
    }

    public bool TryAccept(string agentId, string agentName, DateTimeOffset now)
    {
        lock (_gate)
        {
            if (Status != ConversationStatus.Waiting)
            {
                return Status == ConversationStatus.Active && AgentId == agentId;
            }

            Status = ConversationStatus.Active;
            AgentId = agentId;
            AgentName = agentName;
            AcceptedAt = now;
            return true;
        }
    }

    public bool TryClose(DateTimeOffset now)
    {
        lock (_gate)
        {
            if (Status == ConversationStatus.Closed)
            {
                return false;
            }

            Status = ConversationStatus.Closed;
            ClosedAt = now;
            return true;
        }
    }

    public bool CustomerConnected()
    {
        lock (_gate)
        {
            return ++_customerConnections == 1;
        }
    }

    public bool CustomerDisconnected()
    {
        lock (_gate)
        {
            _customerConnections = Math.Max(0, _customerConnections - 1);
            return _customerConnections == 0;
        }
    }

    public ConversationSummary ToSummary()
    {
        lock (_gate)
        {
            return new ConversationSummary(
                Id, CustomerName, Topic, Status, AgentId, AgentName, CreatedAt, AcceptedAt, ClosedAt,
                _messages.Count, _messages.LastOrDefault(), _customerConnections > 0);
        }
    }

    public ConversationDetail ToDetail()
    {
        lock (_gate)
        {
            return new ConversationDetail(ToSummary(), _messages.ToArray());
        }
    }
}
