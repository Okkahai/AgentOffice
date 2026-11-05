// Agent Office Windows sandbox helper: runs one command inside an AppContainer.
//   ao-sandbox.exe --name <profile> [--rw <path>]... [--ro <path>]... [--net] -- <exe> [args...]
// The AppContainer can only touch what is granted here (plus what Windows grants all app packages, e.g. Program Files
// read). Everything it spawns stays in the container and in a kill-on-close job, so killing this helper ends the tree.
// Built on first use with the csc.exe that ships with .NET Framework 4 (src/agents/winSandbox.ts); no download.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

static class AoSandbox {
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int CreateAppContainerProfile(string name, string display, string desc, IntPtr caps, uint count, out IntPtr sid);
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertStringSidToSid(string s, out IntPtr sid);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertSidToStringSid(IntPtr sid, out string s);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr value, IntPtr size, IntPtr prev, IntPtr retSize);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attrs, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, IntPtr info, uint len);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int which);

  [StructLayout(LayoutKind.Sequential)] struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid; public IntPtr Capabilities; public uint CapabilityCount; public uint Reserved; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO {
    public int cb; public string lpReserved, lpDesktop, lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION Basic; public IO_COUNTERS Io;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }

  const int ALREADY_EXISTS = unchecked((int)0x800700B7);
  const uint EXTENDED_STARTUPINFO_PRESENT = 0x80000, CREATE_SUSPENDED = 0x4, CREATE_UNICODE_ENVIRONMENT = 0x400;
  const int STARTF_USESTDHANDLES = 0x100;
  static readonly IntPtr PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = (IntPtr)0x20009;

  static int Main(string[] argv) {
    try { return Run(argv); }
    catch (Exception e) { Console.Error.WriteLine("ao-sandbox: " + e.Message); return 125; }
  }

  static int Run(string[] argv) {
    string name = null; bool net = false; var rw = new List<string>(); var ro = new List<string>();
    int i = 0;
    for (; i < argv.Length && argv[i] != "--"; i++) {
      switch (argv[i]) {
        case "--name": name = argv[++i]; break;
        case "--rw": rw.Add(argv[++i]); break;
        case "--ro": ro.Add(argv[++i]); break;
        case "--net": net = true; break;
        default: throw new ArgumentException("unknown option " + argv[i]);
      }
    }
    if (name == null || i + 1 >= argv.Length) throw new ArgumentException("usage: ao-sandbox --name <profile> [--rw p] [--ro p] [--net] -- <exe> [args]");
    var cmd = new string[argv.Length - i - 1];
    Array.Copy(argv, i + 1, cmd, 0, cmd.Length);

    IntPtr acSid;
    int hr = CreateAppContainerProfile(name, name, "Agent Office agent sandbox", IntPtr.Zero, 0, out acSid);
    if (hr == ALREADY_EXISTS) hr = DeriveAppContainerSidFromAppContainerName(name, out acSid);
    if (hr != 0) throw new Win32Exception(hr, "AppContainer profile " + name + " failed: 0x" + hr.ToString("X8"));
    string acSidString; ConvertSidToStringSid(acSid, out acSidString);
    var sid = new SecurityIdentifier(acSidString);

    foreach (var p in rw) Grant(p, sid, FileSystemRights.Modify | FileSystemRights.Synchronize);
    foreach (var p in ro) {
      // Folders like Program Files can't be re-ACLed by a standard user, but Windows already lets every app container read them.
      try { Grant(p, sid, FileSystemRights.ReadAndExecute | FileSystemRights.Synchronize); }
      catch (UnauthorizedAccessException) { Console.Error.WriteLine("ao-sandbox: could not grant read on " + p + ", relying on its existing access"); }
    }

    // Capabilities: internetClient only (outbound internet; no LAN servers, no loopback to the host's services).
    var caps = IntPtr.Zero; uint capCount = 0;
    if (net) {
      IntPtr capSid; if (!ConvertStringSidToSid("S-1-15-3-1", out capSid)) throw new Win32Exception();
      var sa = new SID_AND_ATTRIBUTES { Sid = capSid, Attributes = 4 /* SE_GROUP_ENABLED */ };
      caps = Marshal.AllocHGlobal(Marshal.SizeOf(sa)); Marshal.StructureToPtr(sa, caps, false); capCount = 1;
    }
    var sc = new SECURITY_CAPABILITIES { AppContainerSid = acSid, Capabilities = caps, CapabilityCount = capCount };
    var scPtr = Marshal.AllocHGlobal(Marshal.SizeOf(sc)); Marshal.StructureToPtr(sc, scPtr, false);

    var size = IntPtr.Zero;
    InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
    var attrs = Marshal.AllocHGlobal(size);
    if (!InitializeProcThreadAttributeList(attrs, 1, 0, ref size)) throw new Win32Exception();
    if (!UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, scPtr, (IntPtr)Marshal.SizeOf(sc), IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();

    var si = new STARTUPINFOEX();
    si.StartupInfo.cb = Marshal.SizeOf(si);
    si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    si.StartupInfo.hStdInput = GetStdHandle(-10); si.StartupInfo.hStdOutput = GetStdHandle(-11); si.StartupInfo.hStdError = GetStdHandle(-12);
    si.lpAttributeList = attrs;

    var job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception();
    var lim = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION(); lim.Basic.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE
    var limPtr = Marshal.AllocHGlobal(Marshal.SizeOf(lim)); Marshal.StructureToPtr(lim, limPtr, false);
    if (!SetInformationJobObject(job, 9, limPtr, (uint)Marshal.SizeOf(lim))) throw new Win32Exception();

    var line = new StringBuilder();
    foreach (var a in cmd) { if (line.Length > 0) line.Append(' '); line.Append(Quote(a)); }
    PROCESS_INFORMATION pi;
    if (!CreateProcess(cmd[0], line, IntPtr.Zero, IntPtr.Zero, true, EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, IntPtr.Zero, Environment.CurrentDirectory, ref si, out pi))
      throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcess " + cmd[0] + ": " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
    if (!AssignProcessToJobObject(job, pi.hProcess)) throw new Win32Exception();
    ResumeThread(pi.hThread);
    WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
    uint code; GetExitCodeProcess(pi.hProcess, out code);
    return (int)code;
  }

  /** Allow the container SID on a path (inherited by everything below a directory). Ancestors are not touched: setting a DACL by name re-propagates it through the whole subtree, which on a profile folder is slow and invasive. */
  static void Grant(string path, SecurityIdentifier sid, FileSystemRights rights) {
    var full = Path.GetFullPath(path);
    if (Directory.Exists(full)) {
      var di = new DirectoryInfo(full); var acl = di.GetAccessControl(AccessControlSections.Access);
      acl.AddAccessRule(new FileSystemAccessRule(sid, rights, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
      di.SetAccessControl(acl);
    } else if (File.Exists(full)) {
      var fi = new FileInfo(full); var acl = fi.GetAccessControl(AccessControlSections.Access);
      acl.AddAccessRule(new FileSystemAccessRule(sid, rights, AccessControlType.Allow));
      fi.SetAccessControl(acl);
    } else throw new FileNotFoundException("sandbox grant: " + full + " does not exist");
  }

  /** Quote one argument so CommandLineToArgvW (and the C runtime) give it back unchanged. */
  static string Quote(string a) {
    if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return a;
    var sb = new StringBuilder("\""); int bs = 0;
    foreach (char c in a) {
      if (c == '\\') { bs++; continue; }
      if (c == '"') { sb.Append('\\', bs * 2 + 1); sb.Append('"'); } else { sb.Append('\\', bs); sb.Append(c); }
      bs = 0;
    }
    sb.Append('\\', bs * 2); sb.Append('"');
    return sb.ToString();
  }
}
