using System.Diagnostics;
using System.Reflection;
using System.Text.Json.Nodes;
using Xunit;

namespace Aspire.Templates.Tests;

/// <summary>
/// For each template in the repository's <c>templates</c> directory, creates an app with
/// <c>aspire new</c>, runs it with <c>aspire run</c>, and verifies it starts without errors.
/// </summary>
public class TemplateRunTests
{
    private static readonly TimeSpan s_newTimeout = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan s_commandTimeout = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan s_pollInterval = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan s_settleTime = TimeSpan.FromSeconds(5);

    private static readonly string s_templatesDirectory = typeof(TemplateRunTests).Assembly
        .GetCustomAttributes<AssemblyMetadataAttribute>()
        .Single(a => a.Key == "TemplatesDirectory").Value!;

    public static TheoryData<string> Templates()
    {
        var templates = Directory.EnumerateDirectories(s_templatesDirectory)
            .Where(dir => File.Exists(Path.Combine(dir, ".template.config", "template.json")))
            .Select(Path.GetFileName)
            .Order(StringComparer.Ordinal)
            .ToArray();

        return new TheoryData<string>(templates!);
    }

    [Theory]
    [MemberData(nameof(Templates))]
    public async Task TemplateCreatesAppThatRunsWithoutErrors(string template)
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var output = TestContext.Current.TestOutputHelper!;

        var workDirectory = Directory.CreateTempSubdirectory("aspire-tpl-").FullName;
        var projectDirectory = Path.Combine(workDirectory, "TestApp");

        try
        {
            var newResult = await AspireCli.RunAsync(
                workDirectory,
                [
                    "new",
                    "--template-path", Path.Combine(s_templatesDirectory, template),
                    "--name", "TestApp",
                    "--output", projectDirectory,
                    "--suppress-agent-init",
                    "--use-config-source", "false",
                ],
                s_newTimeout,
                cancellationToken);
            output.WriteLine(newResult.Output);
            Assert.True(newResult.ExitCode == 0, $"'aspire new' failed with exit code {newResult.ExitCode}.{Environment.NewLine}{newResult.Output}");

            var appHost = ResolveAppHost(projectDirectory);

            using var run = new AspireCli.CliProcess(projectDirectory, ["run", "--isolated", "--apphost", appHost]);
            try
            {
                await WaitForAllResourcesToStartAsync(run, projectDirectory, appHost, cancellationToken);

                // Give the resources a moment to flush telemetry and surface any errors that occur right after startup.
                await Task.Delay(s_settleTime, cancellationToken);

                var resources = await DescribeAsync(projectDirectory, appHost, cancellationToken);
                Assert.NotNull(resources);
                var notReady = resources.Where(r => !r.IsReady).ToArray();
                Assert.True(notReady.Length == 0, $"Resources did not stay running after startup:{Environment.NewLine}{Format(notReady)}");

                var errorLogs = await GetErrorLogsAsync(projectDirectory, appHost, cancellationToken);
                Assert.True(errorLogs.Count == 0, $"Resources logged errors during startup:{Environment.NewLine}{string.Join(Environment.NewLine, errorLogs)}");
            }
            finally
            {
                await StopAsync(run, projectDirectory, appHost);
                output.WriteLine($"--- {run.CommandLine} ---");
                output.WriteLine(run.Output);
            }
        }
        finally
        {
            await TryDeleteDirectoryAsync(workDirectory, output);
        }
    }

    private static string ResolveAppHost(string projectDirectory)
    {
        var configPath = Path.Combine(projectDirectory, "aspire.config.json");
        if (File.Exists(configPath) &&
            JsonNode.Parse(File.ReadAllText(configPath))?["appHost"]?["path"]?.GetValue<string>() is { Length: > 0 } appHostPath)
        {
            return Path.GetFullPath(Path.Combine(projectDirectory, appHostPath));
        }

        return projectDirectory;
    }

    private static async Task WaitForAllResourcesToStartAsync(AspireCli.CliProcess run, string projectDirectory, string appHost, CancellationToken cancellationToken)
    {
        var timeout = GetStartupTimeout();
        var stopwatch = Stopwatch.StartNew();
        var lastStatus = "AppHost not running yet.";

        while (true)
        {
            Assert.False(run.HasExited, $"'aspire run' exited with code {(run.HasExited ? run.ExitCode : 0)} before all resources started.{Environment.NewLine}{run.Output}");

            var resources = await DescribeAsync(projectDirectory, appHost, cancellationToken);
            if (resources is { Count: > 0 })
            {
                var failed = resources.Where(r => r.IsFailed).ToArray();
                Assert.True(failed.Length == 0, $"Resources failed to start:{Environment.NewLine}{Format(failed)}{Environment.NewLine}{run.Output}");

                if (resources.All(r => r.IsReady))
                {
                    return;
                }

                lastStatus = Format(resources);
            }

            Assert.True(stopwatch.Elapsed < timeout, $"Resources did not start within {timeout}. Last status:{Environment.NewLine}{lastStatus}{Environment.NewLine}{run.Output}");

            await Task.Delay(s_pollInterval, cancellationToken);
        }
    }

    private static async Task<IReadOnlyList<ResourceStatus>?> DescribeAsync(string projectDirectory, string appHost, CancellationToken cancellationToken)
    {
        var result = await AspireCli.RunAsync(projectDirectory, ["describe", "--apphost", appHost, "--format", "Json"], s_commandTimeout, cancellationToken);
        if (result.ExitCode != 0 || ParseJson(result.StandardOutput)?["resources"] is not JsonArray resources)
        {
            return null;
        }

        return resources
            .OfType<JsonObject>()
            .Select(r => new ResourceStatus(
                (string?)r["displayName"] ?? (string?)r["name"] ?? "<unknown>",
                (string?)r["state"],
                (string?)r["healthStatus"],
                (int?)r["exitCode"]))
            .ToArray();
    }

    private static async Task<IReadOnlyList<string>> GetErrorLogsAsync(string projectDirectory, string appHost, CancellationToken cancellationToken)
    {
        var result = await AspireCli.RunAsync(projectDirectory, ["otel", "logs", "--apphost", appHost, "--severity", "Error", "--format", "Json"], s_commandTimeout, cancellationToken);
        Assert.True(result.ExitCode == 0, $"'aspire otel logs' failed with exit code {result.ExitCode}.{Environment.NewLine}{result.Output}");

        var logs = ParseJson(result.StandardOutput) as JsonArray;
        Assert.True(logs is not null, $"Unexpected 'aspire otel logs' output:{Environment.NewLine}{result.Output}");

        return logs
            .OfType<JsonObject>()
            .Select(l => $"[{(string?)l["resourceName"]}] {(string?)l["severity"]}: {(string?)l["message"]}")
            .ToArray();
    }

    private static async Task StopAsync(AspireCli.CliProcess run, string projectDirectory, string appHost)
    {
        if (run.HasExited)
        {
            return;
        }

        try
        {
            await AspireCli.RunAsync(projectDirectory, ["stop", "--apphost", appHost], s_commandTimeout, CancellationToken.None);
            using var cts = new CancellationTokenSource(s_commandTimeout);
            await run.WaitForExitAsync(cts.Token);
        }
        catch (Exception ex) when (ex is TimeoutException or OperationCanceledException)
        {
            // Disposing the process kills the remaining process tree.
        }
    }

    private static JsonNode? ParseJson(string output)
    {
        // Tolerate any status lines written before the JSON payload.
        var lines = output.Split('\n');
        var start = Array.FindIndex(lines, l => l.TrimStart() is ['{' or '[', ..]);
        return start < 0 ? null : JsonNode.Parse(string.Join('\n', lines[start..]));
    }

    private static TimeSpan GetStartupTimeout() =>
        int.TryParse(Environment.GetEnvironmentVariable("ASPIRE_TEMPLATE_TESTS_STARTUP_TIMEOUT_SECONDS"), out var seconds) && seconds > 0
            ? TimeSpan.FromSeconds(seconds)
            : TimeSpan.FromMinutes(5);

    private static string Format(IEnumerable<ResourceStatus> resources) =>
        string.Join(Environment.NewLine, resources.Select(r => $"  {r}"));

    private static async Task TryDeleteDirectoryAsync(string path, ITestOutputHelper output)
    {
        // Resource processes can take a while to exit after the AppHost stops and may hold files open until then.
        var stopwatch = Stopwatch.StartNew();
        while (true)
        {
            try
            {
                Directory.Delete(path, recursive: true);
                return;
            }
            catch (DirectoryNotFoundException)
            {
                return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                if (stopwatch.Elapsed > s_commandTimeout)
                {
                    output.WriteLine($"Failed to delete '{path}': {ex.Message}");
                    return;
                }

                await Task.Delay(TimeSpan.FromSeconds(1));
            }
        }
    }

    private sealed record ResourceStatus(string Name, string? State, string? HealthStatus, int? ExitCode)
    {
        private bool HasExited => State is "Exited" or "Finished";

        public bool IsFailed => State is "FailedToStart" or "RuntimeUnhealthy" || (HasExited && ExitCode != 0);

        public bool IsReady => (State == "Running" && HealthStatus is null or "Healthy") || (HasExited && ExitCode == 0);

        public override string ToString() =>
            $"{Name}: state={State ?? "<none>"}, health={HealthStatus ?? "<none>"}{(ExitCode is { } code ? $", exitCode={code}" : "")}";
    }
}
