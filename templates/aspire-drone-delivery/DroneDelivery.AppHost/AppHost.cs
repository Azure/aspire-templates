var builder = DistributedApplication.CreateBuilder(args);

var server = builder.AddDotnetProject("server", "../DroneDelivery.Server/DroneDelivery.Server.csproj")
    .WithHttpHealthCheck("/health")
    .WithExternalHttpEndpoints();

var frontend = builder.AddViteApp("frontend", "../frontend")
    .WithReference(server)
    .WaitFor(server);

server.PublishWithContainerFiles(frontend, "wwwroot");

builder.Build().Run();
