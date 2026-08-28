// Python-based renderer and auditor tests execute scripts from the source bundle.
// Keep those runs from mutating the release payload with interpreter bytecode.
process.env.PYTHONDONTWRITEBYTECODE = "1";
