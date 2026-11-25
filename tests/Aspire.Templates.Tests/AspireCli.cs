using System.Diagnostics;
using System.Text;

namespace Aspire.Templates.Tests;

internal sealed record CliResult(int ExitCode, string StandardOutput, string Output);

/// <summary>
/// Thin wrapper around the Aspire CLI. Set the <c>ASPIRE_CLI_PATH</c> environment variable
/// to use a CLI other than the <c>aspire</c> found on the PATH.
/// </summary>
internal static class AspireCli
{
    private static readonly string[] s_commonArgs = ["--non-interactive", "--nologo"];

    public static string ExecutablePath =>
        Environment.GetEnvironmentVariable("ASPIRE_CLI_PATH") is { Length: > 0 } path ? path : "aspire";

    public static async Task<CliResult> RunAsync(string workingDirectory, IEnumerable<string> args, TimeSpan timeout, CancellationToken cancellationToken,
        IReadOnlyDictionary<string, string>? environment = null)
    {
        using var process = new CliProcess(workingDirectory, args, environment);
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(timeout);

        try
        {
            await process.WaitForExitAsync(cts.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new TimeoutException(
                $"'{process.CommandLine}' did not complete within {timeout}.{Environment.NewLine}{process.Output}");
        }

        return new CliResult(process.ExitCode, process.StandardOutput, process.Output);
    }

    /// <summary>
    /// A running Aspire CLI process whose stdout and stderr are captured.
    /// Disposing the instance kills the process tree if it is still running.
    /// </summary>
    internal sealed class CliProcess : IDisposable
    {
        private readonly Process _process;
        private readonly StringBuilder _output = new();
        private readonly StringBuilder _standardOutput = new();

        public CliProcess(string workingDirectory, IEnumerable<string> args, IReadOnlyDictionary<string, string>? environment = null)
        {
            var startInfo = new ProcessStartInfo(ExecutablePath)
            {
                WorkingDirectory = workingDirectory,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = true,
                UseShellExecute = false,
                // Run in a separate console so console control events (e.g. Ctrl+C sent by
                // 'aspire stop' to the AppHost) don't reach the test host.
                CreateNoWindow = true,
            };

            foreach (var arg in args.Concat(s_commonArgs))
            {
                startInfo.ArgumentList.Add(arg);
            }

            startInfo.Environment["ASPIRE_CLI_TELEMETRY_OPTOUT"] = "true";
            startInfo.Environment["DOTNET_CLI_TELEMETRY_OPTOUT"] = "true";
            startInfo.Environment["DOTNET_NOLOGO"] = "true";
            // Avoid lingering build processes that hold files in the temporary project directory.
            startInfo.Environment["MSBUILDDISABLENODEREUSE"] = "1";
            startInfo.Environment["DOTNET_CLI_USE_MSBUILD_SERVER"] = "0";

            if (environment is not null)
            {
                foreach (var (key, value) in environment)
                {
                    startInfo.Environment[key] = value;
                }
            }

            CommandLine = $"aspire {string.Join(' ', startInfo.ArgumentList)}";

            _process = new Process { StartInfo = startInfo };
            _process.OutputDataReceived += (_, e) => Append(e.Data, isStandardOutput: true);
            _process.ErrorDataReceived += (_, e) => Append(e.Data, isStandardOutput: false);
            _process.Start();
            _process.BeginOutputReadLine();
            _process.BeginErrorReadLine();
            _process.StandardInput.Close();
        }

        public string CommandLine { get; }

        public bool HasExited => _process.HasExited;

        public int ExitCode => _process.ExitCode;

        /// <summary>
        /// Interleaved stdout and stderr.
        /// </summary>
        public string Output
        {
            get
            {
                lock (_output)
                {
                    return _output.ToString();
                }
            }
        }

        public string StandardOutput
        {
            get
            {
                lock (_output)
                {
                    return _standardOutput.ToString();
                }
            }
        }

        public Task WaitForExitAsync(CancellationToken cancellationToken) => _process.WaitForExitAsync(cancellationToken);

        public void Dispose()
        {
            try
            {
                if (!_process.HasExited)
                {
                    _process.Kill(entireProcessTree: true);
                    _process.WaitForExit(TimeSpan.FromSeconds(30));
                }
            }
            catch (InvalidOperationException)
            {
                // The process already exited.
            }

            _process.Dispose();
        }

        private void Append(string? line, bool isStandardOutput)
        {
            if (line is null)
            {
                return;
            }

            lock (_output)
            {
                _output.AppendLine(line);
                if (isStandardOutput)
                {
                    _standardOutput.AppendLine(line);
                }
            }
        }
    }
}
