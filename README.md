# aspire-templates

Azure-focused templates for Aspire.

## Templates

- [`aspire-azure-starter`](templates/aspire-azure-starter): Blazor frontend and ASP.NET Core API targeting Azure Container Apps, with optional Azure Managed Redis.
- [`aspire-aks-starter`](templates/aspire-aks-starter): The same starter app targeting Azure Kubernetes Service, with a VNet, Application Gateway for Containers, Let's Encrypt TLS, and optional Azure Managed Redis.
- [`aspire-entra-starter`](templates/aspire-entra-starter): The Azure starter secured with Microsoft Entra ID. Users sign in to the Blazor frontend, which calls the API with a JWT access token. Tokens and cached data are kept in Azure Managed Redis. Targets Aspire 17.

### `aspire-entra-starter` prerequisites

The AppHost creates the Entra ID app registrations with Bicep, both when running locally and when deploying, and runs Redis in a container locally, so you need:

- An Azure subscription, with permission to create app registrations and service principals in its tenant.
- The Azure CLI, signed in with `az login`, and Bicep 0.36.1 or later.
- A supported container runtime, such as Docker.

On the first run, the dashboard prompts for the tenant, subscription, resource group, and location (see [local Azure provisioning](https://aspire.dev/integrations/cloud/azure/local-provisioning/)). App registrations are tenant-scoped and remain after you delete the resource group. To give each developer their own registrations, set the optional **Tenant-scoped resource suffix** in that dialog or `Azure:TenantResourceSuffix` in configuration. Use the `https` launch profile, because the sign-in redirect URIs use the web frontend's HTTPS endpoint.

## Testing

[`tests/Aspire.Templates.Tests`](tests/Aspire.Templates.Tests) verifies every template under [`templates`](templates). For each template, it creates an app with `aspire new --template-path`, starts it with `aspire run`, and checks that all resources reach a running and healthy state without logging errors.

Prerequisites: the [Aspire CLI](https://aspire.dev/get-started/install-cli/) on the `PATH` (or set `ASPIRE_CLI_PATH`) and the .NET 10 SDK.

```shell
dotnet test --project tests/Aspire.Templates.Tests
```

Set `ASPIRE_TEMPLATE_TESTS_STARTUP_TIMEOUT_SECONDS` to change how long resources may take to start (default: 300).

## Documentation

- [`aspire new`](https://aspire.dev/reference/cli/commands/aspire-new/)
- [`aspire template source add`](https://aspire.dev/reference/cli/commands/aspire-template-source-add/) (anticipated documentation URL)
