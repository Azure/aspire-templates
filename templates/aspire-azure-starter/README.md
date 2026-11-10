# Aspire-StarterApplication.1

A Blazor frontend and ASP.NET Core API orchestrated by Aspire and ready to deploy
to Azure Container Apps. If you enabled caching when creating this project, local
runs use a Redis container and deployments use Azure Managed Redis.

## Run locally

Install the .NET SDK for this project's target framework and the
[Aspire CLI](https://aspire.dev/get-started/install-cli/), then run from this directory:

```bash
aspire run
```

Local development does not require Azure credentials. Caching requires a supported
container runtime.

## Next Steps

### 1. Create your GitHub repository

Push this project to a GitHub repository with a `main` branch. The included
`.github/workflows/azure.yml` builds the application and runs `aspire publish` on
pull requests targeting `main` and on pushes to `main`. Publishing must complete
successfully; it is not just a step listing or a dry run.

The publish job has no Azure login, environment secrets, or OIDC permission, and
works for fork PRs (subject to GitHub's approval rules for external contributors).
It generates deployment artifacts without provisioning Azure resources or pushing
images. It does not prove that Azure permissions, quotas, image builds, or the
live deployment will succeed. It does not run the optional integration tests.
Mark **Publish deployment artifacts** as a required check in your main-branch ruleset.

After a successful publish on `main`, the deploy job runs `aspire deploy` against
the GitHub environment named `production`. Aspire uses the .NET environment
`Production` for both commands; this is separate from the case-sensitive GitHub
environment name used by OIDC. Deployment runs directly from the AppHost, not
from the previous job's published artifacts.

### 2. Create and protect the production environment

In the repository's **Settings > Environments**, create **production** before
enabling deployments. Restrict its deployment branches to **Selected branches
and tags**, adding only the branch **main** (not a tag). Configure required
reviewers and prevent self-review where your GitHub plan supports it. Protect
`main` with PR reviews and required checks; review workflow and AppHost changes
especially carefully.

Store deployment secrets only in this environment, not as repository secrets.
Do not grant PR workflows access to it, use `pull_request_target` to execute PR
code, or create a federated credential for `pull_request`. The environment's
branch restrictions are essential: an environment-based OIDC subject does not
itself restrict a token to `main`. These protections also matter for same-repository
PRs, which can change workflow code. Never approve a deployment of untrusted code.

### 3. Bootstrap Azure access

Run the following Bash commands yourself in a trusted terminal after installing
the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli).
**These commands create an Entra application, service principal, federated
credential, resource group, and role assignments.** They can enable billable
deployments. They are initial setup, not steps to run inside the workflow.

Replace the values below. Use the exact GitHub owner/repository spelling and an
Azure region supporting your chosen resources, including Azure Managed Redis
if caching is enabled.

```bash
set -euo pipefail

GITHUB_REPOSITORY="OWNER/REPOSITORY"
AZURE_SUBSCRIPTION_ID="<subscription-id>"
AZURE_LOCATION="westus3"
AZURE_RESOURCE_GROUP="my-app-production"
APP_DISPLAY_NAME="my-app-github-production"

az login
az account set --subscription "$AZURE_SUBSCRIPTION_ID"
AZURE_TENANT_ID=$(az account show --query tenantId --output tsv)

az group create --name "$AZURE_RESOURCE_GROUP" --location "$AZURE_LOCATION"
RESOURCE_GROUP_ID=$(az group show --name "$AZURE_RESOURCE_GROUP" --query id --output tsv)

AZURE_CLIENT_ID=$(az ad app create --display-name "$APP_DISPLAY_NAME" --query appId --output tsv)
SERVICE_PRINCIPAL_ID=$(az ad sp create --id "$AZURE_CLIENT_ID" --query id --output tsv)

FEDERATED_CREDENTIAL_FILE=$(mktemp)
cat > "$FEDERATED_CREDENTIAL_FILE" <<EOF
{
  "name": "github-production",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:${GITHUB_REPOSITORY}:environment:production",
  "description": "GitHub Actions production environment",
  "audiences": ["api://AzureADTokenExchange"]
}
EOF
az ad app federated-credential create \
  --id "$AZURE_CLIENT_ID" \
  --parameters "$FEDERATED_CREDENTIAL_FILE"
rm "$FEDERATED_CREDENTIAL_FILE"

az role assignment create \
  --assignee-object-id "$SERVICE_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Contributor" \
  --scope "$RESOURCE_GROUP_ID"

az role assignment create \
  --assignee-object-id "$SERVICE_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Role Based Access Control Administrator" \
  --scope "$RESOURCE_GROUP_ID"

printf 'AZURE_CLIENT_ID=%s\nAZURE_TENANT_ID=%s\nAZURE_SUBSCRIPTION_ID=%s\n' \
  "$AZURE_CLIENT_ID" "$AZURE_TENANT_ID" "$AZURE_SUBSCRIPTION_ID"
```

Your setup identity needs permission to create Entra applications/service
principals, create the resource group, and assign Azure roles at that scope.
Tenant policy may require an administrator. The application is created without a
client secret. Do not create or store `AZURE_CLIENT_SECRET`.

Contributor permits resource deployment but not role assignments. Aspire creates
managed identities and role assignments for registry access and, when selected,
Redis access, so the second role is also needed. Both grants are limited to the
dedicated, pre-created resource group. The deployment identity has no permission
to create other resource groups; this boundary is enforced by Azure RBAC, not
an AppHost configuration switch. The RBAC administrator grant is powerful
within that group. For
stricter environments, have an administrator design constrained role assignments
or pre-provisioned resources instead of granting subscription-wide Owner.
Allow time for new identities and role assignments to propagate.

An administrator should also register the required resource providers at the
subscription scope if they are not already registered:

```bash
for provider in Microsoft.App Microsoft.ContainerRegistry Microsoft.ManagedIdentity Microsoft.OperationalInsights; do
  az provider register --namespace "$provider" --wait
done
# Also required when Azure Managed Redis caching is enabled:
# az provider register --namespace Microsoft.Cache --wait
```

The deployment identity deliberately has no subscription-wide registration grant.
Review the generated Bicep if you add resources needing other providers.

### 4. Configure GitHub values

In the **production** environment, add these values:

| Kind | Name | Value |
|------|------|-------|
| Secret | `AZURE_CLIENT_ID` | Entra application's application (client) ID |
| Secret | `AZURE_TENANT_ID` | Entra tenant ID |
| Secret | `AZURE_SUBSCRIPTION_ID` | Target subscription ID |
| Variable | `AZURE_LOCATION` | The chosen Azure region |
| Variable | `AZURE_RESOURCE_GROUP` | The pre-created resource group name |

These identifiers are stored as secrets by convention; OIDC supplies short-lived
credentials and no long-lived Azure password is needed. The workflow fails
explicitly if a required value is missing. Future secret AppHost parameters belong
in environment secrets and should be mapped to `Parameters__<name>` on the deploy
step, not on the PR publish job.

### 5. Deploy

Merge a reviewed change into `main` and approve the production environment job if
approval is configured. The GitHub-hosted Linux runner supplies Docker and Azure
CLI; the workflow installs .NET and an Aspire CLI version matching the starter's
AppHost release. Keep these versions aligned when upgrading. Projects targeting
preview .NET frameworks also use a preview SDK in CI.

Aspire provisions the Container Apps environment, registry, managed identities,
and application resources. Optional Azure Managed Redis creates additional
billable resources. Production deployments are serialized and a running
deployment is not cancelled by a newer push.

Published output is temporary and is not uploaded as an artifact, since generated
deployment files can contain sensitive configuration as the app evolves.
Review costs and your cleanup policy before the first deployment; this workflow
does not automatically destroy resources.
