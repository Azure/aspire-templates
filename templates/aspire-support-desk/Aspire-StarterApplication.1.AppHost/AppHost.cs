var builder = DistributedApplication.CreateBuilder(args);

builder.AddAzureContainerAppEnvironment("env");

// Azure Web PubSub carries real-time traffic between customers and agents.
// Locally it runs as the Web PubSub emulator container; when published it
// provisions an Azure Web PubSub service.
var webPubSub = builder.AddAzureWebPubSub("webpubsub")
    .RunAsEmulator();

var supportHub = webPubSub.AddHub("support");

var server = builder.AddDotnetProject("server", "../Aspire-StarterApplication.1.Server/Aspire-StarterApplication.1.Server.csproj")
    .WithReference(supportHub)
    .WaitFor(webPubSub)
    .WithHttpHealthCheck("/health")
    .WithExternalHttpEndpoints();

// Chat messages, typing indicators and connect/disconnect notifications are
// delivered to the server's event handler, which validates and routes them.
var serverEndpoint = server.GetEndpoint("http");
supportHub.AddEventHandler(
    $"{serverEndpoint}/eventhandler",
    userEventPattern: "*",
    systemEvents: ["connected", "disconnected"]);

var publicSite = builder.AddViteApp("publicsite", "../public-site")
    .WithReference(server)
    .WaitFor(server);

var agentConsole = builder.AddViteApp("agentconsole", "../agent-console")
    .WithReference(server)
    .WaitFor(server);

server.PublishWithContainerFiles(publicSite, "wwwroot");
server.PublishWithContainerFiles(agentConsole, "wwwroot/agent");

builder.Build().Run();
