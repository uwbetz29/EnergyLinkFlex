/**
 * Guard @mlightcad/libredwg-web against a crash that aborts the entire parse.
 *
 * The library's convertMText() reads MTEXT column data as:
 *   count = entity_data(entity, "num_column_heights")
 *   ptr   = entity_data(entity, "column_heights")
 *   dwg_ptr_to_double_array(ptr, count)   // reads `count` doubles from `ptr`
 * On some DWGs count/ptr are inconsistent (garbage count, or a null ptr with
 * count > 0), so the WASM reads out of bounds -> "RuntimeError: memory access
 * out of bounds", which kills convert() for the WHOLE drawing. This crashed
 * uploads for MTEXT-heavy drawings (e.g. the CS1-0010 P&ID sheets); GA elevation
 * sheets whose MTEXT have no columns were unaffected. Present in 0.6.7 and the
 * latest 0.7.7 alike, so it is not fixed by a version bump.
 *
 * These pointer-array readers are the choke point for every entity type. Wrap
 * them on the (cached) lib instance to sanity-check size and swallow the WASM
 * trap, so one malformed MTEXT can't take down the whole parse. Returning []
 * only drops rarely-used column metadata. Call once, right after
 * LibreDwg.create().
 */
export function hardenLibreDwg(lib: unknown): void {
  const anyLib = lib as Record<string, unknown>;
  const readers = [
    "dwg_ptr_to_double_array",
    "dwg_ptr_to_int64_t_array",
    "dwg_ptr_to_point2d_array",
    "dwg_ptr_to_point3d_array",
  ];
  const MAX = 65536; // no real DWG array field is larger; beyond this => garbage
  for (const name of readers) {
    const orig = anyLib[name];
    if (typeof orig !== "function") continue;
    const fn = orig as (ptr: unknown, size: number) => unknown;
    anyLib[name] = function (this: unknown, ptr: unknown, size: number) {
      if (!ptr || !Number.isFinite(size) || size <= 0 || size > MAX) return [];
      try {
        return fn.call(this, ptr, size);
      } catch {
        return []; // contain the WASM trap instead of aborting the parse
      }
    };
  }
}
