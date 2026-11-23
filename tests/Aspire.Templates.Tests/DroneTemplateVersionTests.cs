using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Xml.Linq;
using Xunit;

namespace Aspire.Templates.Tests;

public class DroneTemplateVersionTests
{
    private static readonly string s_templatePath = Path.Combine(typeof(DroneTemplateVersionTests).Assembly
        .GetCustomAttributes<AssemblyMetadataAttribute>().Single(a => a.Key == "TemplatesDirectory").Value!,
        "aspire-drone-delivery");

    [Theory]
    [InlineData(new[] { "17.0.0", "17.1.0-preview.2", "17.1.0-preview.10" }, "17.1.0-preview.10")]
    [InlineData(new[] { "17.0.0", "17.0.1" }, "17.0.1")]
    [InlineData(new[] { "16.99.0", "17.0.0-preview.999", "17.0.0" }, "17.0.0")]
    [InlineData(new[] { "17.1.0-preview.10", "17.1.0" }, "17.1.0")]
    [InlineData(new[] { "16.99.0", "17.0.0-preview.999" }, null)]
    public async Task AspireSelectsHighestEligibleVersion(string[] versions, string? expected)
    {
        using var fixture = new GenerationFixture();
        foreach (var version in versions)
            fixture.CreatePackage("Aspire.Hosting.AppHost", version);
        var result = await fixture.AspireNew();
        TestContext.Current.TestOutputHelper!.WriteLine(result.Output);
        if (expected is null)
        {
            Assert.NotEqual(0, result.ExitCode);
            Assert.Contains("Aspire.Hosting.AppHost", result.Output);
            Assert.Contains("[17.0.0, )", result.Output);
            Assert.False(Directory.Exists(fixture.OutputPath));
        }
        else
        {
            Assert.True(result.ExitCode == 0, result.Output);
            fixture.AssertVersions(expected);
        }
    }

    [Fact]
    public async Task AspireWithoutHostMetadataUsesDefault()
    {
        using var fixture = new GenerationFixture();
        File.Delete(Path.Combine(fixture.TemplatePath, ".template.config", "aspirecli.host.json"));
        fixture.CreatePackage("Aspire.Hosting.AppHost", "17.1.0-preview.10");
        var result = await fixture.AspireNew();
        Assert.True(result.ExitCode == 0, result.Output);
        fixture.AssertVersions("17.0.0");
    }

    [Theory]
    [InlineData(null, "17.0.0")]
    [InlineData("17.1.0-preview.10", "17.1.0-preview.10")]
    public async Task DotnetNewUsesDefaultOrExplicitSharedVersion(string? supplied, string expected)
    {
        using var fixture = new GenerationFixture();
        var hive = Path.Combine(fixture.WorkPath, "hive");
        var install = await fixture.Run("dotnet", ["new", "install", fixture.TemplatePath, "--debug:custom-hive", hive]);
        Assert.True(install.ExitCode == 0, install.Output);
        var args = new List<string>
        {
            "new", "forthcoffee-drones", "--name", "TestApp", "--output", fixture.OutputPath,
            "--debug:custom-hive", hive
        };
        if (supplied is not null)
            args.AddRange(["--AspirePackagesVersion", supplied]);
        var result = await fixture.Run("dotnet", args);
        Assert.True(result.ExitCode == 0, result.Output);
        fixture.AssertVersions(expected);
    }

    private sealed class GenerationFixture : IDisposable
    {
        public string WorkPath { get; } = Directory.CreateTempSubdirectory("drone-template-version-").FullName;
        public string TemplatePath => Path.Combine(WorkPath, "template");
        public string OutputPath => Path.Combine(WorkPath, "TestApp");
        private string FeedPath => Path.Combine(WorkPath, "feed");

        public GenerationFixture()
        {
            CopyTemplate(s_templatePath, TemplatePath);
            // Exercise an unrelated package with the same literal as the shared Aspire version.
            var appHost = Path.Combine(TemplatePath, "DroneDelivery.AppHost", "DroneDelivery.AppHost.csproj");
            var project = XDocument.Load(appHost);
            project.Root!.Add(new XElement("ItemGroup", new XElement("PackageReference",
                new XAttribute("Include", "Unrelated.VersionFixture"), new XAttribute("Version", "17.0.0"))));
            project.Save(appHost);
            File.WriteAllText(Path.Combine(TemplatePath, "version-fixture.json"), """{"version":"17.0.0"}""");
            Directory.CreateDirectory(FeedPath);
            // Control lookup in the CLI's temporary render as well as the final output.
            new XDocument(new XElement("configuration",
                new XElement("packageSources", new XElement("clear"),
                    new XElement("add", new XAttribute("key", "fixture"), new XAttribute("value", FeedPath))),
                new XElement("disabledPackageSources", new XElement("clear")),
                new XElement("packageSourceMapping", new XElement("clear"),
                    new XElement("packageSource", new XAttribute("key", "fixture"),
                        new XElement("package", new XAttribute("pattern", "*"))))))
                .Save(Path.Combine(WorkPath, "NuGet.Config"));
        }

        public Task<(int ExitCode, string Output)> AspireNew() => Run(
            Environment.GetEnvironmentVariable("ASPIRE_CLI_PATH") is { Length: > 0 } cli ? cli : "aspire",
            ["new", "--template-path", TemplatePath, "--name", "TestApp", "--output", OutputPath,
                "--suppress-agent-init", "--use-config-source", "false", "--non-interactive"]);

        public async Task<(int ExitCode, string Output)> Run(string executable, IEnumerable<string> args)
        {
            var home = Directory.CreateDirectory(Path.Combine(WorkPath, "home")).FullName;
            var start = new ProcessStartInfo(executable)
            {
                WorkingDirectory = WorkPath,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            };
            foreach (var arg in args)
                start.ArgumentList.Add(arg);
            start.Environment["HOME"] = home;
            start.Environment["ASPIRE_HOME"] = Path.Combine(home, ".aspire");
            start.Environment["DOTNET_CLI_HOME"] = home;
            start.Environment["NUGET_PACKAGES"] = Path.Combine(WorkPath, "packages");
            start.Environment["NUGET_HTTP_CACHE_PATH"] = Path.Combine(WorkPath, "http-cache");
            start.Environment["DOTNET_SKIP_FIRST_TIME_EXPERIENCE"] = "1";
            start.Environment["MSBUILDDISABLENODEREUSE"] = "1";
            start.Environment["DOTNET_CLI_USE_MSBUILD_SERVER"] = "0";
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
                process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync(CancellationToken.None);
                throw new TimeoutException($"{executable} timed out.\n{await stdout}\n{await stderr}");
            }
            return (process.ExitCode, $"{await stdout}\n{await stderr}");
        }

        public void AssertVersions(string expected)
        {
            var count = 0;
            var projects = Directory.GetFiles(OutputPath, "*.csproj", SearchOption.AllDirectories);
            Assert.Equal(9, projects.Length);
            foreach (var path in projects)
            {
                var originalPath = Path.Combine(TemplatePath, Path.GetRelativePath(OutputPath, path)
                    .Replace("TestApp", "DroneDelivery", StringComparison.Ordinal));
                var original = XDocument.Load(originalPath).Descendants("PackageReference")
                    .ToDictionary(p => (string)p.Attribute("Include")!, p => (string)p.Attribute("Version")!);
                var generated = XDocument.Load(path);
                foreach (var reference in generated.Descendants("PackageReference"))
                {
                    var id = (string)reference.Attribute("Include")!;
                    var version = (string)reference.Attribute("Version")!;
                    if (id.StartsWith("Aspire.", StringComparison.Ordinal))
                    {
                        Assert.Equal(expected, version);
                        count++;
                    }
                    else
                        Assert.Equal(original[id], version);
                }
                foreach (var reference in generated.Descendants("ProjectReference"))
                    Assert.True(File.Exists(Path.Combine(Path.GetDirectoryName(path)!,
                        ((string)reference.Attribute("Include")!).Replace('\\', Path.DirectorySeparatorChar))));
            }
            Assert.Equal(14, count);
            Assert.Equal("""{"version":"17.0.0"}""", File.ReadAllText(Path.Combine(OutputPath, "version-fixture.json")));
            Assert.Equal(File.ReadAllText(Path.Combine(TemplatePath, "NuGet.config")),
                File.ReadAllText(Path.Combine(OutputPath, "NuGet.config")));
            Assert.False(Directory.Exists(Path.Combine(OutputPath, ".template.config")));
        }

        public void CreatePackage(string id, string version)
        {
            // Metadata-only packages test real NuGet selection, not restore/build compatibility.
            using var archive = ZipFile.Open(Path.Combine(FeedPath, $"{id}.{version}.nupkg"), ZipArchiveMode.Create);
            using var writer = new StreamWriter(archive.CreateEntry($"{id}.nuspec").Open());
            new XDocument(new XElement("package", new XElement("metadata",
                new XElement("id", id), new XElement("version", version),
                new XElement("authors", "Template tests"), new XElement("description", "Version selection fixture"))))
                .Save(writer);
        }

        private static void CopyTemplate(string source, string target)
        {
            Directory.CreateDirectory(target);
            foreach (var file in Directory.GetFiles(source))
                File.Copy(file, Path.Combine(target, Path.GetFileName(file)));
            foreach (var directory in Directory.GetDirectories(source))
            {
                var name = Path.GetFileName(directory);
                if (name is not ("bin" or "obj" or "node_modules" or "dist" or ".aspire"))
                    CopyTemplate(directory, Path.Combine(target, name));
            }
        }

        public void Dispose() => Directory.Delete(WorkPath, recursive: true);
    }
}
