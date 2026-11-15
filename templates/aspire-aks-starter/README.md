# Aspire AKS starter

A Blazor frontend and ASP.NET Core weather API with service discovery, health checks,
OpenTelemetry, and optional Azure Managed Redis output caching. Local development
works without Azure credentials; deployment uses Aspire's native AKS integration.

## Create and run

Install the [.NET 10 SDK and Aspire CLI](https://aspire.dev/get-started/prerequisites/).
From a checkout of this repository, generate the app:

```bash
aspire new --template-path ./templates/aspire-aks-starter \
  --name MyAksApp --output ./MyAksApp
cd MyAksApp
aspire run
```

In the generated app, run `aspire run` from the directory containing
`aspire.config.json`. Use the dashboard's frontend link to open the app.
The deployment gateway does not replace the local frontend endpoint. Aspire applies
the Azure network, AKS, gateway, and certificate resources during publishing and
deployment; local runs do not provision them or require an ACME contact email.

The template preserves the starter's .NET 10/.NET 11, HTTPS, `.dev.localhost`,
port, and optional MSTest/NUnit/xUnit test-project options. Caching is **off by
default**. With `UseRedisCache` enabled, `RunAsContainer()` runs Redis locally
(requiring a supported container runtime), while deployment provisions Azure
Managed Redis and uses workload identity for passwordless access. With caching
disabled, the frontend uses in-process output caching and no Redis is provisioned.

Use the **Aspire 17 CLI**. `aspire new` resolves the highest available version of
each Aspire package from the CLI-selected feeds and applicable NuGet configuration.
The host metadata accepts `[17.0.0-0,18.0.0-0)`, including prereleases: 17.0 and
newer 17.x versions are eligible, but 13.x and 18.x (including previews) are not.
Prereleases are enabled for all Aspire packages so daily builds can use a coherent
package family, including preview-only AKS packages. Resolution is per package;
use feeds containing a compatible set and review the generated versions.
An unavailable matching version fails generation rather than falling back to 13.x.

`dotnet new` does not use this CLI resolver; its version-symbol defaults are the
matching **17.0.0** packages. Until these are available on nuget.org, configure the
generated project's NuGet sources to use the same release feed as your Aspire 17
CLI. The verified release/17.0 build is available from the public
[a509f094 staging feed](https://pkgs.dev.azure.com/dnceng/public/_packaging/darc-pub-microsoft-aspire-a509f094/nuget/v3/index.json).
The AppHost uses explicit `Aspire.Hosting.AppHost` and `Aspire.Hosting.Dotnet`
references without the obsolete `Aspire.AppHost.Sdk`. AKS and subnet APIs remain
experimental; keep the hosting packages compatible when updating.

## Deployment model

The AppHost follows the [Aspire AKS walkthrough](https://aspire.dev/deployment/kubernetes/aks/):

- A `10.100.0.0/16` VNet with a `/22` AKS node subnet and a separate `/24` AGC subnet.
- An AKS cluster, Azure Container Registry, and the managed identities/permissions
  created by the native integration. `AddLoadBalancer` delegates the AGC subnet
  and enables the AKS-managed Gateway API and ALB ingress profiles.
- System and workload node pools default to `Standard_D2as_v5`, matching the
  [Aspire AKS cert-manager E2E test](https://github.com/microsoft/aspire/blob/005375592f33f7796fab23e813dacafa54d1947a/tests/Aspire.Deployment.EndToEnd.Tests/AksAzureKubernetesEnvironmentCertManagerDeploymentTests.cs#L130-L133).
  Both pools autoscale from one to three nodes. The generated AppHost's
  `appsettings.json` sets `Azure:AKS:VmSize`; override it with
  `Azure__AKS__VmSize` or the AppHost argument `--Azure:AKS:VmSize`.
  This SKU still requires regional availability and subscription vCPU quota.
- `AddGateway("web")` routes `/` to the Blazor frontend's HTTP endpoint. The API
  remains an internal service; no API gateway route or public service is added.
- `AddCertManager` installs cert-manager; a Let's Encrypt production ClusterIssuer
  uses HTTP-01 and `WithTls` terminates HTTPS at AGC. Traffic from AGC to the
  frontend uses HTTP.

There is **no custom hostname, hostname parameter, or DNS zone**. Aspire discovers
AGC's assigned `*.alb.azure.com` endpoint, bootstraps the TLS secret, and patches the
HTTPS listener so cert-manager can issue a certificate for that name. HTTP port 80
must remain publicly reachable for `/.well-known/acme-challenge/` during issuance
and renewal. A bootstrap self-signed certificate can appear while issuance completes.
Use the HTTPS endpoint for the app; do not treat an unready certificate as success.

The [Aspire walkthrough's automatic HTTPS section](https://aspire.dev/deployment/kubernetes/aks/#add-automatic-https-with-cert-manager)
explicitly supports the assigned AGC FQDN without DNS API access.
[Microsoft's AGC cert-manager guide](https://learn.microsoft.com/azure/application-gateway/for-containers/how-to-cert-manager-lets-encrypt-gateway-api)
describes the Gateway HTTP-01 challenge flow. Actual issuance still depends on public
reachability, [CAA policy](https://letsencrypt.org/docs/caa/), and CA rate limits.
The Aspire 17 issuer uses `WithAcmeServer(acmeServer, acmeEmail)`, following the
[release/17.0 E2E example](https://github.com/microsoft/aspire/blob/a509f094e0ee87d17dc0e1cc9bca84f7ca2623da/tests/Aspire.Deployment.EndToEnd.Tests/AksAzureKubernetesEnvironmentCertManagerDeploymentTests.cs#L137-L148).
`Parameters:acme-server` defaults to Let's Encrypt production in the AppHost's
`appsettings.json`. While experimenting, set
`Parameters__acme_server=https://acme-staging-v02.api.letsencrypt.org/directory`
to avoid production rate limits; staging certificates are not browser-trusted.

## Publish without provisioning

```bash
aspire publish --non-interactive -o ./aks-artifacts
```

Review the generated Bicep and Helm artifacts before deployment. Publishing does
not provision Azure resources, register an ACME account, or request a certificate.
Deployment-time values and the AGC hostname are resolved during deployment.

## Deploy to Azure

Deployment creates billable Azure resources. Install Azure CLI, `kubectl`, and
Helm (see the [current Aspire AKS prerequisites](https://aspire.dev/deployment/kubernetes/aks/#prerequisites)).
Choose a supported AGC region and subscription, authenticate with `az login`,
and have a subscription administrator complete the preview provider/feature
registrations listed in the [AGC prerequisites](https://aspire.dev/deployment/kubernetes/aks/#prerequisites-for-agc):
`Microsoft.ContainerService`, `Microsoft.ServiceNetworking`,
`ManagedGatewayAPIPreview`, and `ApplicationLoadBalancerPreview`. Wait for both
features to be registered before deploying. Ensure the VNet address range does
not overlap networks you intend to connect.

Supply your deployment settings and an actual ACME contact email:

```bash
export Azure__SubscriptionId="<subscription-id>"
export Azure__Location="<supported-region>"
export Azure__ResourceGroup="<resource-group>"
export Parameters__acme_email="<acme-contact-email>"
aspire deploy --non-interactive
```

Do not use the example placeholders as actual values. Aspire provisions the
infrastructure, builds and pushes application images, installs the Helm releases,
and configures the gateway and certificate. It acquires the target AKS credentials;
no pre-existing cluster or hand-written infrastructure is required.

After deployment, inspect the assigned endpoint and certificate readiness:

```bash
kubectl get gateway web -o jsonpath='{.status.addresses[0].value}'
kubectl get certificate
kubectl describe certificate web-tls
```

Open `https://<assigned-agc-fqdn>/` once the certificate is ready and verify the
weather page. Use `curl -Iv https://<assigned-agc-fqdn>/` without bypassing certificate
validation. Live deployment, Azure Redis connectivity, and ACME issuance require
Azure resources and cannot be established by artifact-only validation.

To delete a deployment, select the same AppHost and deployment environment and run
`aspire destroy --environment <environment-name>`. Review the confirmation carefully:
this removes the cluster and the deployment's Azure resources.
