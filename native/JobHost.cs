using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// The supervisor joins its own unnamed job BEFORE spawning untrusted code.
// Descendants inherit membership. Killing the supervisor closes the only job handle.
class JobHost {
  [StructLayout(LayoutKind.Sequential)] struct Basic {
    public long ProcessTime, JobTime; public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcesses;
    public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong A,B,C,D,E,F; }
  [StructLayout(LayoutKind.Sequential)] struct Extended {
    public Basic Basic; public Io Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref Extended info, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint code);
  static IntPtr job;
  static readonly object sync = new object();
  static readonly JavaScriptSerializer json = new JavaScriptSerializer();
  static void Send(object value) { lock(sync) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); } }
  static void Stop() { if(job != IntPtr.Zero) TerminateJobObject(job, 125); Environment.Exit(125); }
  static string Quote(string value) {
    var result = new StringBuilder("\""); int slashes = 0;
    foreach(char c in value) {
      if(c == '\\') { slashes++; continue; }
      if(c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); }
      else { result.Append('\\', slashes); result.Append(c); }
      slashes = 0;
    }
    result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
  }
  static Thread Pump(StreamReader reader, string stream) {
    var thread = new Thread(() => {
      try { char[] buffer = new char[4096]; int n;
        while((n = reader.Read(buffer, 0, buffer.Length)) > 0) Send(new { type="output", stream=stream, text=new string(buffer,0,n) });
      } catch { Stop(); }
    }); thread.IsBackground = true; thread.Start(); return thread;
  }
  static int Main() {
    Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
    try {
      var command = json.Deserialize<Dictionary<string,object>>(Console.ReadLine());
      job = CreateJobObject(IntPtr.Zero, null);
      var limits = new Extended(); limits.Basic.Flags = 0x2000 | 0x8; limits.Basic.ActiveProcesses = 64;
      if(job == IntPtr.Zero || !SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Extended))) ||
         !AssignProcessToJobObject(job,Process.GetCurrentProcess().Handle)) throw new Exception("JOB_SETUP_FAILED");
      var watch = new Thread(() => { Console.ReadLine(); Stop(); }); watch.IsBackground=true; watch.Start();
      var start = new ProcessStartInfo();
      start.FileName = (string)command["executable"]; start.WorkingDirectory = (string)command["cwd"];
      var arguments = (System.Collections.ArrayList)command["args"];
      var escaped = new List<string>(); foreach(string arg in arguments) escaped.Add(Quote(arg));
      start.Arguments = string.Join(" ",escaped.ToArray());
      start.UseShellExecute=false; start.CreateNoWindow=true;
      start.RedirectStandardOutput=true; start.RedirectStandardError=true; start.RedirectStandardInput=true;
      start.StandardOutputEncoding=Encoding.UTF8; start.StandardErrorEncoding=Encoding.UTF8;
      start.EnvironmentVariables.Clear();
      foreach(var pair in (Dictionary<string,object>)command["env"]) start.EnvironmentVariables[pair.Key]=(string)pair.Value;
      using(var child = Process.Start(start)) {
        child.StandardInput.Close();
        Send(new { type="started", pid=child.Id });
        var stdout = Pump(child.StandardOutput,"stdout"); var stderr = Pump(child.StandardError,"stderr");
        if(!child.WaitForExit(Convert.ToInt32(command["timeoutMs"]))) { Send(new { type="error", message="COMMAND_TIMEOUT" }); Stop(); }
        // Descendants holding inherited pipes cannot prevent bounded completion.
        stdout.Join(1000); stderr.Join(1000);
        Send(new { type="exit", exitCode=child.ExitCode });
      }
      // OS process teardown closes the non-inheritable unnamed job handle.
      return 0;
    } catch(Exception) { try { Send(new { type="error", message="JOB_HOST_FAILED" }); } catch {} return 126; }
  }
}
