using System.Diagnostics;
using System.IO;
using System.Net.Http;
using MdPeek;

namespace MdTracker;

/// Self-update: fetch the newer exe next to this one, swap it in (a running exe can be renamed but not overwritten),
/// then relaunch. The relaunched copy waits for this process to exit before its single-instance check.
public static class Updater
{
    public const string WaitPidArg = "--wait-pid";
    public const string UpdatedArg = "--updated";

    public static string ExePath => Environment.ProcessPath ?? throw new InvalidOperationException("no process path");
    public static string StagedPath => ExePath + ".update";
    public static string OldPath => ExePath + ".old";

    /// Leftover from the previous swap; may still be locked for a moment right after the relaunch.
    public static void Cleanup()
    {
        for (int i = 0; i < 5; i++)
        {
            try { if (File.Exists(OldPath)) File.Delete(OldPath); return; } catch { Thread.Sleep(500); }
        }
    }

    /// Download to the staged path. Returns null on any problem (bad size, not a PE file, network).
    public static string? Download(string url, Action<string>? progress = null)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
            using var resp = http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult();
            if (!resp.IsSuccessStatusCode) return null;
            long total = resp.Content.Headers.ContentLength ?? -1;
            using (var src = resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult())
            using (var dst = File.Create(StagedPath))
            {
                var buf = new byte[1 << 16]; long done = 0; int n; var last = DateTime.MinValue;
                while ((n = src.Read(buf, 0, buf.Length)) > 0)
                {
                    dst.Write(buf, 0, n); done += n;
                    if ((DateTime.Now - last).TotalMilliseconds > 500) { last = DateTime.Now; progress?.Invoke(total > 0 ? $"{done * 100 / total}%" : $"{done / 1048576} MB"); }
                }
            }
            var fi = new FileInfo(StagedPath);
            if (fi.Length < 20_000_000 || (total > 0 && fi.Length != total)) { File.Delete(StagedPath); return null; }
            using (var f = File.OpenRead(StagedPath)) { if (f.ReadByte() != 'M' || f.ReadByte() != 'Z') { f.Close(); File.Delete(StagedPath); return null; } }
            return StagedPath;
        }
        catch (Exception ex) { Log.Info("update download: " + ex.Message); try { File.Delete(StagedPath); } catch { } return null; }
    }

    /// Swap the staged file in and relaunch. Returns false if nothing was swapped.
    public static bool ApplyAndRelaunch(IEnumerable<string> args)
    {
        try
        {
            if (!File.Exists(StagedPath)) return false;
            if (File.Exists(OldPath)) File.Delete(OldPath);
            File.Move(ExePath, OldPath);
            try { File.Move(StagedPath, ExePath); }
            catch { File.Move(OldPath, ExePath); throw; }   // put the old one back if the new one cannot take its place
            var psi = new ProcessStartInfo(ExePath) { UseShellExecute = true };
            foreach (var a in args.Where(a => a != WaitPidArg && !int.TryParse(a, out _) && a != UpdatedArg)) psi.ArgumentList.Add(a);
            psi.ArgumentList.Add(WaitPidArg); psi.ArgumentList.Add(Environment.ProcessId.ToString()); psi.ArgumentList.Add(UpdatedArg);
            Process.Start(psi);
            return true;
        }
        catch (Exception ex) { Log.Info("update apply: " + ex.Message); return false; }
    }

    /// Called by the relaunched copy: give the old process time to leave before the single-instance check.
    public static void WaitForPredecessor(string[] args)
    {
        int i = Array.IndexOf(args, WaitPidArg);
        if (i < 0 || i + 1 >= args.Length || !int.TryParse(args[i + 1], out var pid)) return;
        try { using var p = Process.GetProcessById(pid); p.WaitForExit(15000); } catch { }
    }
}
