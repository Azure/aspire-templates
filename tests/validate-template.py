#!/usr/bin/env python3
"""Generate, build, smoke-test, and publish without deploying Azure resources."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "templates" / "aspire-azure-starter"
ENV = {**os.environ, "DOTNET_CLI_TELEMETRY_OPTOUT": "1"}


def run(*args):
    result = subprocess.run(
        [str(arg) for arg in args], cwd=ROOT, env=ENV,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    if result.returncode:
        raise RuntimeError(f"Command failed: {' '.join(map(str, args))}\n{result.stdout}")
    return result.stdout


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def verify_app(output, name, redis, test_framework):
    projects = list(output.glob("*/*.csproj"))
    check(len(projects) == (4 if test_framework == "None" else 5), "Project count")
    for path in projects:
        project = ET.parse(path).getroot()
        for package in project.iter("PackageReference"):
            version = package.attrib.get("Version", "")
            check(version and "PackageVersion" not in version and "*" not in version,
                  f"Unresolved package version in {path}")
        for reference in project.iter("ProjectReference"):
            target = path.parent / reference.attrib["Include"].replace("\\", "/")
            check(target.is_file(), f"Broken project reference: {target}")
    config = json.loads((output / "aspire.config.json").read_text())
    check((output / config["appHost"]["path"]).is_file(), "AppHost name substitution")
    apphost = (output / f"{name}.AppHost" / "AppHost.cs").read_text()
    web = (output / f"{name}.Web" / "Program.cs").read_text()
    check('AddAzureContainerAppEnvironment("aca")' in apphost, "Missing ACA environment")
    check(("AddAzureManagedRedis" in apphost) == redis, "Redis option not respected")
    check(("WithAzureAuthentication" in web) == redis, "Redis authentication option")
    check("AddRedis(" not in apphost and "RunAsContainer" not in apphost, "Container Redis")
    check((output / "LICENSE").read_bytes() == (TEMPLATE / "LICENSE").read_bytes(),
          "Upstream license not preserved")
    for path in output.rglob("*"):
        if path.suffix in (".cs", ".csproj", ".razor", ".json", ".sln"):
            text = path.read_text(encoding="utf-8-sig")
            check("Aspire-StarterApplication.1" not in text, f"Source name left in {path}")


def verify_publish(output, name, artifacts, redis):
    run("aspire", "publish", "--apphost", output / f"{name}.AppHost" / f"{name}.AppHost.csproj",
        "--output-path", artifacts, "--non-interactive", "--nologo")
    frontend = (artifacts / "webfrontend" / "webfrontend.bicep").read_text()
    api = (artifacts / "apiservice" / "apiservice.bicep").read_text()
    check("external: true" in frontend, "Frontend ingress")
    check("external: false" in api, "API must remain internal")
    check("services__apiservice__http__0" in frontend, "API service discovery")
    check((artifacts / "cache" / "cache.bicep").exists() == redis, "Redis publication option")
    check(("ConnectionStrings__cache" in frontend) == redis, "Redis connection injection")
    if redis:
        cache = (artifacts / "cache" / "cache.bicep").read_text()
        roles = (artifacts / "webfrontend-roles-cache" / "webfrontend-roles-cache.bicep").read_text()
        check("Microsoft.Cache/redisEnterprise@" in cache, "Expected Azure Managed Redis")
        check("accessKeysAuthentication: 'Disabled'" in cache and "ssl=true" in cache,
              "Redis must use passwordless TLS")
        check("accessPolicyAssignments@" in roles and "objectId: principalId" in roles,
              "Redis data access policy")
        check("AZURE_CLIENT_ID" in frontend and "ManagedIdentityCredential" in frontend,
              "Frontend managed identity configuration")


def main():
    with tempfile.TemporaryDirectory(prefix="aspire-azure-template-") as directory:
        scratch = Path(directory).resolve()
        hive = scratch / "hive"
        run("dotnet", "new", "install", TEMPLATE, "--debug:custom-hive", hive)
        cases = [
            ("Default.App", False, "None", []),
            ("Azure.Sample", True, "xUnit.net", ["--xunit-version", "v2"]),
            ("9.Azure-App", False, "MSTest",
             ["--no-https", "--localhost-tld", "--webHttpPort", "5188"]),
            ("XunitV3", False, "xUnit.net", ["--xunit-version", "v3"]),
            ("XunitMtp", False, "xUnit.net", ["--xunit-version", "v3mtp"]),
            ("NunitApp", False, "NUnit", []),
        ]
        if any(line.startswith("11.") for line in run("dotnet", "--list-sdks").splitlines()):
            cases.append(("Net11.App", True, "None", ["--framework", "net11.0"]))
        for name, redis, framework, options in cases:
            output = scratch / name
            run("dotnet", "new", "aspire-azure-starter", "-n", name, "-o", output,
                "--skipRestore", "--use-redis-cache", str(redis).lower(),
                "--test-framework", framework, "--debug:custom-hive", hive, *options)
            verify_app(output, name, redis, framework)
            if name == "9.Azure-App":
                launch = json.loads((output / f"{name}.Web" / "Properties" / "launchSettings.json").read_text())
                check("https" not in launch["profiles"], "NoHttps option")
                check(launch["profiles"]["http"]["applicationUrl"] ==
                      "http://localhost:5188", "Web port option")
                host_launch = json.loads((output / f"{name}.AppHost" / "Properties" / "launchSettings.json").read_text())
                check(host_launch["profiles"]["http"]["applicationUrl"].startswith(
                    "http://9-azure-app.dev.localhost:"), "AppHost hostname option")
            run("dotnet", "build", output / f"{name}.sln", "--nologo", "-v", "quiet")
            if name in ("Default.App", "Azure.Sample"):
                verify_publish(output, name, scratch / f"{name}-artifacts", redis)
            if name == "9.Azure-App":
                run("dotnet", "run", "--project", output / f"{name}.Tests",
                    "--no-build", "--", "--progress", "off")
            print(f"PASS: {name} (Redis={redis}, TestFx={framework})", flush=True)
        native = scratch / "Native"
        run("aspire", "new", "--template-path", TEMPLATE, "--name", "Native", "--output",
            native, "--suppress-agent-init", "--use-config-source", "false",
            "--non-interactive", "--nologo")
        verify_app(native, "Native", False, "None")
        run("dotnet", "build", native / "Native.AppHost", "--nologo", "-v", "quiet")
        print("PASS: native Aspire CLI generation and host version substitution", flush=True)


if __name__ == "__main__":
    main()
