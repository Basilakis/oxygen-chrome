# Extension icon

Single source at:

```
public/icons/icon.png
```

The manifest and all UI surfaces (popup/options headers, Chrome toolbar,
extensions management page) reference this one file at every required size
(16 / 32 / 48 / 128). Chrome downscales automatically.

## Replacing the icon

PNG preferred (Chrome MV3 manifest icons reliably support PNG; WebP works in
current Chrome but is rejected by older versions and by some Chromium
distributions).

If you only have a WebP source, drop it at `public/icons/icon.webp` and run:

```
node tests/convert-icon.mjs
```

That converts it to 128×128 PNG at `public/icons/icon.png` and deletes the
WebP source. Then `npm run build` + reload the extension.
