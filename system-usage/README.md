# System usage

CPU, memory, and disk load of the machine running DeepSeek Harness, in the left
sidebar directly above **Settings**, on a full-width row of its own.

- One row with **CPU**, **MEM**, and **DISK** side by side: each a label, a
  percentage, and a short bar under it. Bars turn amber from 70% and red from
  90%.
- The meter spans the full sidebar-foot width on the upper row; the System
  users action and the settings seat (the account **More** launcher or
  **Settings**) share the row below it.
- Hover or focus for the device name, core count, load average, memory used and
  total, the root filesystem's disk used and total, the DSH process resident
  size, and the sample time.
- Click the meter to ask the Host for a fresh sample; while the page is visible
  it also refreshes every two seconds on its own.
- The readout is hidden while the sidebar is collapsed to its 56px rail.
- When the Host route is unreachable the bars dim and the tooltip and accessible
  description say the shown sample is stale.

The Host half (`index.js`) registers one browser-admitted Fetch route,
`/api/system-usage`, and samples CPU time with `os.cpus()` deltas, memory from
Linux `/proc/meminfo` (`MemAvailable`) or `os.totalmem()`/`os.freemem()`
elsewhere, and disk from `statfs` on the root filesystem. The Client half (`client.js`) renders the meter in the
`sidebar.footer.action` slot and lays the sidebar foot out as a two-row grid:
the meter across both columns on top, then the System users action beside the
settings seat. It polls the route for its values. No Session data is read and
nothing leaves the machine.

## Configuration

```yaml
- id: system-usage
  name: '@local/system-usage'
  config:
    minSampleMs: 500
```

`minSampleMs` (100–60000, default 500) is the shortest CPU-time window between
two computed samples; a request inside the window reuses the cached sample. A
request with `?fresh=1`, which is what the meter sends on click, shortens that
window to at most one second so a click never measures an almost empty CPU
window, while a click immediately after a poll still shows the fresh cached
sample.

## Limits

- Load average is omitted on Windows, where it has no meaning.
- Memory uses the kernel's available figure on Linux, so page cache is not
  counted as used; other platforms report total minus free.
- Disk reports the filesystem of `/` on POSIX and of the current drive on
  Windows; other mounts are not listed separately.
- The merged row is a structural layout of the sidebar foot (the footer actions
  seat and the settings seat). If a future Harness release changes that DOM, the
  rules stop matching and the shipped stacked foot returns.
- The route is registered only while the bundle is enabled, and the row is
  hidden on the collapsed rail.