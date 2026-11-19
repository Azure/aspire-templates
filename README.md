# aspire-templates

Azure-focused templates for Aspire.

## Templates

- [`aspire-azure-starter`](templates/aspire-azure-starter): Blazor frontend and ASP.NET Core API targeting Azure Container Apps, with optional Azure Managed Redis.

The starter uses one shared `AspirePackagesVersion` for the Aspire SDK and all `Aspire.*` packages, including optional Redis and test dependencies. The Aspire CLI resolves the highest stable `Aspire.Hosting.AppHost` version in `[17.0.0,)` (17.0.0 or newer, with no upper bound) and applies it throughout the generated app. `dotnet new` uses 17.0.0 by default. Non-Aspire dependencies retain their independent versions.

Project files contain literal `17.0.0` versions so they can be restored directly in the repository. Template generation replaces that text only within `Version` attributes; the template's default and CLI version range remain unchanged.

Generated apps do not include the repository's LICENSE file. The root repository license and bundled third-party notices remain unchanged.

## Documentation

- [`aspire new`](https://aspire.dev/reference/cli/commands/aspire-new/)
- [`aspire template source add`](https://aspire.dev/reference/cli/commands/aspire-template-source-add/) (anticipated documentation URL)
