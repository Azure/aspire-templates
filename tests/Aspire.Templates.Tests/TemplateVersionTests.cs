using System.IO.Compression;
using System.Reflection;
using System.Text.Json.Nodes;
using System.Xml.Linq;
using Xunit;

namespace Aspire.Templates.Tests;

public class TemplateVersionTests
{
    private static readonly string s_templatesDirectory = typeof(TemplateVersionTests).Assembly
        .GetCustomAttributes<AssemblyMetadataAttribute>()
        .Single(a => a.Key == "TemplatesDirectory").Value!;

    public static TheoryData<string, string[], string?, bool> VersionCases()
    {
        var cases = new TheoryData<string, string[], string?, bool>();
        foreach (var template in TemplateRunTests.Templates())
        {
            var name = template.Data;
            cases.Add(name, ["17.0.0", "17.1.0-preview.2", "17.1.0-preview.10"], "17.1.0-preview.10", false);
            cases.Add(name, ["17.0.0", "17.0.1"], "17.0.1", false);
            cases.Add(name, ["16.99.0", "17.0.0-preview.999", "17.0.0"], "17.0.0", false);
            cases.Add(name, ["17.1.0-preview.10", "17.1.0"], "17.1.0", false);
            cases.Add(name, ["16.99.0", "17.0.0-preview.999"], null, false);
            if (name is "aspire-azure-starter" or "aspire-aks-starter")
            {
                cases.Add(name, ["17.0.0", "17.1.0-preview.10"], "17.1.0-preview.10", true);
            }
        }
        return cases;
    }

    [Theory]
    [MemberData(nameof(VersionCases))]
    public async Task TemplateSelectsHighestEligibleVersion(string template, string[] versions, string? expectedVersion, bool includeOptionalPackages)
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var output = TestContext.Current.TestOutputHelper!;
        var workDirectory = Directory.CreateTempSubdirectory("aspire-tpl-version-").FullName;
        var projectDirectory = Path.Combine(workDirectory, "TestApp");

        try
        {
            var templatePath = Path.Combine(s_templatesDirectory, template);
            if (includeOptionalPackages)
            {
                var copy = Path.Combine(workDirectory, "template");
                foreach (var file in Directory.EnumerateFiles(templatePath, "*", SearchOption.AllDirectories))
                {
                    var target = Path.Combine(copy, Path.GetRelativePath(templatePath, file));
                    Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                    File.Copy(file, target);
                }
                // Non-interactive CLI generation uses defaults; enable optional references only in this copy.
                var metadataPath = Path.Combine(copy, ".template.config", "template.json");
                var metadata = JsonNode.Parse(await File.ReadAllTextAsync(metadataPath, cancellationToken))!;
                metadata["symbols"]!["UseRedisCache"]!["defaultValue"] = "true";
                metadata["symbols"]!["TestFx"]!["defaultValue"] = "MSTest";
                await File.WriteAllTextAsync(metadataPath, metadata.ToJsonString(), cancellationToken);
                templatePath = copy;
            }

            var feed = Directory.CreateDirectory(Path.Combine(workDirectory, "feed")).FullName;
            foreach (var version in versions)
            {
                CreatePackage(feed, "Aspire.Hosting.AppHost", version);
            }

            var entraFeed = Directory.CreateDirectory(Path.Combine(workDirectory, "entra-feed")).FullName;
            foreach (var version in new[] { "17.0.0-preview.1.26567.5", "17.0.2", "18.0.0-preview.1" })
            {
                CreatePackage(entraFeed, "Aspire.Hosting.Azure.EntraId", version);
            }

            // The ancestor config controls lookup in the CLI's temporary render as well as the final output.
            var config = new XDocument(new XElement("configuration",
                new XElement("packageSources",
                    new XElement("clear"),
                    new XElement("add", new XAttribute("key", "fixture"), new XAttribute("value", feed)),
                    new XElement("add", new XAttribute("key", "entra-fixture"), new XAttribute("value", entraFeed))),
                new XElement("disabledPackageSources", new XElement("clear")),
                new XElement("packageSourceMapping",
                    new XElement("clear"),
                    new XElement("packageSource", new XAttribute("key", "fixture"),
                        new XElement("package", new XAttribute("pattern", "*"))),
                    new XElement("packageSource", new XAttribute("key", "entra-fixture"),
                        new XElement("package", new XAttribute("pattern", "Aspire.Hosting.Azure.EntraId"))))));
            config.Save(Path.Combine(workDirectory, "NuGet.Config"));

            var home = Directory.CreateDirectory(Path.Combine(workDirectory, "home")).FullName;
            var result = await AspireCli.RunAsync(workDirectory,
                [
                    "new",
                    "--template-path", templatePath,
                    "--name", "TestApp",
                    "--output", projectDirectory,
                    "--suppress-agent-init",
                    "--use-config-source", "false",
                ],
                TimeSpan.FromMinutes(2), cancellationToken,
                new Dictionary<string, string>
                {
                    ["HOME"] = home,
                    ["ASPIRE_HOME"] = Path.Combine(home, ".aspire"),
                    ["DOTNET_CLI_HOME"] = home,
                    ["NUGET_PACKAGES"] = Path.Combine(workDirectory, "packages"),
                    ["NUGET_HTTP_CACHE_PATH"] = Path.Combine(workDirectory, "http-cache"),
                });
            output.WriteLine(result.Output);

            if (expectedVersion is null)
            {
                Assert.NotEqual(0, result.ExitCode);
                Assert.Contains("Aspire.Hosting.AppHost", result.Output);
                Assert.Contains("[17.0.0, )", result.Output);
                Assert.False(Directory.Exists(projectDirectory));
                return;
            }

            Assert.True(result.ExitCode == 0, result.Output);
            AssertGeneratedVersions(template, projectDirectory, expectedVersion, includeOptionalPackages);
        }
        finally
        {
            Directory.Delete(workDirectory, recursive: true);
        }
    }

    private static void AssertGeneratedVersions(string template, string projectDirectory, string expectedVersion, bool includeOptionalPackages)
    {
        var aspireReferences = 0;
        var packageIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var project in Directory.EnumerateFiles(projectDirectory, "*.csproj", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(projectDirectory, project)
                .Replace("TestApp", "Aspire-StarterApplication.1", StringComparison.Ordinal);
            var original = XDocument.Load(Path.Combine(s_templatesDirectory, template, relative))
                .Descendants("PackageReference")
                .ToLookup(reference => (string)reference.Attribute("Include")!,
                    reference => (string)reference.Attribute("Version")!);
            var generated = XDocument.Load(project);
            foreach (var reference in generated.Descendants("ProjectReference"))
            {
                var path = ((string)reference.Attribute("Include")!).Replace('\\', Path.DirectorySeparatorChar);
                Assert.True(File.Exists(Path.Combine(Path.GetDirectoryName(project)!, path)), $"Missing project reference: {path}");
            }
            foreach (var reference in generated.Descendants("PackageReference"))
            {
                var id = (string)reference.Attribute("Include")!;
                packageIds.Add(id);
                var version = (string)reference.Attribute("Version")!;
                if (id == "Aspire.Hosting.Azure.EntraId")
                {
                    Assert.Equal("17.0.2", version);
                }
                else if (id.StartsWith("Aspire.", StringComparison.Ordinal))
                {
                    Assert.Equal(expectedVersion, version);
                    aspireReferences++;
                }
                else
                {
                    Assert.Contains(version, original[id]);
                }
            }
        }
        Assert.True(aspireReferences >= 3, "Expected shared Aspire references in the generated AppHost.");
        if (includeOptionalPackages)
        {
            Assert.Contains("Aspire.Hosting.Testing", packageIds);
            Assert.Contains("Aspire.Hosting.Azure.Redis", packageIds);
            Assert.Contains("Aspire.StackExchange.Redis.OutputCaching", packageIds);
            Assert.Contains("Aspire.Microsoft.Azure.StackExchangeRedis", packageIds);
        }
    }

    private static void CreatePackage(string feed, string id, string version)
    {
        // Metadata-only packages exercise real NuGet enumeration, not restore/build compatibility.
        using var archive = ZipFile.Open(Path.Combine(feed, $"{id}.{version}.nupkg"), ZipArchiveMode.Create);
        using var writer = new StreamWriter(archive.CreateEntry($"{id}.nuspec").Open());
        var nuspec = new XDocument(new XElement("package", new XElement("metadata",
            new XElement("id", id),
            new XElement("version", version),
            new XElement("authors", "Template tests"),
            new XElement("description", "Version selection fixture"))));
        nuspec.Save(writer);
    }
}
