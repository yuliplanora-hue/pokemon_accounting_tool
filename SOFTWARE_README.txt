Pokemon Toiminimi Accounting Desktop

Open: Pokemon Toiminimi Accounting.exe

The application stores accounting records in SQLite and receipt files in managed native storage. It verifies database and audit integrity at startup, creates daily native backups, and supports verified restore.

The former standalone browser application has been removed. The HTML and JavaScript under frontend\ are application source files used by the Tauri desktop webview; they are not a separate persistence system.

See DESKTOP_README.md for storage paths, receipt attachment, migration, backup, restore, and development instructions.

Developer verification:
- node tests\smoke-test.js
- node --check frontend\app.js
- node --check frontend\compliance.js
- node --check frontend\desktop.js
- npm.cmd run desktop:build
