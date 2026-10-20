# Bundled fonts

`inter-latin-wght-normal.woff2` is Inter (variable weight axis 100 to 900, Latin subset), copied unchanged from the npm package
`@fontsource-variable/inter` v5.3.0 (`files/inter-latin-wght-normal.woff2`, 48,256 bytes, sha256
`3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62`). It is licensed under the SIL Open Font License 1.1;
the license text is in [OFL.txt](OFL.txt). Characters outside the Latin subset fall back to the system font.

The prototype and the stage use it so the screenshared canvas has the same text widths on every machine: the bot's
Chrome runs on Linux, where `system-ui` is a much wider font than on macOS.
