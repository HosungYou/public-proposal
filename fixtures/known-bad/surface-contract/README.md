# Surface-contract negative fixtures

The surface-contract test mutates the complex research-service fixture to
reproduce the escaped defects from the pharmacy exemplar:

- missing neutral table-header shading;
- full-canvas `#FCFCFA` SVG fill;
- zebra-filled semantic body rows;
- stale figure hash;
- missing rendered page image.

Each mutation must produce a deterministic blocker code and nonzero validator
exit status.
