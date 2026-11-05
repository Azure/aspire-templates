# aspire-templates
Azure-focused templates for Aspire.

## Azure starter

`templates/aspire-azure-starter` adapts the canonical
[`microsoft/aspire-templates` starter](https://github.com/microsoft/aspire-templates/tree/e9690bd925a2bf161044a05216ff0642b718b612/templates/aspire-starter).
It keeps the Blazor frontend, weather API, service defaults, health checks,
service discovery, output caching, and optional integration-test project.
The AppHost targets **Azure Container Apps** and optionally uses **Azure Managed Redis**.
There is no frontend sign-in or application registration.

### Create an application

Requires the .NET 10 SDK (or .NET 11 preview for `--framework net11.0`) and the
Aspire CLI with repository-template support:

```bash
aspire new \
  --template-repository https://github.com/Azure/aspire-templates \
  --template-path templates/aspire-azure-starter \
  --name MyAzureApp --output ./MyAzureApp --use-config-source false
```

From a local clone, use `--template-path ./templates/aspire-azure-starter` instead
of `--template-repository`. Alternatively, install and generate using the .NET CLI:

```bash
dotnet new install ./templates/aspire-azure-starter
dotnet new aspire-azure-starter -n MyAzureApp --use-redis-cache --test-framework xUnit.net
```

The upstream options remain available: `--use-redis-cache`, `--test-framework`
(`None`, `MSTest`, `NUnit`, `xUnit.net`), `--xunit-version` (`v2`, `v3`, `v3mtp`),
`--framework` (`net10.0`, `net11.0`), `--no-https`, `--localhost-tld`, and custom
launch ports. Redis caching remains **off by default**, matching upstream; without
it, the frontend uses in-process output caching.

Native Aspire host metadata resolves explicit package versions. The hosting
and Redis client packages use 13.6.4; the upstream `AddDotnetProject` integration
uses the corresponding `13.6.4-preview.1.26523.11` package. Version parameters
also have defaults for direct `dotnet new` use. No central build/package files
are required. The AppHost explicitly imports `Aspire.AppHost.Sdk` so generated
integration tests can resolve the CLI bundle's orchestration dependencies.

### Local runs and Redis

```bash
cd MyAzureApp
aspire start
```

Without Redis enabled, app services run locally and the Container Apps environment
is a deployment target, not a local Azure deployment.

**With Redis enabled, local runs use a Redis container**, through
`AddAzureManagedRedis("cache").RunAsContainer()`. Start a supported container
runtime before running the application. No Azure credentials, subscription,
resource group, or Azure provisioning are required for local development.
Publication and deployment still model Azure Managed Redis, not a Redis container.

The frontend references `cache`, waits for it, and uses
`AddRedisClientBuilder("cache").WithAzureAuthentication().WithOutputCache()`.
`WithAzureAuthentication()` applies Azure token authentication only to Azure Redis
endpoints; the local container uses the Aspire-provided connection configuration
without requesting Azure credentials. In Azure, the client uses the frontend's
managed identity and Aspire-generated Redis access policy. This is service-to-service
authentication only, not interactive user authentication in the website.
To reuse an existing Azure Redis instance instead, remove `RunAsContainer()` and
customize the AppHost with the supported `AsExisting` API, arranging appropriate
data access separately.

Integration tests start the AppHost too. Tests generated **with Redis enabled**
therefore require a supported container runtime, but do not require Azure access
or provision Azure resources.

### Azure Container Apps artifacts

From the generated application:

```bash
aspire publish --output-path ./artifacts --non-interactive
```

Publication generates infrastructure artifacts; it does not deploy them.
The model publishes the frontend with external ingress, the API with internal
ingress, their service-discovery connection, and, when selected, Azure Managed
Redis with passwordless access for the frontend. The environment also models
the registry, logging, and Aspire dashboard infrastructure.

Deployment is a separate, explicitly authorized operation using `aspire deploy`.
It requires Azure credentials, subscription, resource group and location settings,
and creates billable resources. Never treat a successful build or publish as
verification of a live deployment.

## Attribution

The starter was copied from `microsoft/aspire-templates` at commit
`e9690bd925a2bf161044a05216ff0642b718b612`. Its upstream MIT license is retained
in the template and included in generated applications. Vendored Bootstrap
assets retain their upstream license headers.
