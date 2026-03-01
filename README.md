# Kamailio Language Server

Language support for [Kamailio](https://www.kamailio.org/) KEMI Python scripts in VS Code.

Provides pseudo-variable highlighting, completions, diagnostics, and cross-file navigation — purpose-built for Kamailio's Python KEMI bindings.

<!-- TODO: Add screenshot/GIF here -->

## Features

### Pseudo-Variable Intelligence

- **Syntax highlighting** for PVs inside `KSR.pv.*()` strings — `$var(name)`, `$ru`, `$T(reply_code)`, and more
- **Completions** after `$` with all builtin PV types, and inner name completions inside `$T()`, `$TV()`, `$var()`, etc.
- **Diagnostics** for unknown PV classes, invalid inner names, and variables read but never set
- **Hover** info with PV descriptions, categories, and read/write counts
- **Go to Definition** from a `KSR.pv.get()` call to where the variable is set
- **Find References** across all open and workspace files

### Cross-File Analysis

- Tracks `$var`, `$shv`, `$avp`, and `$xavp` writes across files — no false "undefined" warnings when a variable is set in another module
- Resolves Python imports and follows **call chains** transitively: if `main()` calls `helper()` which calls `setup()` which sets `$var(x)`, no warning is raised
- Indexes all `.py` files in the workspace on startup, not just open editors

### Callback Validation

- Validates `KSR.tm.t_on_failure()` and `KSR.tm.t_on_branch()` callback names
- Go to Definition and completions for callback function names
- Supports class methods and constant-resolved callback names

### Htable Tracking

- Completions, hover, and Find References for `KSR.htable.*()` table names
- Warns when a table is read but never written to

### SIP Header Support

- Completions for standard SIP headers inside `KSR.hdr.*()` calls
- Tracks custom headers seen across the workspace
- Hover with RFC references for standard headers

### Statistics Validation

- Validates `KSR.statistics.update_stat()` names against declarations in `kamailio.cfg`
- Resolves f-strings with constant interpolation (e.g., `f"rejected_calls_{ERROR_CODE}"`)
- Go to Definition navigates to the `kamailio.cfg` declaration

### Constant Resolution

- Resolves Python constants passed to KSR calls (`MY_TABLE = "DestList"`)
- Follows alias chains and cross-file constant definitions
- Works with attribute access patterns (`Headers.VOICE_HDR`)

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `kamailioKemi.enable` | `true` | Enable/disable the language server |
| `kamailioKemi.trace.server` | `"off"` | Trace LSP communication (`off`, `messages`, `verbose`) |

The extension automatically enables string completions for Python files (`editor.quickSuggestions.strings: "on"`).

### Extra Python Paths

If your Kamailio KEMI scripts import modules from outside the workspace, pass extra paths via initialization options:

```jsonc
// .vscode/settings.json
{
  "kamailioKemi.extraPaths": ["/path/to/your/lib"]
}
```

The extension also reads `.pth` files from any provided site-packages directories.

## Supported Pseudo-Variables

| Type | Examples |
|------|---------|
| SIP URI | `$ru`, `$rU`, `$fu`, `$fU`, `$tu`, `$du` |
| Network | `$si`, `$sp`, `$Ri`, `$Rp`, `$pr` |
| Message | `$rm`, `$rs`, `$ci`, `$ua`, `$rb` |
| Time | `$Ts`, `$Tf`, `$TV(s)`, `$TV(sn)` |
| Transaction | `$T(reply_code)`, `$T(reply_reason)`, `$T(branch_index)` |
| Script vars | `$var(name)`, `$avp(name)`, `$shv(name)` |
| Extended AVP | `$xavp(root=>field)`, `$xavu(name)`, `$xavi(name)` |
| Headers | `$hdr(Via)`, `$hdrc(Route)` |
| Htable | `$sht(table=>key)` |
| Dialog | `$dlg_var(name)` |

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Run tests
npm test

# Install locally in VS Code
npm run local-install
```

Press **F5** in VS Code to launch the Extension Development Host for debugging.

## License

MIT
