# System usage

CPU and memory load of the machine running DeepSeek Harness, in the left sidebar
directly above **Settings**, on a full-width row of its own.

- One row with **CPU** and **MEM** side by side: each a label, a percentage, and
  a short bar under it. Bars turn amber from 70% and red from 90%.
- The meter sits on its own full-width row directly above **Settings** and below
  the other footer actions. Each footer action keeps a full-width row, so the
  meter never takes space from the System users action or the other rows.
- Hover or focus for the device name, core count, load average, memory used and
  total, the DSH process resident size, and the sample time.
- Click the meter to ask the Host for a fresh sample; while the page is visible
  it also refreshes every two seconds on its own.
- The readout is hidden while the sidebar is collapsed to its 56px rail.
- When the Host route is unreachable the bars dim and the tooltip and accessible
  description say the shown sample is stale.

The Host half (`index.js`) registers one browser-admitted Fetch route,
`/api/system-usage`, and samples CPU time with `os.cpus()` deltas and memory from
Linux `/proc/meminfo` (`MemAvailable`) or `os.totalmem()`/`os.freemem()`
elsewhere. The Client half (`client.js`) renders the meter in the
`sidebar.footer.action` slot, renders as the last full-width row of that seat
(which turns into one row per action through the `:has()` selector), and polls
that route. No Session data is read and nothing leaves the machine.

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
- The dedicated full-width row uses the browser's `:has()` selector. A browser
  without it keeps the meter on the shared footer action row instead.
- The route is registered only while the bundle is enabled, and the row is
  hidden on the collapsed rail.