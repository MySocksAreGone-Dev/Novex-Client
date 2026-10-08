# Minecraft appearance

Novex uses its existing authenticated Minecraft Java account. All bearer tokens,
refresh operations and uploads stay in Electron; the renderer receives only
public profile/texture data, local PNG previews and account-scoped IDs.

## API flow

All requests use `https://api.minecraftservices.com`:

- `GET /minecraft/profile`: current skin and owned capes.
- `POST /minecraft/profile/skins`: multipart `variant` (`classic`/`slim`) and PNG `file`.
- `DELETE /minecraft/profile/skins/active`: reset the custom active skin.
- `PUT /minecraft/profile/capes/active`: JSON `capeId`, checked against the account's capes.
- `DELETE /minecraft/profile/capes/active`: disable the cape without removing ownership.

Mutations use the returned profile, or fetch it once if absent. Reads share a
60-second per-account cache; manual refresh has a 3-second minimum interval.
Changes have a 5-second cooldown. HTTP 429 respects a bounded Retry-After delay;
401 renews the existing Minecraft session once through Novex's silent MSAL flow.
No error response bodies or credentials are returned to React.

PNG uploads are selected through a native file dialog, validated and decoded,
then held as short-lived backend drafts until Apply. Novex stores up to 50 applied
skin copies per account under `userData/appearance/skins/`. These files contain
public texture data only. Deleting a saved copy does not reset the Minecraft skin.

## Reference and limits

API behavior was researched in Modrinth at revision
`50e981bc010060afe6500ae6c7bf7dd02ea770d0`, particularly
[mojang_api.rs](https://github.com/modrinth/code/blob/50e981bc010060afe6500ae6c7bf7dd02ea770d0/packages/app-lib/src/state/minecraft_skins/mojang_api.rs)
and its profile cache/local skin library. Novex's implementation and canvas UI
are original; no Modrinth code or assets were copied.

Minecraft's profile endpoint is not a cloud skin-history library. Local saved
skins do not sync between computers. Novex cannot grant, upload or delete owned
Mojang capes. Default skins are controlled by Minecraft after resetting a custom
skin. Existing game clients may need to reconnect/restart to refresh textures.

Automated tests use API fixtures, never real account mutations. Test real-account
uploads, capes, silent token refresh and service permissions manually before a
release. Minecraft does not publish a stable public specification for all these
launcher endpoints; service restrictions may change independently of Novex.
