using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Xml.Linq;
using Xunit;

namespace Aspire.SupportDesk.Template.Tests;

public class TemplateVersionTests
{
    private static readonly string TemplateDirectory = typeof(TemplateVersionTests).Assembly
        .GetCustomAttributes<AssemblyMetadataAttribute>()
        .Single(attribute => attribute.Key == "TemplateDirectory").Value!;

    public static TheoryData<string[], string?> VersionCases => new()
    {
        { ["17.0.0", "17.1.0-preview.2", "17.1.0-preview.10"], "17.1.0-preview.10" },
        { ["17.0.0", "17.0.1"], "17.0.1" },
        { ["16.99.0", "17.0.0-preview.999", "17.0.0"], "17.0.0" },
        { ["17.1.0-preview.10", "17.1.0"], "17.1.0" },
        { ["16.99.0", "17.0.0-preview.999"], null },
    };

    [Theory]
    [MemberData(nameof(VersionCases))]
    public async Task AspireSelectsHighestEligibleVersion(string[] versions, string? expectedVersion)
    {
        var work = Directory.CreateTempSubdirectory("support-template-version-").FullName;
        try
        {
            var feed = Directory.CreateDirectory(Path.Combine(work, "feed")).FullName;
            foreach (var version in versions)
            {
                using var archive = ZipFile.Open(Path.Combine(feed, $"Aspire.Hosting.AppHost.{version}.nupkg"), ZipArchiveMode.Create);
                using var writer = new StreamWriter(archive.CreateEntry("Aspire.Hosting.AppHost.nuspec").Open());
                // Metadata-only fixtures validate real NuGet selection, not build compatibility.
                new XDocument(new XElement("package", new XElement("metadata",
                    new XElement("id", "Aspire.Hosting.AppHost"),
                    new XElement("version", version),
                    new XElement("authors", "Template tests"),
                    new XElement("description", "Version selection fixture")))).Save(writer);
            }
            new XDocument(new XElement("configuration",
                new XElement("packageSources", new XElement("clear"),
                    new XElement("add", new XAttribute("key", "fixture"), new XAttribute("value", feed))),
                new XElement("disabledPackageSources", new XElement("clear")),
                new XElement("packageSourceMapping", new XElement("clear"),
                    new XElement("packageSource", new XAttribute("key", "fixture"),
                        new XElement("package", new XAttribute("pattern", "*"))))))
                .Save(Path.Combine(work, "NuGet.Config"));

            var project = Path.Combine(work, "TestApp");
            var result = await RunAsync(work,
                Environment.GetEnvironmentVariable("ASPIRE_CLI_PATH") ?? "aspire",
                ["new", "--template-path", TemplateDirectory, "--name", "TestApp", "--output", project,
                 "--non-interactive", "--suppress-agent-init", "--use-config-source", "false"]);
            if (expectedVersion is null)
            {
                Assert.NotEqual(0, result.ExitCode);
                Assert.Contains("Aspire.Hosting.AppHost", result.Output);
                Assert.Contains("[17.0.0, )", result.Output);
                Assert.False(Directory.Exists(project));
            }
            else
            {
                Assert.True(result.ExitCode == 0, result.Output);
                AssertVersions(project, expectedVersion);
            }
        }
        finally
        {
            Directory.Delete(work, recursive: true);
        }
    }

    [Fact]
    public async Task DotnetNewKeepsReleasedDefault()
    {
        var work = Directory.CreateTempSubdirectory("support-template-default-").FullName;
        try
        {
            var hive = Path.Combine(work, "hive");
            var installed = await RunAsync(work, "dotnet", ["new", "install", TemplateDirectory, "--debug:custom-hive", hive]);
            Assert.True(installed.ExitCode == 0, installed.Output);
            var project = Path.Combine(work, "TestApp");
            var generated = await RunAsync(work, "dotnet",
                ["new", "aspire-support-desk", "--debug:custom-hive", hive,
                 "--name", "TestApp", "--output", project, "--skipRestore", "--no-update-check"]);
            Assert.True(generated.ExitCode == 0, generated.Output);
            AssertVersions(project, "17.0.0");
        }
        finally
        {
            Directory.Delete(work, recursive: true);
        }
    }

    private static void AssertVersions(string projectDirectory, string expectedVersion)
    {
        var expectedPackages = new HashSet<string>(StringComparer.Ordinal)
        {
            "Aspire.Hosting.AppHost", "Aspire.Hosting.Dotnet", "Aspire.Hosting.JavaScript",
            "Aspire.Hosting.Azure.AppContainers", "Aspire.Hosting.Azure.WebPubSub",
            "Aspire.Azure.Messaging.WebPubSub",
        };
        var actualPackages = new HashSet<string>(StringComparer.Ordinal);
        foreach (var project in Directory.EnumerateFiles(projectDirectory, "*.csproj", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(projectDirectory, project)
                .Replace("TestApp", "Aspire-StarterApplication.1", StringComparison.Ordinal);
            var original = XDocument.Load(Path.Combine(TemplateDirectory, relative))
                .Descendants("PackageReference")
                .ToLookup(reference => (string)reference.Attribute("Include")!,
                    reference => (string)reference.Attribute("Version")!);
            foreach (var reference in XDocument.Load(project).Descendants("PackageReference"))
            {
                var id = (string)reference.Attribute("Include")!;
                var version = (string)reference.Attribute("Version")!;
                if (id.StartsWith("Aspire.", StringComparison.Ordinal))
                {
                    Assert.Equal(expectedVersion, version);
                    actualPackages.Add(id);
                }
                else
                {
                    Assert.Contains(version, original[id]);
                }
            }
        }
        Assert.True(expectedPackages.SetEquals(actualPackages), "Expected all six coherent Aspire references.");
        foreach (var frontend in new[] { "public-site", "agent-console" })
        {
            foreach (var file in new[] { "package.json", "package-lock.json" })
            {
                Assert.Equal(File.ReadAllText(Path.Combine(TemplateDirectory, frontend, file)),
                    File.ReadAllText(Path.Combine(projectDirectory, frontend, file)));
            }
        }
    }

    private static async Task<(int ExitCode, string Output)> RunAsync(string work, string executable, string[] arguments)
    {
        var start = new ProcessStartInfo(executable)
        {
            WorkingDirectory = work,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
            UseShellExecute = false,
        };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        var home = Directory.CreateDirectory(Path.Combine(work, "home")).FullName;
        foreach (var key in new[] { "HOME", "DOTNET_CLI_HOME" }) start.Environment[key] = home;
        start.Environment["ASPIRE_HOME"] = Path.Combine(home, ".aspire");
        start.Environment["NUGET_PACKAGES"] = Path.Combine(work, "packages");
        start.Environment["NUGET_HTTP_CACHE_PATH"] = Path.Combine(work, "http-cache");
        start.Environment["ASPIRE_CLI_TELEMETRY_OPTOUT"] = "true";
        start.Environment["DOTNET_CLI_TELEMETRY_OPTOUT"] = "true";
        using var process = Process.Start(start)!;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(2));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync();
            throw;
        }
        var output = await stdout + await stderr;
        TestContext.Current.TestOutputHelper!.WriteLine(output);
        return (process.ExitCode, output);
    }
}
