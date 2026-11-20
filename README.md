# aspire-templates

Azure-focused templates for Aspire.

## Templates

- [`aspire-azure-starter`](templates/aspire-azure-starter): Blazor frontend and ASP.NET Core API targeting Azure Container Apps, with optional Azure Managed Redis.

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
