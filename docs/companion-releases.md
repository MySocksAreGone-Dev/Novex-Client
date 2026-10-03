# Companion release compatibility

Novex reads the latest public release of `MySocksAreGone-Dev/Novex-Companion-Mod` through GitHub's API. No token is required. A release must attach `novex-companion-manifest.json`:

```json
{"schema":1,"builds":[{"minecraft":"1.21.11","loader":"fabric","loaderMinimum":"0.19.5","java":21,"version":"0.3.0","modVersion":"0.3.0+mc1.21.11","fabricApi":true,"asset":"Novex-Companion-0.3.0+mc1.21.11.jar","sha256":"<64 lowercase hexadecimal characters>"}]}
```

Generate each row from the production JAR's `fabric.mod.json`, not its filename. The asset must belong to that release and its SHA-256 must match GitHub's asset digest. Exact Minecraft versions and Fabric are required. The launcher verifies the downloaded archive hash and mod metadata again. It refuses incompatible/old loader installations and asks users to repair them first.

The v0.3.0 manifest was generated from the 15 verified release JARs. Future Companion releases need an updated manifest attached alongside their JARs. Missing or offline compatibility data never causes an arbitrary JAR to be installed.

Minecraft, Java and content downloads share the verified transfer/cache implementation. Runtime archive links are validated and materialized as regular files. Downloads retry from a clean temporary file; HTTP Range resumption is not implemented. Launcher updates can download checksum-verified release assets through the same activity queue. The existing release-page option remains available; Novex never executes installers automatically.
