# Credits

## Templates

The starting sheets in `templates/templates.json` are original to this kit.

## Components

The grid, the conversation surface, the dialogs and the HarnessRouter transport come from
**[reifyui](https://www.npmjs.com/package/reifyui)** (MIT), which is where they live so that a
second kit does not start a second copy of them.

## Spreadsheet export

`.xlsx` export uses **[SheetJS](https://sheetjs.com/)** (`xlsx`, Apache-2.0), loaded only when
someone actually exports one.
