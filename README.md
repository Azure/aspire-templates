# aspire-templates

Azure-focused templates for Aspire.

## Templates

- [`aspire-azure-starter`](templates/aspire-azure-starter): Blazor frontend and ASP.NET Core API targeting Azure Container Apps, with optional Azure Managed Redis.
- [`aspire-entra-starter`](templates/aspire-entra-starter): The Azure starter secured with Microsoft Entra ID. Users sign in to the Blazor frontend, which calls the API with a JWT access token. Targets Aspire 17 preview builds.

### `aspire-entra-starter` prerequisites

The AppHost creates the Entra ID app registrations with Bicep, both when running locally and when deploying, so you need:

- An Azure subscription, with permission to create app registrations and service principals in its tenant.
- The Azure CLI, signed in with `az login`, and Bicep 0.36.1 or later.

On the first run, the dashboard prompts for the tenant, subscription, resource group, and location (see [local Azure provisioning](https://aspire.dev/integrations/cloud/azure/local-provisioning/)). App registrations are tenant-scoped and remain after you delete the resource group. To give each developer their own registrations, set the optional **Tenant-scoped resource suffix** in that dialog or `Azure:TenantResourceSuffix` in configuration. Use the `https` launch profile, because the sign-in redirect URIs use the web frontend's HTTPS endpoint. The generated `nuget.config` adds the Aspire daily build feed for the Aspire 17 preview packages.

## Documentation

- [`aspire new`](https://aspire.dev/reference/cli/commands/aspire-new/)
- [`aspire template source add`](https://aspire.dev/reference/cli/commands/aspire-template-source-add/) (anticipated documentation URL)
