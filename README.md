# aspire-templates

Azure-focused templates for Aspire.

## Templates

- [`aspire-azure-starter`](templates/aspire-azure-starter): Blazor frontend and ASP.NET Core API targeting Azure Container Apps, with optional Azure Managed Redis.

Generated Azure starter projects include a GitHub Actions workflow that validates
deployment artifacts with `aspire publish` on pull requests and deploys `main`
with `aspire deploy` through a protected `production` environment. The
[generated project README](templates/aspire-azure-starter/README.md) contains the
Azure OIDC bootstrap commands and required environment setup.

## Documentation

- [`aspire new`](https://aspire.dev/reference/cli/commands/aspire-new/)
- [`aspire template source add`](https://aspire.dev/reference/cli/commands/aspire-template-source-add/) (anticipated documentation URL)
